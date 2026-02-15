import { characters, menu_type, create_save, createOrEditCharacter } from '../../../../script.js';
import { renderExtensionTemplateAsync } from '../../../extensions.js';
import { Popup, POPUP_TYPE } from '../../../popup.js';
import { t } from '../../../i18n.js';
import {
    getGreetingToolsData,
    saveGreetingToolsData,
    generateGreetingId,
} from './data-storage.js';
import { getStringHash } from '/scripts/utils.js';
import { EXTENSION_NAME } from './index.js';

/**
 * @typedef {Object} GreetingState
 * @property {string} id - Unique greeting ID
 * @property {string} content - Greeting content
 * @property {string} title - Custom title
 * @property {number} contentHash - Hash of content
 */

/** @type {GreetingState[]} */
let greetingStates = [];

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
 * Initializes greeting states from character data and existing metadata.
 */
function initializeGreetingStates() {
    const greetings = getGreetingsArray();
    const metadata = getGreetingToolsData({ chid: currentChid });

    greetingStates = [];

    for (let i = 0; i < greetings.length; i++) {
        const content = greetings[i];
        const contentHash = getStringHash(content);

        // Try to find existing metadata by content hash
        let matchedId = null;
        let matchedTitle = '';

        for (const [gId, meta] of Object.entries(metadata.greetings)) {
            if (meta.contentHash === contentHash) {
                matchedId = gId;
                matchedTitle = meta.title ?? '';
                break;
            }
        }

        greetingStates.push({
            id: matchedId ?? generateGreetingId(),
            content,
            title: matchedTitle,
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
        greetings: /** @type {{ [id: string]: { title: string, contentHash: number } }} */ ({}),
        indexMap: /** @type {{ [index: number]: string }} */ ({}),
    };

    for (let i = 0; i < greetingStates.length; i++) {
        const state = greetingStates[i];
        data.greetings[state.id] = {
            title: state.title,
            contentHash: state.contentHash,
        };
        data.indexMap[i] = state.id;
    }

    await saveGreetingToolsData(data, { chid: currentChid });
}

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
 * Updates the title display for a greeting block.
 * @param {HTMLElement} block
 * @param {GreetingState} state
 * @param {number} index
 */
function updateBlockTitle(block, state, index) {
    const titleSpan = block.querySelector('.greeting-tools-title');
    const indexSpan = block.querySelector('.greeting_index');
    if (!(titleSpan instanceof HTMLElement) || !(indexSpan instanceof HTMLElement)) return;

    const displayIndex = index + 1;
    if (state.title) {
        titleSpan.textContent = `${state.title} `;
        indexSpan.innerHTML = `<span class="greeting-tools-index">(#${displayIndex})</span>`;
    } else {
        titleSpan.textContent = 'Alternate Greeting #';
        indexSpan.textContent = String(displayIndex);
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
    const moveUpBtn = block.querySelector('.greeting-tools-move-up');
    if (moveUpBtn) {
        moveUpBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            handleMove(state.id, -1, list);
        });
    }

    // Move down button
    const moveDownBtn = block.querySelector('.greeting-tools-move-down');
    if (moveDownBtn) {
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
 * Handles editing a greeting title.
 * @param {string} greetingId
 * @param {HTMLElement} list
 */
async function handleEditTitle(greetingId, list) {
    const stateIndex = greetingStates.findIndex(s => s.id === greetingId);
    if (stateIndex === -1) return;

    const state = greetingStates[stateIndex];
    const result = await Popup.show.input(
        'Edit Greeting Title',
        'Give this greeting a memorable title to help identify it.',
        state.title,
    );

    if (result !== null) {
        state.title = result.trim();
        refreshAllBlocks(list);
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
    if (newIndex < 0 || newIndex >= greetingStates.length) return;

    // Swap in state array
    [greetingStates[index], greetingStates[newIndex]] = [greetingStates[newIndex], greetingStates[index]];

    // Sync to character
    syncGreetingsToCharacter();

    // Re-render the list
    renderGreetingsList(list);
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
        contentHash: getStringHash(''),
    };

    greetingStates.push(newState);
    syncGreetingsToCharacter();

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

    // Render greetings
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
            currentChid = undefined;
        },
    });

    await currentPopup.show();
}

/**
 * Sets up the button intercept to replace ST's popup with ours.
 */
export function setupButtonIntercept() {
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
