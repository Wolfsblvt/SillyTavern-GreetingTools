import { characters, chat, eventSource, event_types, swipe, this_chid } from '../../../../script.js';
import { SWIPE_DIRECTION } from '../../../constants.js';
import { renderExtensionTemplateAsync } from '../../../extensions.js';
import { t } from '../../../i18n.js';
import { escapeHtml, getStringHash } from '../../../utils.js';
import { performFuzzySearch } from '../../../power-user.js';
import { EXTENSION_NAME } from './index.js';
import { findGreetingMetadata, getGreetingToolsData, saveGreetingToolsData, createTempMarker, updateButtonAppearance, getTempGreetings, addTempGreeting, removeTempGreeting } from './greeting-data.js';
import { openGreetingToolsPopup } from './greeting-tools-popup.js';
import { generateGreetingFlow } from './greeting-generator.js';

/**
 * @typedef {Object} GreetingOption
 * @property {number} swipeIndex - Index in the swipes array (0 = main greeting)
 * @property {string} content - The greeting text content
 * @property {string} title - Display title (from metadata or default)
 * @property {string} description - Description (from metadata or empty)
 * @property {string} id - Unique greeting ID (from metadata or generated)
 * @property {boolean} [isTemp] - Whether this is a temporary greeting
 */

/** @type {HTMLElement | null} */
let selectorTemplate = null;

/** @type {GreetingOption[]} */
let cachedOptions = [];

/** @type {boolean} Flag to prevent concurrent injection attempts */
let isInjecting = false;

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
        const matchedMeta = findGreetingMetadata(metadata, i, contentHash);

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
 * @returns {HTMLElement} DOM element
 */
function createOptionElement(option) {
    const wrapper = document.createElement('div');
    wrapper.classList.add('greeting-selector-option');

    const titleDiv = document.createElement('div');
    titleDiv.classList.add('greeting-selector-option-title');

    if (option.isTemp) {
        const tempMarker = createTempMarker();
        titleDiv.appendChild(tempMarker);
    }

    const titleText = document.createTextNode(option.title);
    titleDiv.appendChild(titleText);
    wrapper.appendChild(titleDiv);

    const descHtml = option.description
        ? `<div class="greeting-selector-option-desc">${escapeHtml(option.description)}</div>`
        : `<div class="greeting-selector-option-preview">${escapeHtml(getContentPreview(option.content))}</div>`;

    const descContainer = document.createElement('div');
    descContainer.innerHTML = descHtml;
    wrapper.appendChild(descContainer);

    return wrapper;
}


/**
 * Switches to a specific greeting by swipe index using core swipe function.
 * @param {number} swipeIndex
 */
export async function switchToGreeting(swipeIndex) {
    if (!chat || chat.length === 0) return;

    const firstMessage = chat[0];

    // Ensure swipes array exists
    if (!Array.isArray(firstMessage.swipes)) {
        return;
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
 * Toggles the greeting selector dropdown open or closed.
 * @param {HTMLElement} selector
 * @param {boolean} open - True to open, false to close
 */
function toggleGreetingDropdown(selector, open) {
    selector.classList.toggle('greeting-selector-selecting', open);
    const dropdown = selector.querySelector('.greeting-selector-dropdown');
    if (dropdown && $(dropdown).data('select2')) {
        if (open) {
            $(dropdown).select2('open');
        } else {
            $(dropdown).select2('close');
        }
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
    const tempGreetings = getTempGreetings();
    const isTempGreeting = tempGreetings.has(currentIndex);
    const tempData = tempGreetings.get(currentIndex);

    // Update title display (use temp data if available, with TEMP marker for temp greetings)
    const titleEl = selector.querySelector('.greeting-selector-title-display');
    if (titleEl) {
        const title = isTempGreeting ? tempData?.title : currentOption?.title;
        titleEl.innerHTML = ''; // Clear existing content

        if (isTempGreeting) {
            const tempMarker = createTempMarker();
            titleEl.appendChild(tempMarker);

            const titleText = document.createTextNode(title || t`Temporary Greeting`);
            titleEl.appendChild(titleText);
        } else {
            titleEl.textContent = title || t`Greeting`;
        }
    }

    // Update description (use temp data if available)
    const descEl = selector.querySelector('.greeting-selector-description');
    if (descEl) {
        const description = isTempGreeting ? tempData?.description : currentOption?.description;
        descEl.textContent = description || '';
    }

    // Toggle readonly mode (hide buttons when not changeable)
    selector.classList.toggle('greeting-selector-readonly', !isChangeable);

    // Close dropdown when switching to readonly
    if (!isChangeable) {
        toggleGreetingDropdown(selector, false);
    }

    // Update swipe info (only show when changeable, include temp greetings count)
    const swipeInfoEl = selector.querySelector('.greeting-selector-swipe-info');
    if (swipeInfoEl) {
        const totalCount = options.length + tempGreetings.size;
        swipeInfoEl.textContent = isChangeable ? `${currentIndex + 1} / ${totalCount}` : '';
    }

    // Show/hide save temp button based on whether current is a temp greeting
    const saveTempBtn = selector.querySelector('.greeting-selector-save-temp-btn');
    if (saveTempBtn) {
        saveTempBtn.classList.toggle('displayNone', !isTempGreeting);
    }

    // Build combined options (saved + temp greetings)
    const allOptions = [...options];
    for (const [swipeIndex, tempData] of tempGreetings) {
        allOptions.push({
            swipeIndex,
            content: tempData.content,
            title: tempData.title || t`Temporary Greeting`,
            description: tempData.description,
            id: tempData.id,
            isTemp: true,
        });
    }
    // Sort by swipe index
    allOptions.sort((a, b) => a.swipeIndex - b.swipeIndex);

    // Cache all options for fuzzy search
    cachedOptions = allOptions;

    // Setup dropdown if changeable
    if (isChangeable) {
        const dropdown = selector.querySelector('.greeting-selector-dropdown');
        if (dropdown instanceof HTMLSelectElement) {
            const $dropdown = $(dropdown);
            const needsInit = !$dropdown.data('select2');

            // Rebuild options if needed
            if (needsInit || rebuildDropdown) {
                dropdown.innerHTML = '';
                for (const opt of allOptions) {
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
                        if (!params.term || params.term.trim() === '') {
                            return data;
                        }
                        const searchWeights = [
                            { name: 'title', weight: 10 },
                            { name: 'description', weight: 5 },
                            { name: 'content', weight: 2 },
                        ];
                        // Fuzzy search using performFuzzySearch
                        const results = performFuzzySearch('greetings', cachedOptions, searchWeights, params.term);
                        const match = results.find(r => data && 'id' in data && r.item.swipeIndex === Number(data.id));
                        return match ? data : null;
                    },
                    templateResult: (state) => {
                        if (!state.id) return state.text;
                        const opt = cachedOptions.find(o => o.swipeIndex === Number(state.id));
                        if (!opt) return state.text;
                        const element = createOptionElement(opt);
                        return $(element);
                    },
                    templateSelection: (state) => state.text,
                });

                // Handle selection change
                // @ts-ignore
                $dropdown.on('select2:select', async (e) => {
                    const selectedIndex = Number(e.params.data.id);
                    const actualCurrentIndex = getCurrentSwipeId();
                    toggleGreetingDropdown(selector, false);
                    if (selectedIndex !== actualCurrentIndex) {
                        await switchToGreeting(selectedIndex);
                    }
                });

                // Close dropdown on blur/close
                $dropdown.on('select2:close', () => {
                    toggleGreetingDropdown(selector, false);
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

    // Check if selector already exists (use querySelectorAll to detect duplicates)
    const existingSelectors = firstMessageEl.querySelectorAll('.greeting-selector');
    if (existingSelectors.length > 1) {
        // Remove duplicates, keep only the first one
        for (let i = 1; i < existingSelectors.length; i++) {
            existingSelectors[i].remove();
        }
    }

    let selector = /** @type {HTMLElement|null} */ (firstMessageEl.querySelector('.greeting-selector'));
    if (selector) {
        // Update existing selector
        updateSelectorUI(selector);
        return;
    }

    // Prevent concurrent injection attempts (race condition guard)
    if (isInjecting) {
        return;
    }
    isInjecting = true;

    try {
        // Load template if needed
        if (!selectorTemplate) {
            const html = await renderExtensionTemplateAsync(`third-party/${EXTENSION_NAME}`, 'templates/greeting-selector');
            const container = document.createElement('div');
            container.innerHTML = html;
            selectorTemplate = /** @type {HTMLElement} */ (container.firstElementChild);
        }

        if (!selectorTemplate) {
            console.error('[GreetingTools] Failed to load greeting selector template');
            return;
        }

        // Double-check no selector was added while we were loading template
        if (firstMessageEl.querySelector('.greeting-selector')) {
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
    } finally {
        isInjecting = false;
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
            toggleGreetingDropdown(selector, true);
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

    // Generate button - generates a temporary greeting
    const generateBtn = selector.querySelector('.greeting-selector-generate-btn');
    if (generateBtn) {
        generateBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            await handleGenerateTempGreeting(selector);
        });
    }

    // Save temp button - saves the temporary greeting to alternates
    const saveTempBtn = selector.querySelector('.greeting-selector-save-temp-btn');
    if (saveTempBtn) {
        saveTempBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            await handleSaveTempGreeting(selector);
        });
    }
}

/**
 * Handles generating a temporary greeting and adding it as a swipe.
 * Uses the unified generateGreetingFlow for the generation logic.
 * @param {HTMLElement} selector
 */
async function handleGenerateTempGreeting(selector) {
    // Use unified generation flow
    const generated = await generateGreetingFlow({
        popupTitle: t`Generate Temporary Greeting`,
        defaultTitle: t`Temporary Greeting`,
        loaderMessage: t`Generating temporary greeting...`,
    });

    if (!generated) return;

    try {
        // Add as a new swipe to the first message
        const firstMessage = chat[0];
        if (!firstMessage) return;

        // Ensure swipes array exists
        if (!Array.isArray(firstMessage.swipes)) {
            firstMessage.swipes = [firstMessage.mes];
            firstMessage.swipe_id = 0;
            firstMessage.swipe_info = [{}];
        }

        // Add new swipe
        const newSwipeIndex = firstMessage.swipes.length;
        firstMessage.swipes.push(generated.content);
        firstMessage.swipe_info.push({});

        // Track as temp greeting (persisted to chat_metadata)
        await addTempGreeting(newSwipeIndex, {
            id: generated.id,
            title: generated.title,
            description: generated.description,
            content: generated.content,
            swipeIndex: newSwipeIndex,
        });

        // Use swipe() to switch to the new swipe - this handles proper message rendering
        await swipe(null, SWIPE_DIRECTION.RIGHT, {
            message: firstMessage,
            forceMesId: 0,
            forceSwipeId: newSwipeIndex,
        });

        // Update UI
        updateSelectorUI(selector, { rebuildDropdown: true });
        updateButtonAppearance(this_chid);

        toastr.success(t`Temporary greeting generated`);
    } catch (error) {
        console.error('[GreetingTools] Failed to add temp greeting:', error);
        toastr.error(t`Failed to add greeting`);
    }
}

/**
 * Handles saving a temporary greeting to the character's alternate greetings.
 * @param {HTMLElement} selector
 */
async function handleSaveTempGreeting(selector) {
    const currentSwipeId = getCurrentSwipeId();
    const tempGreetings = getTempGreetings();
    const tempData = tempGreetings.get(currentSwipeId);

    if (!tempData) {
        toastr.warning(t`Current greeting is not a temporary greeting`);
        return;
    }

    const character = characters[this_chid];
    if (!character) return;

    // Ensure alternate_greetings array exists
    if (!character.data) {
        character.data = {};
    }
    if (!Array.isArray(character.data.alternate_greetings)) {
        character.data.alternate_greetings = [];
    }

    // Add to alternate greetings
    const newIndex = character.data.alternate_greetings.length;
    character.data.alternate_greetings.push(tempData.content);

    // Save metadata
    const metadata = getGreetingToolsData({ chid: this_chid });

    // Initialize indexMap if needed
    if (!metadata.indexMap) {
        metadata.indexMap = {};
    }

    // Add greeting metadata
    metadata.greetings[tempData.id] = {
        id: tempData.id,
        title: tempData.title,
        description: tempData.description,
        contentHash: getStringHash(tempData.content),
    };
    metadata.indexMap[newIndex] = tempData.id;

    // Save metadata
    saveGreetingToolsData(metadata, { chid: this_chid });

    // Remove from temp tracking (persisted)
    await removeTempGreeting(currentSwipeId);

    // Save character
    // @ts-ignore
    await fetch('/api/characters/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(character),
    });

    // Update UI
    updateSelectorUI(selector, { rebuildDropdown: true });

    toastr.success(t`Greeting saved to alternates`);
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
    // Temp greetings are already per-chat in chat_metadata, no need to clear
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
