import { characters, menu_type, create_save, createOrEditCharacter } from '../../../../script.js';
import { renderExtensionTemplateAsync } from '../../../extensions.js';
import { Popup, POPUP_RESULT, POPUP_TYPE } from '../../../popup.js';
import { t } from '../../../i18n.js';
import { debounce, getStringHash } from '../../../utils.js';
import { debounce_timeout } from '../../../constants.js';
import {
    getGreetingToolsData,
    saveGreetingToolsData,
    generateGreetingId,
} from './data-storage.js';
import { EXTENSION_NAME } from './index.js';

/**
 * @typedef {Object} GreetingState
 * @property {string} id - Unique greeting ID
 * @property {string} content - Greeting content
 * @property {string} title - Custom title
 * @property {string} description - Optional description
 * @property {number} contentHash - Hash of content
 */

/** @type {GreetingState[]} */
let greetingStates = [];

/** @type {GreetingState | null} */
let mainGreetingState = null;

/** @type {string | undefined} */
let currentChid = undefined;

/** @type {Popup | null} */
let currentPopup = null;

/** @type {HTMLElement | null} */
let popupTemplate = null;

/** @type {HTMLElement | null} */
let blockTemplateElement = null;

/**
 * Gets the alternate greetings array for the current context.
 * @returns {string[]}
 */
function getGreetingsArray() {
    if (menu_type === 'create') {
        return create_save.alternate_greetings;
    }
    const character = characters[currentChid];
    return character?.data?.alternate_greetings ?? [];
}

/**
 * Sets the alternate greetings array for the current context.
 * @param {string[]} greetings
 */
function setGreetingsArray(greetings) {
    if (menu_type === 'create') {
        create_save.alternate_greetings = greetings;
    } else {
        const character = characters[currentChid];
        if (character?.data) {
            character.data.alternate_greetings = greetings;
        }
    }
}

/**
 * Gets the main greeting content for the current context.
 * @returns {string}
 */
function getMainGreeting() {
    if (menu_type === 'create') {
        return create_save.first_message ?? '';
    }
    const character = characters[currentChid];
    return character?.first_mes ?? '';
}

/**
 * Sets the main greeting content for the current context.
 * @param {string} content
 */
function setMainGreeting(content) {
    if (menu_type === 'create') {
        create_save.first_message = content;
    } else {
        const character = characters[currentChid];
        if (character) {
            character.first_mes = content;
        }
    }

    // Also update the character panel textarea if it exists
    const charPanelTextarea = document.querySelector('#firstmessage_textarea');
    if (charPanelTextarea instanceof HTMLTextAreaElement) {
        charPanelTextarea.value = content;
    }
}

/**
 * Initializes greeting states from character data and existing metadata.
 */
function initializeGreetingStates() {
    const greetings = getGreetingsArray();
    const metadata = getGreetingToolsData({ chid: currentChid });

    // Initialize main greeting state
    const mainContent = getMainGreeting();
    const mainContentHash = getStringHash(mainContent);
    const mainMeta = metadata.mainGreeting ?? {};

    mainGreetingState = {
        id: mainMeta.id ?? generateGreetingId(),
        content: mainContent,
        title: mainMeta.title ?? '',
        description: mainMeta.description ?? '',
        contentHash: mainContentHash,
    };

    // Initialize alternate greeting states
    greetingStates = [];

    for (let i = 0; i < greetings.length; i++) {
        const content = greetings[i];
        const contentHash = getStringHash(content);

        // Try to find existing metadata by content hash
        let matchedId = null;
        let matchedTitle = '';
        let matchedDescription = '';

        for (const [gId, meta] of Object.entries(metadata.greetings)) {
            if (meta.contentHash === contentHash) {
                matchedId = gId;
                matchedTitle = meta.title ?? '';
                matchedDescription = meta.description ?? '';
                break;
            }
        }

        greetingStates.push({
            id: matchedId ?? generateGreetingId(),
            content,
            title: matchedTitle,
            description: matchedDescription,
            contentHash,
        });
    }
}

/**
 * Saves all greeting states to character metadata.
 * @returns {Promise<void>}
 */
async function saveAllMetadata() {
    if (currentChid === undefined || menu_type === 'create') return;

    const data = {
        greetings: /** @type {{ [id: string]: { id: string, title: string, description: string, contentHash: number } }} */ ({}),
        indexMap: /** @type {{ [index: number]: string }} */ ({}),
        mainGreeting: /** @type {{ id: string, title: string, description: string, contentHash: number } | null} */ (null),
    };

    // Save main greeting metadata
    if (mainGreetingState) {
        data.mainGreeting = {
            id: mainGreetingState.id,
            title: mainGreetingState.title,
            description: mainGreetingState.description,
            contentHash: mainGreetingState.contentHash,
        };
    }

    // Save alternate greetings metadata
    for (let i = 0; i < greetingStates.length; i++) {
        const state = greetingStates[i];
        data.greetings[state.id] = {
            id: state.id,
            title: state.title,
            description: state.description,
            contentHash: state.contentHash,
        };
        data.indexMap[i] = state.id;
    }

    await saveGreetingToolsData(data, { chid: currentChid });
}

/**
 * Debounced version of saveAllMetadata for automatic saving on changes.
 */
const saveAllMetadataDebounced = debounce(saveAllMetadata, debounce_timeout.relaxed);

/**
 * Syncs greeting content back to character data.
 */
function syncGreetingsToCharacter() {
    const greetings = greetingStates.map(s => s.content);
    setGreetingsArray(greetings);
}

/**
 * Updates the hint visibility based on greeting count.
 * @param {HTMLElement} container
 */
function updateHintVisibility(container) {
    const hint = container.querySelector('.greeting-tools-hint');
    if (hint instanceof HTMLElement) {
        hint.style.display = greetingStates.length === 0 ? '' : 'none';
    }
}

/**
 * Updates the title and description display for a greeting block.
 * @param {HTMLElement} block
 * @param {GreetingState} state
 * @param {number} index
 */
function updateBlockTitle(block, state, index) {
    const titleSpan = block.querySelector('.greeting-tools-title');
    const indexSpan = block.querySelector('.greeting_index');
    const descSpan = block.querySelector('.greeting-tools-description');

    if (titleSpan instanceof HTMLElement && indexSpan instanceof HTMLElement) {
        const displayIndex = index + 1;
        if (state.title) {
            titleSpan.textContent = `${state.title} `;
            indexSpan.innerHTML = `<span class="greeting-tools-index">(#${displayIndex})</span>`;
        } else {
            titleSpan.textContent = 'Alternate Greeting #';
            indexSpan.textContent = String(displayIndex);
        }
    }

    if (descSpan instanceof HTMLElement) {
        descSpan.textContent = state.description || '';
        descSpan.style.display = state.description ? '' : 'none';
    }
}

/**
 * Re-renders all block indices and titles.
 * @param {HTMLElement} list
 */
function refreshAllBlocks(list) {
    const blocks = list.querySelectorAll('.greeting-tools-block');
    blocks.forEach((block, index) => {
        if (!(block instanceof HTMLElement)) return;
        const state = greetingStates[index];
        if (state) {
            block.dataset.greetingId = state.id;
            updateBlockTitle(block, state, index);
        }
    });
}

/**
 * Creates a greeting block element.
 * @param {GreetingState} state
 * @param {number} index
 * @param {HTMLElement} list
 * @returns {HTMLElement}
 */
function createGreetingBlock(state, index, list) {
    if (!blockTemplateElement) {
        throw new Error('Block template not loaded');
    }

    const block = /** @type {HTMLElement} */ (blockTemplateElement.cloneNode(true));
    block.dataset.greetingId = state.id;

    // Set title
    updateBlockTitle(block, state, index);

    // Set textarea content
    const textarea = block.querySelector('.greeting-tools-textarea');
    if (textarea instanceof HTMLTextAreaElement) {
        textarea.value = state.content;

        // Update content on change
        textarea.addEventListener('input', () => {
            const stateIndex = greetingStates.findIndex(s => s.id === state.id);
            if (stateIndex !== -1) {
                greetingStates[stateIndex].content = textarea.value;
                greetingStates[stateIndex].contentHash = getStringHash(textarea.value);
                syncGreetingsToCharacter();
                saveAllMetadataDebounced();
            }
        });
    }

    // Edit title button
    const editTitleBtn = block.querySelector('.greeting-tools-edit-title');
    if (editTitleBtn) {
        editTitleBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            await handleEditTitle(state.id, list);
        });
    }

    // Expand editor button
    const expandBtn = block.querySelector('.editor_maximize');
    if (expandBtn && textarea instanceof HTMLTextAreaElement) {
        expandBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            // Toggle expand - simple version
            if (textarea.rows === 12) {
                textarea.rows = 30;
                expandBtn.classList.remove('fa-maximize');
                expandBtn.classList.add('fa-minimize');
            } else {
                textarea.rows = 12;
                expandBtn.classList.remove('fa-minimize');
                expandBtn.classList.add('fa-maximize');
            }
        });
    }

    // Move up button
    // Remove ST's class to prevent greying on first item (we handle swap with main)
    const moveUpBtn = block.querySelector('.greeting-tools-move-up');
    if (moveUpBtn instanceof HTMLElement) {
        moveUpBtn.classList.remove('move_up_alternate_greeting');
        moveUpBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            handleMove(state.id, -1, list);
        });
    }

    // Move down button
    // Remove ST's class to prevent greying on last item
    const moveDownBtn = block.querySelector('.greeting-tools-move-down');
    if (moveDownBtn instanceof HTMLElement) {
        moveDownBtn.classList.remove('move_down_alternate_greeting');
        moveDownBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            handleMove(state.id, 1, list);
        });
    }

    // Delete button
    const deleteBtn = block.querySelector('.greeting-tools-delete');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            await handleDelete(state.id, list);
        });
    }

    return block;
}

/**
 * Handles editing a greeting title and description.
 * @param {string} greetingId
 * @param {HTMLElement} list
 */
async function handleEditTitle(greetingId, list) {
    const stateIndex = greetingStates.findIndex(s => s.id === greetingId);
    if (stateIndex === -1) return;

    const state = greetingStates[stateIndex];

    const content = document.createElement('div');
    content.innerHTML = `
        <h3 data-i18n="Edit Greeting Details">Edit Greeting Details</h3>
        <p data-i18n="Give this greeting a memorable title and optional description.">Give this greeting a memorable title and optional description.</p>
    `;

    const popup = new Popup(content, POPUP_TYPE.INPUT, state.title, {
        rows: 1,
        customInputs: [
            {
                id: 'greeting-description-input',
                label: t`Description` + ' / ' + t`Summary`,
                type: 'textarea',
                rows: 3,
                defaultState: state.description,
                tooltip: t`Optional description or summary`,
            },
        ],
    });

    const result = await popup.show();

    // For POPUP_TYPE.INPUT: result is input string on confirm, false on negative, null on cancel
    if (typeof result === 'string') {
        state.title = result.trim();
        state.description = String(popup.inputResults?.get('greeting-description-input') ?? '').trim();
        refreshAllBlocks(list);
        saveAllMetadataDebounced();
    }
}

/**
 * Handles moving a greeting up or down.
 * @param {string} greetingId
 * @param {number} direction - -1 for up, 1 for down
 * @param {HTMLElement} list
 */
function handleMove(greetingId, direction, list) {
    const index = greetingStates.findIndex(s => s.id === greetingId);
    if (index === -1) return;

    const newIndex = index + direction;

    // Special case: moving first alt greeting up swaps with main greeting
    if (index === 0 && direction === -1 && mainGreetingState) {
        swapMainWithFirstAlt(list);
        return;
    }

    if (newIndex < 0 || newIndex >= greetingStates.length) return;

    // Swap in state array
    [greetingStates[index], greetingStates[newIndex]] = [greetingStates[newIndex], greetingStates[index]];

    // Sync to character
    syncGreetingsToCharacter();
    saveAllMetadataDebounced();

    // Re-render the list
    renderGreetingsList(list);
}

/**
 * Swaps the main greeting with the first alternate greeting.
 * @param {HTMLElement} list
 */
function swapMainWithFirstAlt(list) {
    if (!mainGreetingState || greetingStates.length === 0) return;

    // Swap state objects
    const oldMain = mainGreetingState;
    const oldFirstAlt = greetingStates[0];

    mainGreetingState = oldFirstAlt;
    greetingStates[0] = oldMain;

    // Sync content to character data
    setMainGreeting(mainGreetingState.content);
    syncGreetingsToCharacter();
    saveAllMetadataDebounced();

    // Re-render both sections
    renderMainGreeting();
    renderGreetingsList(list);
}

/**
 * Handles editing the main greeting title and description.
 */
async function handleEditMainTitle() {
    if (!mainGreetingState) return;

    const content = document.createElement('div');
    content.innerHTML = `
        <h3 data-i18n="Edit Greeting Details">Edit Greeting Details</h3>
        <p data-i18n="Give this greeting a memorable title and optional description.">Give this greeting a memorable title and optional description.</p>
    `;

    const popup = new Popup(content, POPUP_TYPE.INPUT, mainGreetingState.title, {
        rows: 1,
        customInputs: [
            {
                id: 'greeting-description-input',
                label: t`Description` + ' / ' + t`Summary`,
                type: 'textarea',
                rows: 3,
                defaultState: mainGreetingState.description,
                tooltip: t`Optional description or summary`,
            },
        ],
    });

    const result = await popup.show();

    // For POPUP_TYPE.INPUT: result is input string on confirm, false on negative, null on cancel
    if (typeof result === 'string') {
        mainGreetingState.title = result.trim();
        mainGreetingState.description = String(popup.inputResults?.get('greeting-description-input') ?? '').trim();
        renderMainGreeting();
        saveAllMetadataDebounced();
    }
}

/**
 * Creates and renders the main greeting block.
 */
function renderMainGreeting() {
    if (!popupTemplate || !mainGreetingState || !blockTemplateElement) return;

    const container = popupTemplate.querySelector('.greeting-tools-main-container');
    if (!(container instanceof HTMLElement)) return;

    // Clear existing content
    container.innerHTML = '';

    // Clone the block template
    const block = /** @type {HTMLElement} */ (blockTemplateElement.cloneNode(true));
    block.classList.add('greeting-tools-main-block');
    block.dataset.greetingId = mainGreetingState.id;

    // Update title display
    const titleSpan = block.querySelector('.greeting-tools-title');
    const indexSpan = block.querySelector('.greeting_index');
    const descSpan = block.querySelector('.greeting-tools-description');

    if (titleSpan instanceof HTMLElement && indexSpan instanceof HTMLElement) {
        if (mainGreetingState.title) {
            titleSpan.textContent = mainGreetingState.title;
            indexSpan.textContent = '';
        } else {
            titleSpan.textContent = t`Main Greeting`;
            indexSpan.textContent = '';
        }
    }

    if (descSpan instanceof HTMLElement) {
        descSpan.textContent = mainGreetingState.description || '';
        descSpan.style.display = mainGreetingState.description ? '' : 'none';
    }

    // Set textarea content
    const textarea = block.querySelector('.greeting-tools-textarea');
    if (textarea instanceof HTMLTextAreaElement) {
        textarea.value = mainGreetingState.content;

        // Update content on change
        textarea.addEventListener('input', () => {
            if (mainGreetingState) {
                mainGreetingState.content = textarea.value;
                mainGreetingState.contentHash = getStringHash(textarea.value);
                setMainGreeting(mainGreetingState.content);
                saveAllMetadataDebounced();
            }
        });
    }

    // Edit title button
    const editTitleBtn = block.querySelector('.greeting-tools-edit-title');
    if (editTitleBtn) {
        editTitleBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            await handleEditMainTitle();
        });
    }

    // Expand editor button
    const expandBtn = block.querySelector('.editor_maximize');
    if (expandBtn && textarea instanceof HTMLTextAreaElement) {
        expandBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (textarea.rows === 12) {
                textarea.rows = 30;
                expandBtn.classList.remove('fa-maximize');
                expandBtn.classList.add('fa-minimize');
            } else {
                textarea.rows = 12;
                expandBtn.classList.remove('fa-minimize');
                expandBtn.classList.add('fa-maximize');
            }
        });
    }

    // Move up button - make invisible but keep space (for alignment)
    const moveUpBtn = block.querySelector('.greeting-tools-move-up');
    if (moveUpBtn instanceof HTMLElement) {
        moveUpBtn.style.visibility = 'hidden';
    }

    // Move down button - swap with first alt greeting
    // Remove ST's greying class and ensure it's clickable
    const moveDownBtn = block.querySelector('.greeting-tools-move-down');
    if (moveDownBtn instanceof HTMLElement) {
        moveDownBtn.classList.remove('move_down_alternate_greeting');
        moveDownBtn.style.filter = '';
        moveDownBtn.style.opacity = '';
        moveDownBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const list = popupTemplate?.querySelector('.greeting-tools-list');
            if (list instanceof HTMLElement) {
                swapMainWithFirstAlt(list);
            }
        });
    }

    // Delete button - hide but keep space for alignment
    const deleteBtn = block.querySelector('.greeting-tools-delete');
    if (deleteBtn instanceof HTMLElement) {
        deleteBtn.style.visibility = 'hidden';
    }

    container.appendChild(block);
}

/**
 * Handles deleting a greeting.
 * @param {string} greetingId
 * @param {HTMLElement} list
 */
async function handleDelete(greetingId, list) {
    const confirm = await Popup.show.confirm(
        t`Delete Greeting`,
        t`Are you sure you want to delete this alternate greeting?`,
    );

    if (!confirm) return;

    const index = greetingStates.findIndex(s => s.id === greetingId);
    if (index === -1) return;

    // Remove from state
    greetingStates.splice(index, 1);

    // Sync to character
    syncGreetingsToCharacter();
    saveAllMetadataDebounced();

    // Re-render the list
    renderGreetingsList(list);
}

/**
 * Handles adding a new greeting.
 * @param {HTMLElement} list
 */
function handleAdd(list) {
    const newState = {
        id: generateGreetingId(),
        content: '',
        title: '',
        description: '',
        contentHash: getStringHash(''),
    };

    greetingStates.push(newState);
    syncGreetingsToCharacter();
    saveAllMetadataDebounced();

    // Append the new block
    const block = createGreetingBlock(newState, greetingStates.length - 1, list);
    list.appendChild(block);

    updateHintVisibility(list);

    // Scroll to bottom
    list.scrollTop = list.scrollHeight;

    // Focus the textarea
    const textarea = block.querySelector('.greeting-tools-textarea');
    if (textarea instanceof HTMLTextAreaElement) {
        textarea.focus();
    }
}

/**
 * Renders all greetings in the list.
 * @param {HTMLElement} list
 */
function renderGreetingsList(list) {
    // Clear existing blocks (but keep the hint)
    const blocks = list.querySelectorAll('.greeting-tools-block');
    blocks.forEach(block => block.remove());

    // Render all greetings
    for (let i = 0; i < greetingStates.length; i++) {
        const block = createGreetingBlock(greetingStates[i], i, list);
        list.appendChild(block);
    }

    updateHintVisibility(list);
}

/**
 * Opens the greeting tools popup.
 * @param {string} chid - Character ID
 */
export async function openGreetingToolsPopup(chid) {
    currentChid = chid;

    // Ensure character has alternate_greetings array
    if (menu_type !== 'create' && characters[chid]) {
        if (!Array.isArray(characters[chid].data?.alternate_greetings)) {
            characters[chid].data.alternate_greetings = [];
        }
    }

    // Initialize states from character data
    initializeGreetingStates();

    // Load templates
    const popupHtml = await renderExtensionTemplateAsync(`third-party/${EXTENSION_NAME}`, 'greeting-tools-popup');
    const blockHtml = await renderExtensionTemplateAsync(`third-party/${EXTENSION_NAME}`, 'greeting-block');

    // Create template element for block cloning
    const blockContainer = document.createElement('div');
    blockContainer.innerHTML = blockHtml;
    blockTemplateElement = /** @type {HTMLElement} */ (blockContainer.firstElementChild);

    // Create popup template
    const templateContainer = document.createElement('div');
    templateContainer.innerHTML = popupHtml;
    popupTemplate = /** @type {HTMLElement} */ (templateContainer.firstElementChild);

    if (!popupTemplate) {
        console.error('[GreetingTools] Failed to load popup template');
        return;
    }

    const list = popupTemplate.querySelector('.greeting-tools-list');
    if (!(list instanceof HTMLElement)) {
        console.error('[GreetingTools] Failed to find greeting list');
        return;
    }

    // Render main greeting
    renderMainGreeting();

    // Render alternate greetings
    renderGreetingsList(list);

    // Add button handler
    const addBtn = popupTemplate.querySelector('.greeting-tools-add');
    if (addBtn) {
        addBtn.addEventListener('click', () => handleAdd(list));
    }

    // Create and show popup
    currentPopup = new Popup(popupTemplate, POPUP_TYPE.TEXT, '', {
        wide: true,
        large: true,
        allowVerticalScrolling: true,
        onClose: async () => {
            // Save metadata on close
            await saveAllMetadata();

            // Save character if not in create mode
            if (menu_type !== 'create') {
                await createOrEditCharacter();
            }

            // Cleanup
            currentPopup = null;
            popupTemplate = null;
            blockTemplateElement = null;
            greetingStates = [];
            mainGreetingState = null;
            currentChid = undefined;
        },
    });

    await currentPopup.show();
}

/**
 * Updates the button text and tooltip to reflect the extension's functionality.
 */
function updateButtonAppearance() {
    const buttons = document.querySelectorAll('.open_alternate_greetings');
    buttons.forEach(button => {
        // Update tooltip
        button.setAttribute('title', t`Manage greetings - edit titles, descriptions, and reorder`);

        // Update button text
        const textSpan = button.querySelector('span');
        if (textSpan) {
            textSpan.textContent = t`Greeting Tools`;
            textSpan.dataset.i18n = 'Greeting Tools';
        }
    });
}

/**
 * Sets up the button intercept to replace ST's popup with ours.
 */
export function setupButtonIntercept() {
    // Update button appearance on load
    updateButtonAppearance();

    // Also update when DOM changes (for dynamically loaded buttons)
    // const observer = new MutationObserver(() => updateButtonAppearance());
    // observer.observe(document.body, { childList: true, subtree: true });

    // Use event delegation with capture to intercept before ST's handler
    document.addEventListener('click', (e) => {
        const target = e.target;
        if (!(target instanceof Element)) return;

        const button = target.closest('.open_alternate_greetings');
        if (!button) return;

        // Prevent ST's handler
        e.stopImmediatePropagation();
        e.preventDefault();

        // Get character ID
        const chidAttr = $(button).data('chid');
        const chid = chidAttr !== undefined ? String(chidAttr) : undefined;

        if (chid !== undefined || menu_type === 'create') {
            openGreetingToolsPopup(chid);
        }
    }, true); // Capture phase
}
