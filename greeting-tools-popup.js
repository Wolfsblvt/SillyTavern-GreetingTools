import { characters, menu_type, create_save, createOrEditCharacter } from '../../../../script.js';
import { renderExtensionTemplateAsync } from '../../../extensions.js';
import { Popup, POPUP_TYPE } from '../../../popup.js';
import { t } from '../../../i18n.js';
import { debounce, flashHighlight, getStringHash } from '../../../utils.js';
import { debounce_timeout } from '../../../constants.js';
import { EXTENSION_NAME } from './index.js';
import { generateGreetingId, getGreetingToolsData, saveGreetingToolsData } from './greeting-tools.js';

/** @typedef {import('./greeting-tools.js').GreetingToolsData} GreetingToolsData */

/**
 * @typedef {Object} GreetingEditorState
 * @property {string} id - Unique greeting ID
 * @property {string} content - Greeting content (actual message text)
 * @property {string} title - Custom title for display
 * @property {string} description - Optional description/summary
 * @property {number} contentHash - Hash of content for change detection
 */

/**
 * @typedef {Object} OpenPopupOptions
 * @property {number} [highlightSwipeIndex] - Swipe index to highlight (0 = main, 1+ = alternate)
 */

/**
 * Class that manages the Greeting Tools popup UI.
 * Encapsulates all popup state, rendering, and event handling.
 */
export class GreetingToolsPopup {
    /** @type {string} */
    #chid;

    /** @type {Popup | null} */
    #popup = null;

    /** @type {HTMLElement | null} */
    #template = null;

    /** @type {HTMLElement | null} */
    #blockTemplate = null;

    /** @type {GreetingEditorState[]} */
    #altStates = [];

    /** @type {GreetingEditorState | null} */
    #mainState = null;

    /** @type {() => Promise<void>} */
    #saveDebounced;

    /** @type {number | undefined} */
    #highlightSwipeIndex;

    /**
     * @returns {Character}
     */
    get #character() {
        return characters[this.#chid];
    }

    /**
     * @param {string} chid - Character ID
     * @param {OpenPopupOptions} [options={}] - Options object
     */
    constructor(chid, options = {}) {
        if (chid === undefined || !characters[chid]) {
            throw new Error('GreetingToolsPopup requires a valid character ID');
        }
        this.#chid = chid;
        this.#highlightSwipeIndex = options.highlightSwipeIndex;
        this.#saveDebounced = /** @type {() => Promise<void>} */ (debounce(() => this.#saveAllMetadata(), debounce_timeout.relaxed));
    }

    /**
     * Opens and shows the popup.
     * @returns {Promise<void>}
     */
    async show() {
        // Ensure character has alternate_greetings array
        if (menu_type !== 'create' && this.#chid !== undefined && this.#character) {
            if (!Array.isArray(this.#character.data?.alternate_greetings)) {
                this.#character.data.alternate_greetings = [];
            }
        }

        // Initialize states from character data
        this.#initializeStates();

        // Load templates
        await this.#loadTemplates();

        if (!this.#template) {
            console.error('[GreetingTools] Failed to load popup template');
            return;
        }

        const list = this.#template.querySelector('.greeting-tools-list');
        if (!(list instanceof HTMLElement)) {
            console.error('[GreetingTools] Failed to find greeting list');
            return;
        }

        // Render UI
        this.#renderMainGreeting();
        this.#renderGreetingsList(list);
        this.#updateInfoLine();

        // Setup toolbar handlers
        this.#setupToolbarHandlers(list);

        // Create and show popup
        this.#popup = new Popup(this.#template, POPUP_TYPE.TEXT, '', {
            wide: true,
            large: true,
            allowVerticalScrolling: true,
            onClose: async () => {
                await this.#onClose();
            },
        });

        // Handle highlighting if requested
        if (this.#highlightSwipeIndex !== undefined) {
            this.#highlightGreeting(this.#highlightSwipeIndex, list);
        }

        await this.#popup.show();
    }

    /**
     * Highlights a specific greeting block and focuses its textarea.
     * @param {number} swipeIndex - Swipe index (0 = main, 1+ = alternate)
     * @param {HTMLElement} list - The greetings list element
     */
    #highlightGreeting(swipeIndex, list) {
        // Small delay to ensure DOM is fully rendered
        setTimeout(() => {
            let targetBlock;
            let targetTextarea;

            if (swipeIndex === 0) {
                // Main greeting
                targetBlock = this.#template?.querySelector('.greeting-tools-main-block');
                targetTextarea = targetBlock?.querySelector('textarea');
            } else {
                // Alternate greeting (swipe index 1 = array index 0)
                // Exclude main block from the query
                const altIndex = swipeIndex - 1;
                const blocks = list.querySelectorAll('.greeting-tools-block:not(.greeting-tools-main-block) details');
                if (altIndex >= 0 && altIndex < blocks.length) {
                    targetBlock = blocks[altIndex];
                    targetTextarea = targetBlock?.querySelector('textarea');
                }
            }

            if (targetBlock instanceof HTMLElement) {
                // Expand if it's a details element
                if (targetBlock instanceof HTMLDetailsElement) {
                    targetBlock.open = true;
                }

                // Scroll into view
                targetBlock.scrollIntoView({ behavior: 'smooth', block: 'center' });

                // Flash highlight - target the parent block for better visual
                const blockToHighlight = /** @type {HTMLElement} */ (targetBlock.closest('.greeting-tools-block') ?? targetBlock);
                flashHighlight($(blockToHighlight));

                // Focus textarea after a small delay for smooth UX
                if (targetTextarea instanceof HTMLTextAreaElement) {
                    setTimeout(() => {
                        targetTextarea.focus();
                        targetTextarea.setSelectionRange(0, 0);
                    }, 50);
                }
            }
        }, 100);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Character Data Access
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Gets the alternate greetings array for the current context.
     * @returns {string[]}
     */
    #getGreetingsArray() {
        if (menu_type === 'create') {
            return create_save.alternate_greetings;
        }
        return this.#character.data.alternate_greetings ?? [];
    }

    /**
     * Sets the alternate greetings array for the current context.
     * @param {string[]} greetings
     */
    #setGreetingsArray(greetings) {
        if (menu_type === 'create') {
            create_save.alternate_greetings = greetings;
        } else {
            this.#character.data.alternate_greetings = greetings;
        }
    }

    /**
     * Gets the main greeting content for the current context.
     * @returns {string}
     */
    #getMainGreeting() {
        if (menu_type === 'create') {
            return create_save.first_message ?? '';
        }
        return this.#character.first_mes ?? '';
    }

    /**
     * Sets the main greeting content for the current context.
     * @param {string} content
     */
    #setMainGreeting(content) {
        if (menu_type === 'create') {
            create_save.first_message = content;
        } else {
            this.#character.first_mes = content;
        }

        // Also update the character panel textarea if it exists
        const charPanelTextarea = document.querySelector('#firstmessage_textarea');
        if (charPanelTextarea instanceof HTMLTextAreaElement) {
            charPanelTextarea.value = content;
        }
    }

    /**
     * Syncs greeting content back to character data.
     */
    #syncGreetingsToCharacter() {
        const greetings = this.#altStates.map(s => s.content);
        this.#setGreetingsArray(greetings);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // State Initialization & Persistence
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Initializes editor states from character data and existing metadata.
     */
    #initializeStates() {
        const greetings = this.#getGreetingsArray();
        const metadata = getGreetingToolsData({ chid: this.#chid });

        // Initialize main greeting state
        const mainContent = this.#getMainGreeting();
        const mainContentHash = getStringHash(mainContent);
        const mainMeta = metadata.mainGreeting ?? {};

        this.#mainState = {
            id: mainMeta.id ?? generateGreetingId(),
            content: mainContent,
            title: mainMeta.title ?? '',
            description: mainMeta.description ?? '',
            contentHash: mainContentHash,
        };

        // Initialize alternate greeting states
        this.#altStates = [];

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

            this.#altStates.push({
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
    async #saveAllMetadata() {
        // Don't save if we are in char creation mode
        if (menu_type === 'create') return;

        /** @type {GreetingToolsData} */
        const data = {
            greetings: {},
            indexMap: {},
            mainGreeting: null,
        };

        // Save main greeting metadata
        if (this.#mainState) {
            data.mainGreeting = {
                id: this.#mainState.id,
                title: this.#mainState.title,
                description: this.#mainState.description,
                contentHash: this.#mainState.contentHash,
            };
        }

        // Save alternate greetings metadata
        for (let i = 0; i < this.#altStates.length; i++) {
            const state = this.#altStates[i];
            data.greetings[state.id] = {
                id: state.id,
                title: state.title,
                description: state.description,
                contentHash: state.contentHash,
            };
            data.indexMap[i] = state.id;
        }

        await saveGreetingToolsData(data, { chid: this.#chid });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Template Loading
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Loads the HTML templates for popup and greeting block.
     */
    async #loadTemplates() {
        const popupHtml = await renderExtensionTemplateAsync(`third-party/${EXTENSION_NAME}`, 'greeting-tools-popup');
        const blockHtml = await renderExtensionTemplateAsync(`third-party/${EXTENSION_NAME}`, 'greeting-block');

        // Create template element for block cloning
        const blockContainer = document.createElement('div');
        blockContainer.innerHTML = blockHtml;
        this.#blockTemplate = /** @type {HTMLElement} */ (blockContainer.firstElementChild);

        // Create popup template
        const templateContainer = document.createElement('div');
        templateContainer.innerHTML = popupHtml;
        this.#template = /** @type {HTMLElement} */ (templateContainer.firstElementChild);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // UI Rendering
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Updates the info line showing greeting counts.
     */
    #updateInfoLine() {
        if (!this.#template) return;
        const countSpan = this.#template.querySelector('.greeting-tools-count');
        if (countSpan instanceof HTMLElement) {
            const altCount = this.#altStates.length;
            countSpan.textContent = t`1 main greeting and ${altCount} alternate greeting${altCount !== 1 ? 's' : ''}`;
        }
    }

    /**
     * Updates the hint visibility based on greeting count.
     * @param {HTMLElement} container
     */
    #updateHintVisibility(container) {
        const hint = container.querySelector('.greeting-tools-hint');
        if (hint instanceof HTMLElement) {
            hint.style.display = this.#altStates.length === 0 ? '' : 'none';
        }
    }

    /**
     * Updates the title and description display for a greeting block.
     * @param {HTMLElement} block
     * @param {GreetingEditorState} state
     * @param {{ index?: number, isMain?: boolean }} [options={}]
     */
    #updateBlockTitle(block, state, { index = -1, isMain = false } = {}) {
        const titleSpan = block.querySelector('.greeting-tools-title');
        const indexSpan = block.querySelector('.greeting_index');
        const descSpan = block.querySelector('.greeting-tools-description');

        if (titleSpan instanceof HTMLElement && indexSpan instanceof HTMLElement) {
            if (isMain) {
                titleSpan.textContent = state.title || t`Main Greeting`;
                indexSpan.textContent = '';
            } else {
                const displayIndex = index + 1;
                if (state.title) {
                    titleSpan.textContent = state.title;
                    indexSpan.innerHTML = `<span class="greeting-tools-index">(#${displayIndex})</span>`;
                } else {
                    titleSpan.textContent = 'Alternate Greeting #';
                    indexSpan.textContent = String(displayIndex);
                }
            }
        }

        if (descSpan instanceof HTMLElement) {
            descSpan.textContent = state.description || '';
            descSpan.title = state.description || '';
            descSpan.style.display = state.description ? '' : 'none';
        }
    }

    /**
     * Re-renders all block indices and titles.
     * @param {HTMLElement} list
     */
    #refreshAllBlocks(list) {
        const blocks = list.querySelectorAll('.greeting-tools-block');
        blocks.forEach((block, index) => {
            if (!(block instanceof HTMLElement)) return;
            const state = this.#altStates[index];
            if (state) {
                block.dataset.greetingId = state.id;
                this.#updateBlockTitle(block, state, { index });
            }
        });
    }

    /**
     * Updates move button disabled states for all blocks.
     * @param {HTMLElement} list
     */
    #updateMoveButtonStates(list) {
        const blocks = list.querySelectorAll('.greeting-tools-block');
        blocks.forEach((block, index) => {
            if (!(block instanceof HTMLElement)) return;
            const moveDownBtn = block.querySelector('.greeting-tools-move-down');
            if (moveDownBtn instanceof HTMLElement) {
                // Disable move-down on last item
                if (index === blocks.length - 1) {
                    moveDownBtn.classList.add('greeting-tools-btn-disabled');
                } else {
                    moveDownBtn.classList.remove('greeting-tools-btn-disabled');
                }
            }
        });
    }

    /**
     * Creates and renders the main greeting block.
     */
    #renderMainGreeting() {
        if (!this.#template || !this.#mainState || !this.#blockTemplate) return;

        const container = this.#template.querySelector('.greeting-tools-main-container');
        if (!(container instanceof HTMLElement)) return;

        // Clear existing content
        container.innerHTML = '';

        // Clone the block template
        const block = /** @type {HTMLElement} */ (this.#blockTemplate.cloneNode(true));
        block.classList.add('greeting-tools-main-block');
        block.dataset.greetingId = this.#mainState.id;

        // Update title display
        this.#updateBlockTitle(block, this.#mainState, { isMain: true });

        // Set textarea content and unique ID for expanded editor
        const textarea = block.querySelector('.greeting-tools-textarea');
        if (textarea instanceof HTMLTextAreaElement) {
            const textareaId = `greeting-textarea-${this.#mainState.id}`;
            textarea.id = textareaId;
            textarea.value = this.#mainState.content;

            // Link maximize button to textarea
            const maximizeBtn = block.querySelector('.editor_maximize');
            if (maximizeBtn) {
                maximizeBtn.setAttribute('data-for', textareaId);
            }

            // Update content on change
            textarea.addEventListener('input', () => {
                if (this.#mainState) {
                    this.#mainState.content = textarea.value;
                    this.#mainState.contentHash = getStringHash(textarea.value);
                    this.#setMainGreeting(this.#mainState.content);
                    this.#saveDebounced();
                }
            });
        }

        // Edit title button
        const editTitleBtn = block.querySelector('.greeting-tools-edit-title');
        if (editTitleBtn) {
            editTitleBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (!this.#mainState) return;
                await this.#showEditTitlePopup(this.#mainState, () => this.#renderMainGreeting());
            });
        }

        // Move up button - disabled (greyed out) for main greeting
        const moveUpBtn = block.querySelector('.greeting-tools-move-up');
        if (moveUpBtn instanceof HTMLElement) {
            moveUpBtn.classList.add('greeting-tools-btn-disabled');
        }

        // Move down button - swap with first alt greeting
        const moveDownBtn = block.querySelector('.greeting-tools-move-down');
        if (moveDownBtn instanceof HTMLElement) {
            moveDownBtn.classList.remove('move_down_alternate_greeting');
            moveDownBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const list = this.#template?.querySelector('.greeting-tools-list');
                if (list instanceof HTMLElement) {
                    this.#swapMainWithFirstAlt(list);
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
     * Creates a greeting block element.
     * @param {GreetingEditorState} state
     * @param {number} index
     * @param {HTMLElement} list
     * @returns {HTMLElement}
     */
    #createGreetingBlock(state, index, list) {
        if (!this.#blockTemplate) {
            throw new Error('Block template not loaded');
        }

        const block = /** @type {HTMLElement} */ (this.#blockTemplate.cloneNode(true));
        block.dataset.greetingId = state.id;

        // Set title
        this.#updateBlockTitle(block, state, { index });

        // Set textarea content and unique ID for expanded editor
        const textarea = block.querySelector('.greeting-tools-textarea');
        if (textarea instanceof HTMLTextAreaElement) {
            const textareaId = `greeting-textarea-${state.id}`;
            textarea.id = textareaId;
            textarea.value = state.content;

            // Link maximize button to textarea
            const maximizeBtn = block.querySelector('.editor_maximize');
            if (maximizeBtn) {
                maximizeBtn.setAttribute('data-for', textareaId);
            }

            // Update content on change
            textarea.addEventListener('input', () => {
                const stateIndex = this.#altStates.findIndex(s => s.id === state.id);
                if (stateIndex !== -1) {
                    this.#altStates[stateIndex].content = textarea.value;
                    this.#altStates[stateIndex].contentHash = getStringHash(textarea.value);
                    this.#syncGreetingsToCharacter();
                    this.#saveDebounced();
                }
            });
        }

        // Edit title button
        const editTitleBtn = block.querySelector('.greeting-tools-edit-title');
        if (editTitleBtn) {
            editTitleBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                const clickedState = this.#altStates.find(s => s.id === state.id);
                if (!clickedState) return;
                await this.#showEditTitlePopup(clickedState, () => this.#refreshAllBlocks(list));
            });
        }

        // Move up button
        const moveUpBtn = block.querySelector('.greeting-tools-move-up');
        if (moveUpBtn instanceof HTMLElement) {
            moveUpBtn.classList.remove('move_up_alternate_greeting');
            moveUpBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.#handleMove(state.id, -1, list);
            });
        }

        // Move down button
        const moveDownBtn = block.querySelector('.greeting-tools-move-down');
        if (moveDownBtn instanceof HTMLElement) {
            moveDownBtn.classList.remove('move_down_alternate_greeting');
            moveDownBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.#handleMove(state.id, 1, list);
            });
        }

        // Delete button
        const deleteBtn = block.querySelector('.greeting-tools-delete');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                await this.#handleDelete(state.id, list);
            });
        }

        return block;
    }

    /**
     * Renders all greetings in the list.
     * @param {HTMLElement} list
     */
    #renderGreetingsList(list) {
        // Clear existing alternate blocks (but keep the main greeting and hint)
        const blocks = list.querySelectorAll('.greeting-tools-block:not(.greeting-tools-main-block)');
        blocks.forEach(block => block.remove());

        // Render all greetings
        for (let i = 0; i < this.#altStates.length; i++) {
            const block = this.#createGreetingBlock(this.#altStates[i], i, list);
            list.appendChild(block);
        }

        // Update move button states for last item
        this.#updateMoveButtonStates(list);
        this.#updateHintVisibility(list);
        this.#updateInfoLine();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Event Handlers
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Sets up toolbar button handlers.
     * @param {HTMLElement} list
     */
    #setupToolbarHandlers(list) {
        if (!this.#template) return;

        // Add button handler
        const addBtn = this.#template.querySelector('.greeting-tools-add');
        if (addBtn) {
            addBtn.addEventListener('click', () => this.#handleAdd(list));
        }

        // Expand all button handler
        const expandAllBtn = this.#template.querySelector('.greeting-tools-expand-all');
        if (expandAllBtn) {
            expandAllBtn.addEventListener('click', () => this.#setAllGreetingsExpanded(true));
        }

        // Collapse all button handler
        const collapseAllBtn = this.#template.querySelector('.greeting-tools-collapse-all');
        if (collapseAllBtn) {
            collapseAllBtn.addEventListener('click', () => this.#setAllGreetingsExpanded(false));
        }
    }

    /**
     * Expands or collapses all greeting details.
     * @param {boolean} expand - True to expand, false to collapse
     */
    #setAllGreetingsExpanded(expand) {
        if (!this.#template) return;
        const details = this.#template.querySelectorAll('.greeting-tools-block details');
        details.forEach(detail => {
            if (detail instanceof HTMLDetailsElement) {
                detail.open = expand;
            }
        });
    }

    /**
     * Shows the edit title/description popup for any greeting state.
     * @param {GreetingEditorState} state - The greeting state to edit
     * @param {() => void} onSave - Callback to refresh UI after save
     */
    async #showEditTitlePopup(state, onSave) {
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
            onSave();
            this.#saveDebounced();
        }
    }

    /**
     * Handles moving a greeting up or down.
     * @param {string} greetingId
     * @param {number} direction - -1 for up, 1 for down
     * @param {HTMLElement} list
     */
    #handleMove(greetingId, direction, list) {
        const index = this.#altStates.findIndex(s => s.id === greetingId);
        if (index === -1) return;

        const newIndex = index + direction;

        // Special case: moving first alt greeting up swaps with main greeting
        if (index === 0 && direction === -1 && this.#mainState) {
            this.#swapMainWithFirstAlt(list);
            return;
        }

        if (newIndex < 0 || newIndex >= this.#altStates.length) return;

        // Swap in state array
        [this.#altStates[index], this.#altStates[newIndex]] = [this.#altStates[newIndex], this.#altStates[index]];

        // Sync to character
        this.#syncGreetingsToCharacter();
        this.#saveDebounced();

        // Re-render the list
        this.#renderGreetingsList(list);
    }

    /**
     * Swaps the main greeting with the first alternate greeting.
     * @param {HTMLElement} list
     */
    #swapMainWithFirstAlt(list) {
        if (!this.#mainState || this.#altStates.length === 0) return;

        // Swap state objects
        const oldMain = this.#mainState;
        const oldFirstAlt = this.#altStates[0];

        this.#mainState = oldFirstAlt;
        this.#altStates[0] = oldMain;

        // Sync content to character data
        this.#setMainGreeting(this.#mainState.content);
        this.#syncGreetingsToCharacter();
        this.#saveDebounced();

        // Re-render both sections
        this.#renderMainGreeting();
        this.#renderGreetingsList(list);
    }

    /**
     * Handles deleting a greeting.
     * @param {string} greetingId
     * @param {HTMLElement} list
     */
    async #handleDelete(greetingId, list) {
        const confirm = await Popup.show.confirm(
            t`Delete Greeting`,
            t`Are you sure you want to delete this alternate greeting?`,
        );

        if (!confirm) return;

        const index = this.#altStates.findIndex(s => s.id === greetingId);
        if (index === -1) return;

        // Remove from state
        this.#altStates.splice(index, 1);

        // Sync to character
        this.#syncGreetingsToCharacter();
        this.#saveDebounced();

        // Re-render the list
        this.#renderGreetingsList(list);
    }

    /**
     * Handles adding a new greeting.
     * @param {HTMLElement} list
     */
    #handleAdd(list) {
        const newState = {
            id: generateGreetingId(),
            content: '',
            title: '',
            description: '',
            contentHash: getStringHash(''),
        };

        this.#altStates.push(newState);
        this.#syncGreetingsToCharacter();
        this.#saveDebounced();

        // Append the new block
        const block = this.#createGreetingBlock(newState, this.#altStates.length - 1, list);
        list.appendChild(block);

        // Update UI states
        this.#updateMoveButtonStates(list);
        this.#updateHintVisibility(list);
        this.#updateInfoLine();

        // Scroll to bottom
        list.scrollTop = list.scrollHeight;

        // Focus the textarea
        const textarea = block.querySelector('.greeting-tools-textarea');
        if (textarea instanceof HTMLTextAreaElement) {
            textarea.focus();
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Cleanup
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Handles popup close - saves data and triggers character save.
     */
    async #onClose() {
        // Save metadata on close
        await this.#saveAllMetadata();

        // Save character if not in create mode
        if (menu_type !== 'create') {
            await createOrEditCharacter();
        }

        if (this.#highlightSwipeIndex !== null) {

        }
    }
}
