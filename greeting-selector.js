import { Fuse } from '../../../../lib.js';
import { characters, chat, eventSource, event_types, swipe, this_chid } from '../../../../script.js';
import { SWIPE_DIRECTION } from '../../../constants.js';
import { renderExtensionTemplateAsync } from '../../../extensions.js';
import { t } from '../../../i18n.js';
import { escapeHtml, getStringHash } from '../../../utils.js';
import { EXTENSION_NAME } from './index.js';
import { getGreetingToolsData, openGreetingToolsPopup } from './greeting-tools.js';

/**
 * @typedef {Object} GreetingOption
 * @property {number} swipeIndex - Index in the swipes array (0 = main greeting)
 * @property {string} content - The greeting text content
 * @property {string} title - Display title (from metadata or default)
 * @property {string} description - Description (from metadata or empty)
 * @property {string} id - Unique greeting ID (from metadata or generated)
 */

/** @type {HTMLElement | null} */
let selectorTemplate = null;

/** @type {Fuse<GreetingOption> | null} */
let greetingFuse = null;

/** @type {GreetingOption[]} */
let cachedOptions = [];

/**
 * Checks if the first message is a character greeting that we can display info for.
 * @returns {boolean}
 */
function isFirstMessageGreeting() {
    if (!chat || chat.length === 0) return false;

    const firstMessage = chat[0];

    // Must be a character message (not user)
    if (firstMessage.is_user) return false;

    return true;
}

/**
 * Checks if the greeting can be changed (only when chat has exactly one message).
 * @returns {boolean}
 */
function isGreetingChangeable() {
    if (!isFirstMessageGreeting()) return false;

    // Only changeable if there's exactly one message
    if (chat.length !== 1) return false;

    // Must have swipes available or alternate greetings
    const firstMessage = chat[0];
    if (!Array.isArray(firstMessage.swipes) || firstMessage.swipes.length <= 1) {
        const character = characters[this_chid];
        if (!character) return false;

        const altGreetings = character.data?.alternate_greetings ?? [];
        return altGreetings.length > 0;
    }

    return true;
}

/**
 * Gets all available greeting options for the current character.
 * @returns {GreetingOption[]}
 */
function getGreetingOptions() {
    const character = characters[this_chid];
    if (!character) return [];

    const metadata = getGreetingToolsData({ chid: this_chid });
    const options = [];

    // Main greeting (swipe index 0)
    const mainContent = character.first_mes ?? '';
    const mainMeta = metadata.mainGreeting ?? {};

    options.push({
        swipeIndex: 0,
        content: mainContent,
        title: mainMeta.title || t`Main Greeting`,
        description: mainMeta.description || '',
        id: mainMeta.id || 'main',
    });

    // Alternate greetings (swipe index 1+)
    const altGreetings = character.data?.alternate_greetings ?? [];
    for (let i = 0; i < altGreetings.length; i++) {
        const content = altGreetings[i];
        const contentHash = getStringHash(content);

        // Find matching metadata by content hash
        let matchedMeta = null;
        for (const [, meta] of Object.entries(metadata.greetings)) {
            if (meta.contentHash === contentHash) {
                matchedMeta = meta;
                break;
            }
        }

        options.push({
            swipeIndex: i + 1,
            content,
            title: matchedMeta?.title || `${t`Alternate Greeting`} #${i + 1}`,
            description: matchedMeta?.description || '',
            id: matchedMeta?.id || `alt_${i}`,
        });
    }

    return options;
}

/**
 * Gets the current swipe index for the first message.
 * @returns {number}
 */
function getCurrentSwipeId() {
    if (!chat || chat.length === 0) return 0;
    return chat[0].swipe_id ?? 0;
}

/**
 * Finds greeting option by swipe index.
 * @param {GreetingOption[]} options
 * @param {number} swipeIndex
 * @returns {GreetingOption | undefined}
 */
function findOptionBySwipeIndex(options, swipeIndex) {
    return options.find(opt => opt.swipeIndex === swipeIndex);
}

/**
 * Generates a preview of the greeting content (first ~3 lines).
 * @param {string} content
 * @returns {string}
 */
function getContentPreview(content) {
    const lines = content.split('\n').slice(0, 3);
    let preview = lines.join('\n');
    if (content.split('\n').length > 3 || preview.length > 200) {
        preview = preview.substring(0, 200) + '...';
    }
    return preview;
}

/**
 * Creates a select2 option element for a greeting.
 * @param {GreetingOption} option
 * @returns {string} HTML string
 */
function createOptionHtml(option) {
    const descHtml = option.description
        ? `<div class="greeting-selector-option-desc">${escapeHtml(option.description)}</div>`
        : `<div class="greeting-selector-option-preview">${escapeHtml(getContentPreview(option.content))}</div>`;

    return `
        <div class="greeting-selector-option">
            <div class="greeting-selector-option-title">${escapeHtml(option.title)}</div>
            ${descHtml}
        </div>
    `;
}

/**
 * Initializes fuzzy search for greeting options.
 * @param {GreetingOption[]} options
 */
function initFuzzySearch(options) {
    cachedOptions = options;
    greetingFuse = new Fuse(options, {
        keys: [
            { name: 'title', weight: 10 },
            { name: 'description', weight: 5 },
            { name: 'content', weight: 2 },
        ],
        includeScore: true,
        ignoreLocation: true,
        threshold: 0.3,
    });
}

/**
 * Performs fuzzy search on greeting options.
 * @param {string} searchTerm
 * @returns {GreetingOption[]}
 */
function searchGreetings(searchTerm) {
    if (!searchTerm || !greetingFuse) {
        return cachedOptions;
    }
    const results = greetingFuse.search(searchTerm);
    return results.map(r => r.item);
}

/**
 * Switches to a specific greeting by swipe index using core swipe function.
 * @param {number} swipeIndex
 */
async function switchToGreeting(swipeIndex) {
    if (!chat || chat.length === 0) return;

    const firstMessage = chat[0];

    // Ensure swipes array exists
    if (!Array.isArray(firstMessage.swipes)) {
        firstMessage.swipes = [firstMessage.mes];
        firstMessage.swipe_info = [{}];
        firstMessage.swipe_id = 0;

        // Add alternate greetings as swipes
        const character = characters[this_chid];
        const altGreetings = character?.data?.alternate_greetings ?? [];
        for (const altGreeting of altGreetings) {
            firstMessage.swipes.push(altGreeting);
            firstMessage.swipe_info.push({});
        }
    }

    // Validate swipe index
    if (swipeIndex < 0 || swipeIndex >= firstMessage.swipes.length) {
        console.warn('[GreetingTools] Invalid swipe index:', swipeIndex);
        return;
    }

    // Determine direction based on current vs target swipe ID
    const currentSwipeId = firstMessage.swipe_id ?? 0;
    const direction = (currentSwipeId <= swipeIndex) ? SWIPE_DIRECTION.RIGHT : SWIPE_DIRECTION.LEFT;

    // Use core swipe function with forceSwipeId for smooth animation
    await swipe(null, direction, {
        forceMesId: 0,
        forceSwipeId: swipeIndex,
        message: firstMessage,
    });
}

/**
 * Closes the greeting selector dropdown and returns to readonly display.
 * @param {HTMLElement} selector
 */
function closeGreetingDropdown(selector) {
    selector.classList.remove('greeting-selector-selecting');
    const dropdown = selector.querySelector('.greeting-selector-dropdown');
    if (dropdown && $(dropdown).data('select2')) {
        $(dropdown).select2('close');
    }
}

/**
 * Opens the greeting selector dropdown for selection.
 * @param {HTMLElement} selector
 */
function openGreetingDropdown(selector) {
    selector.classList.add('greeting-selector-selecting');
    const dropdown = selector.querySelector('.greeting-selector-dropdown');
    if (dropdown && $(dropdown).data('select2')) {
        $(dropdown).select2('open');
    }
}

/**
 * Updates the greeting selector UI with current state.
 * @param {HTMLElement} selector
 * @param {object} [options_]
 * @param {boolean} [options_.rebuildDropdown=false] - Force rebuild of dropdown options
 */
function updateSelectorUI(selector, { rebuildDropdown = false } = {}) {
    const options = getGreetingOptions();
    const currentIndex = getCurrentSwipeId();
    const isChangeable = isGreetingChangeable();
    const currentOption = findOptionBySwipeIndex(options, currentIndex);

    // Initialize fuzzy search with current options
    initFuzzySearch(options);

    // Update title display
    const titleEl = selector.querySelector('.greeting-selector-title-display');
    if (titleEl) {
        titleEl.textContent = currentOption?.title || t`Greeting`;
    }

    // Update description
    const descEl = selector.querySelector('.greeting-selector-description');
    if (descEl) {
        descEl.textContent = currentOption?.description || '';
    }

    // Toggle readonly mode (hide buttons when not changeable)
    selector.classList.toggle('greeting-selector-readonly', !isChangeable);

    // Close dropdown when switching to readonly
    if (!isChangeable) {
        closeGreetingDropdown(selector);
    }

    // Update swipe info (only show when changeable)
    const swipeInfoEl = selector.querySelector('.greeting-selector-swipe-info');
    if (swipeInfoEl) {
        swipeInfoEl.textContent = isChangeable ? `${currentIndex + 1} / ${options.length}` : '';
    }

    // Setup dropdown if changeable
    if (isChangeable) {
        const dropdown = selector.querySelector('.greeting-selector-dropdown');
        if (dropdown instanceof HTMLSelectElement) {
            const $dropdown = $(dropdown);
            const needsInit = !$dropdown.data('select2');

            // Rebuild options if needed
            if (needsInit || rebuildDropdown) {
                dropdown.innerHTML = '';
                for (const opt of options) {
                    const optionEl = document.createElement('option');
                    optionEl.value = String(opt.swipeIndex);
                    optionEl.textContent = opt.title;
                    optionEl.selected = opt.swipeIndex === currentIndex;
                    dropdown.appendChild(optionEl);
                }
            }

            if (needsInit) {
                $dropdown.select2({
                    width: '100%',
                    dropdownAutoWidth: true,
                    matcher: (params, data) => {
                        // Custom matcher using fuzzy search
                        if (!params.term || params.term.trim() === '') {
                            return data;
                        }
                        const results = searchGreetings(params.term);
                        const match = results.find(r => data && 'id' in data && r.swipeIndex === Number(data.id));
                        return match ? data : null;
                    },
                    templateResult: (state) => {
                        if (!state.id) return state.text;
                        const opt = options.find(o => o.swipeIndex === Number(state.id));
                        if (!opt) return state.text;
                        const html = createOptionHtml(opt);
                        const wrapper = document.createElement('div');
                        wrapper.innerHTML = html;
                        return $(wrapper);
                    },
                    templateSelection: (state) => state.text,
                });

                // Handle selection change
                // @ts-ignore
                $dropdown.on('select2:select', async (e) => {
                    const selectedIndex = Number(e.params.data.id);
                    const actualCurrentIndex = getCurrentSwipeId();
                    closeGreetingDropdown(selector);
                    if (selectedIndex !== actualCurrentIndex) {
                        await switchToGreeting(selectedIndex);
                    }
                });

                // Close dropdown on blur/close
                $dropdown.on('select2:close', () => {
                    closeGreetingDropdown(selector);
                });
            } else {
                // Update selected value
                $dropdown.val(String(currentIndex)).trigger('change.select2');
            }
        }
    }
}

/**
 * Injects the greeting selector into the first message.
 */
async function injectGreetingSelector() {
    // Only inject if we have a character selected and there's a greeting
    if (this_chid === undefined || !isFirstMessageGreeting()) {
        removeGreetingSelector();
        return;
    }

    // Find the first message element
    const firstMessageEl = document.querySelector('.mes[mesid="0"]');
    if (!firstMessageEl) {
        return;
    }

    // Check if selector already exists
    let selector = /** @type {HTMLElement|null} */ (firstMessageEl.querySelector('.greeting-selector'));
    if (selector) {
        // Update existing selector
        updateSelectorUI(selector);
        return;
    }

    // Load template if needed
    if (!selectorTemplate) {
        const html = await renderExtensionTemplateAsync(`third-party/${EXTENSION_NAME}`, 'greeting-selector');
        const container = document.createElement('div');
        container.innerHTML = html;
        selectorTemplate = /** @type {HTMLElement} */ (container.firstElementChild);
    }

    if (!selectorTemplate) {
        console.error('[GreetingTools] Failed to load greeting selector template');
        return;
    }

    // Clone and inject
    selector = /** @type {HTMLElement} */ (selectorTemplate.cloneNode(true));

    // Find injection point: after .ch_name, before .mes_reasoning_details or .mes_text
    const mesBlock = firstMessageEl.querySelector('.mes_block');
    const chName = mesBlock?.querySelector('.ch_name');
    const reasoningDetails = mesBlock?.querySelector('.mes_reasoning_details');
    const mesText = mesBlock?.querySelector('.mes_text');

    if (mesBlock && chName) {
        // Insert after ch_name
        if (reasoningDetails) {
            mesBlock.insertBefore(selector, reasoningDetails);
        } else if (mesText) {
            mesBlock.insertBefore(selector, mesText);
        } else {
            chName.after(selector);
        }

        // Setup event handlers
        setupSelectorEventHandlers(selector);

        // Update UI
        updateSelectorUI(selector);
    }
}

/**
 * Sets up event handlers for the greeting selector.
 * @param {HTMLElement} selector
 */
function setupSelectorEventHandlers(selector) {
    // Select button - opens the dropdown
    const selectBtn = selector.querySelector('.greeting-selector-select-btn');
    if (selectBtn) {
        selectBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            openGreetingDropdown(selector);
        });
    }

    // Edit button - opens the greeting tools popup
    const editBtn = selector.querySelector('.greeting-selector-edit-btn');
    if (editBtn) {
        editBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();

            // Get current swipe index to highlight the correct greeting
            const currentSwipeId = getCurrentSwipeId();
            await openGreetingToolsPopup(this_chid, { highlightSwipeIndex: currentSwipeId });
        });
    }
}

/**
 * Removes the greeting selector from the DOM.
 */
function removeGreetingSelector() {
    const selector = /** @type {HTMLElement|null} */ (document.querySelector('.greeting-selector'));
    if (selector) {
        // Destroy select2 if initialized
        const dropdown = selector.querySelector('.greeting-selector-dropdown');
        if (dropdown && $(dropdown).data('select2')) {
            $(dropdown).select2('destroy');
        }
        selector.remove();
    }
}

/**
 * Handles chat change event.
 */
async function onChatChanged() {
    // Small delay to ensure DOM is ready after chat switch
    setTimeout(() => injectGreetingSelector(), 50);
}

/**
 * Handles any message rendered event - used to update button visibility.
 * @param {number} messageId
 */
function onAnyMessageRendered(messageId) {
    // When any message beyond the first is rendered, update UI to hide buttons
    if (messageId > 0) {
        const selector = /** @type {HTMLElement|null} */ (document.querySelector('.greeting-selector'));
        if (selector) {
            updateSelectorUI(selector);
        }
    }
}

/**
 * Handles message swiped event.
 */
async function onMessageSwiped() {
    // Update the selector UI when first message is swiped
    const selector = /** @type {HTMLElement|null} */ (document.querySelector('.greeting-selector'));
    if (selector) {
        updateSelectorUI(selector);
    }
}

/**
 * Handles character message rendered event.
 * @param {number} messageId
 */
async function onCharacterMessageRendered(messageId) {
    // Only care about first message
    if (messageId === 0) {
        await injectGreetingSelector();
    }
}

/**
 * Initializes the greeting selector feature.
 */
export function initGreetingSelector() {
    eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
    eventSource.on(event_types.MESSAGE_SWIPED, onMessageSwiped);
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, onCharacterMessageRendered);
    eventSource.on(event_types.USER_MESSAGE_RENDERED, onAnyMessageRendered);

    // Initial injection if chat is already loaded
    if (chat && chat.length > 0) {
        injectGreetingSelector();
    }
}
