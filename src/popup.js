import { characters, menu_type, create_save, createOrEditCharacter, chat, swipe, eventSource, event_types } from '../../../../../script.js';
import { SWIPE_DIRECTION } from '../../../../constants.js';
import { renderExtensionTemplateAsync } from '../../../../extensions.js';
import { Popup, POPUP_TYPE, POPUP_RESULT, PopupUtils } from '../../../../popup.js';
import { t } from '../../../../i18n.js';
import { debounce, flashHighlight, getStringHash } from '../../../../utils.js';
import { debounce_timeout } from '../../../../constants.js';
import { EXTENSION_NAME } from '../index.js';
import { findGreetingMetadata, generateGreetingId, getGreetingToolsData, saveGreetingToolsData, updateButtonAppearance, createTempMarker, getTempGreetings, saveTempGreetings, removeTempGreeting } from './data.js';
import { greetingToolsSettings } from './settings.js';
import {
    generateGreetingFlow,
    generateTitleAndDescription,
    textContainsNames,
    replaceNamesWithMacros,
} from './generator.js';

/** @typedef {import('./data.js').GreetingToolsData} GreetingToolsData */

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
 * Uniform context for operating on any greeting type (main, alternate, or temp).
 * Returned by {@link GreetingToolsPopup#resolveGreetingContext} to eliminate type-branching in handlers.
 * @typedef {Object} GreetingContext
 * @property {GreetingEditorState} state - The greeting state
 * @property {'main' | 'alt' | 'temp'} type - The greeting type
 * @property {() => void} syncContent - Syncs content changes to the backing data store
 * @property {() => void | Promise<void>} save - Persists metadata changes
 * @property {(list?: HTMLElement) => void} refreshUI - Refreshes the UI after state changes
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

    /** @type {GreetingEditorState[]} Temporary greetings from chat (not yet saved to character) */
    #tempStates = [];

    /** @type {() => Promise<void>} */
    #saveDebounced;

    /** @type {(block: HTMLElement, content: string) => void} */
    #checkReplaceNamesDebounced;

    /** @type {number | undefined} */
    #highlightSwipeIndex;

    /** @type {Map<string, boolean>} Stores the open/closed state of each greeting by ID */
    #toggleStates = new Map();

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
        this.#checkReplaceNamesDebounced = /** @type {(block: HTMLElement, content: string) => void} */ (debounce(
            (/** @type {HTMLElement} */ block, /** @type {string} */ content) => this.#updateReplaceNamesButton(block, content),
            debounce_timeout.short,
        ));
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

        // Setup keyboard navigation
        this.#setupKeyboardNavigation();

        // Create and show popup
        this.#popup = new Popup(this.#template, POPUP_TYPE.TEXT, '', {
            wide: true,
            large: true,
            allowVerticalScrolling: true,
            allowEscapeClose: true,
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
                // Check if this is a temp greeting
                const tempGreetings = getTempGreetings();
                const tempData = tempGreetings.get(swipeIndex);

                if (tempData) {
                    // Find temp greeting block by greeting ID
                    const block = list.querySelector(`.greeting-tools-block[data-greeting-id="${tempData.id}"]`);
                    if (block) {
                        targetBlock = block.querySelector('details');
                        targetTextarea = block.querySelector('textarea');
                    }
                } else {
                    // Alternate greeting (swipe index 1 = array index 0)
                    const altIndex = swipeIndex - 1;
                    const blocks = list.querySelectorAll('.greeting-tools-block:not(.greeting-tools-main-block):not(.greeting-tools-temp-block) details');
                    if (altIndex >= 0 && altIndex < blocks.length) {
                        targetBlock = blocks[altIndex];
                        targetTextarea = targetBlock?.querySelector('textarea');
                    }
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
            const matchedMeta = findGreetingMetadata(metadata, i, contentHash);

            this.#altStates.push({
                id: matchedMeta?.id ?? generateGreetingId(),
                content,
                title: matchedMeta?.title ?? '',
                description: matchedMeta?.description ?? '',
                contentHash,
            });
        }

        // Load temp greetings from chat metadata
        this.#tempStates = [];
        const tempGreetings = getTempGreetings();
        for (const [, tempData] of tempGreetings) {
            this.#tempStates.push({
                id: tempData.id,
                content: tempData.content,
                title: tempData.title,
                description: tempData.description,
                contentHash: getStringHash(tempData.content),
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

    /**
     * Saves temp greeting state changes back to chat metadata.
     * Persists title, description, and content from the current temp states.
     * @returns {Promise<void>}
     */
    async #saveTempMetadata() {
        const tempGreetings = getTempGreetings();
        for (const tempState of this.#tempStates) {
            for (const [swipeIndex, data] of tempGreetings) {
                if (data.id === tempState.id) {
                    tempGreetings.set(swipeIndex, {
                        ...data,
                        title: tempState.title,
                        description: tempState.description,
                        content: tempState.content,
                    });
                    break;
                }
            }
        }
        await saveTempGreetings(tempGreetings);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Template Loading
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Loads the HTML templates for popup and greeting block.
     */
    async #loadTemplates() {
        const popupHtml = await renderExtensionTemplateAsync(`third-party/${EXTENSION_NAME}`, 'templates/popup');
        const blockHtml = await renderExtensionTemplateAsync(`third-party/${EXTENSION_NAME}`, 'templates/block');

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
            const tempCount = this.#tempStates.length;
            let text = t`1 main greeting and ${altCount} alternate greeting${altCount !== 1 ? 's' : ''}`;
            if (tempCount > 0) {
                text += ` (+ ${tempCount} ${t`temp`})`;
            }
            countSpan.textContent = text;
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
     * @param {object} [options={}]
     * @param {number} [options.index=-1] - Index for alternate greetings
     * @param {boolean} [options.isMain=false] - Whether this is a main greeting
     * @param {boolean} [options.isTemp=false] - Whether this is a temporary greeting
     */
    #updateBlockTitle(block, state, { index = -1, isMain = false, isTemp = false } = {}) {
        const titleSpan = block.querySelector('.greeting-tools-title');
        const indexSpan = block.querySelector('.greeting_index');
        const descSpan = block.querySelector('.greeting-tools-description');

        if (titleSpan instanceof HTMLElement && indexSpan instanceof HTMLElement) {
            if (isMain) {
                titleSpan.textContent = state.title || t`Main Greeting`;
                indexSpan.textContent = '';
            } else if (isTemp) {
                // Temp greetings: show TEMP tag with title or fallback
                const displayTitle = state.title || t`Temporary Greeting`;
                titleSpan.innerHTML = ''; // Clear existing content

                const tempMarker = createTempMarker();
                titleSpan.appendChild(tempMarker);

                const titleText = document.createTextNode(displayTitle);
                titleSpan.appendChild(titleText);

                indexSpan.textContent = '';
            } else {
                const displayIndex = index + 1;
                if (state.title) {
                    titleSpan.textContent = state.title;
                    indexSpan.innerHTML = ''; // Clear existing content

                    const indexSpanContent = document.createElement('span');
                    indexSpanContent.classList.add('greeting-tools-index');
                    indexSpanContent.textContent = `(#${displayIndex})`;
                    indexSpan.appendChild(indexSpanContent);
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
     * Captures the current open/closed state of all greeting details elements.
     */
    #captureToggleStates() {
        if (!this.#template) return;
        const blocks = this.#template.querySelectorAll('.greeting-tools-block');
        blocks.forEach(block => {
            if (!(block instanceof HTMLElement)) return;
            const greetingId = block.dataset.greetingId;
            const details = block.querySelector('details');
            if (greetingId && details instanceof HTMLDetailsElement) {
                this.#toggleStates.set(greetingId, details.open);
            }
        });
    }

    /**
     * Gets the toggle state for a greeting, with fallback to global setting.
     * @param {string} greetingId - The greeting ID
     * @returns {boolean} Whether the details should be open
     */
    #getToggleState(greetingId) {
        if (this.#toggleStates.has(greetingId)) {
            return this.#toggleStates.get(greetingId) ?? true;
        }
        // Default to global setting for greetings without stored state
        return !greetingToolsSettings.collapseByDefault;
    }

    /**
     * Re-renders all alternate greeting block indices and titles.
     * @param {HTMLElement} list
     */
    #refreshAllAltBlocks(list) {
        const blocks = list.querySelectorAll('.greeting-tools-block:not(.greeting-tools-main-block):not(.greeting-tools-temp-block)');
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
     * Refreshes the title and description display for a single greeting block.
     * @param {string} greetingId - The greeting ID to refresh
     * @param {HTMLElement} list - The greetings list element
     */
    #refreshBlockTitle(greetingId, list) {
        const block = list.querySelector(`.greeting-tools-block[data-greeting-id="${greetingId}"]`);
        if (!(block instanceof HTMLElement)) return;

        const ctx = this.#resolveGreetingContext(greetingId);
        if (!ctx) return;

        const isTemp = ctx.type === 'temp';
        const states = isTemp ? this.#tempStates : this.#altStates;
        const index = states.indexOf(ctx.state);
        this.#updateBlockTitle(block, ctx.state, { index, isTemp });
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

        // Capture toggle state before clearing
        this.#captureToggleStates();

        // Clear existing content
        container.innerHTML = '';

        // Clone the block template
        const block = /** @type {HTMLElement} */ (this.#blockTemplate.cloneNode(true));
        block.classList.add('greeting-tools-main-block');
        block.dataset.greetingId = this.#mainState.id;

        // Apply toggle state (preserves user's open/closed choice across re-renders)
        const details = block.querySelector('details');
        if (details instanceof HTMLDetailsElement) {
            details.open = this.#getToggleState(this.#mainState.id);
        }

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
                await this.#showEditTitlePopup(this.#mainState, () => {
                    this.#renderMainGreeting();
                    this.#saveDebounced();
                });
            });
        }

        // Auto-fill button (shortcut for auto-generating title/description)
        const autoFillBtn = block.querySelector('.greeting-tools-auto-fill');
        if (autoFillBtn) {
            autoFillBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (!this.#mainState) return;
                await this.#handleAutoFill(this.#mainState, () => {
                    this.#renderMainGreeting();
                    this.#saveDebounced();
                });
            });
        }

        // Replace names button
        const replaceNamesBtn = block.querySelector('.greeting-tools-replace-names');
        if (replaceNamesBtn) {
            replaceNamesBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (!this.#mainState) return;
                this.#handleReplaceNames(this.#mainState.id, block);
            });
        }

        // Check replace-names button visibility on open and on textarea blur
        this.#updateReplaceNamesButton(block, this.#mainState.content);
        if (textarea instanceof HTMLTextAreaElement) {
            textarea.addEventListener('blur', () => {
                this.#checkReplaceNamesDebounced(block, textarea.value);
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
     * @param {Object} [options={}] - Options for block creation
     * @param {boolean} [options.forceOpen=false] - Whether to force the block open
     * @param {boolean} [options.isTemp=false] - Whether this is a temporary greeting
     * @returns {HTMLElement}
     */
    #createGreetingBlock(state, index, list, { forceOpen = false, isTemp = false } = {}) {
        if (!this.#blockTemplate) {
            throw new Error('Block template not loaded');
        }

        const block = /** @type {HTMLElement} */ (this.#blockTemplate.cloneNode(true));
        block.dataset.greetingId = state.id;

        // Temp greeting styling
        if (isTemp) {
            block.dataset.tempGreeting = 'true';
            block.classList.add('greeting-tools-temp-block');
        }

        // Apply toggle state: forceOpen overrides, then check stored state, then use global setting
        // Temp greetings default to open
        const details = block.querySelector('details');
        if (details instanceof HTMLDetailsElement) {
            details.open = forceOpen ?? this.#getToggleState(state.id) ?? isTemp;
        }

        // Set title (with temp marker if applicable)
        if (isTemp) {
            this.#updateBlockTitle(block, state, { index, isTemp: true });
        } else {
            this.#updateBlockTitle(block, state, { index });
        }

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

            // Update content on change (works for all greeting types via GreetingContext)
            textarea.addEventListener('input', () => {
                const ctx = this.#resolveGreetingContext(state.id);
                if (!ctx) return;
                ctx.state.content = textarea.value;
                ctx.state.contentHash = getStringHash(textarea.value);
                ctx.syncContent();
                ctx.save();
            });
        }

        // Edit title button (works for all greeting types via GreetingContext)
        const editTitleBtn = block.querySelector('.greeting-tools-edit-title');
        if (editTitleBtn instanceof HTMLElement) {
            editTitleBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                const ctx = this.#resolveGreetingContext(state.id);
                if (!ctx) return;
                await this.#showEditTitlePopup(ctx.state, () => {
                    ctx.refreshUI(list);
                    ctx.save();
                });
            });
        }

        // Auto-fill button (works for all greeting types via GreetingContext)
        const autoFillBtn = block.querySelector('.greeting-tools-auto-fill');
        if (autoFillBtn instanceof HTMLElement) {
            autoFillBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                const ctx = this.#resolveGreetingContext(state.id);
                if (!ctx) return;
                await this.#handleAutoFill(ctx.state, () => {
                    ctx.refreshUI(list);
                    ctx.save();
                });
            });
        }

        // Replace names button (works for all greeting types via GreetingContext)
        const replaceNamesBtn = block.querySelector('.greeting-tools-replace-names');
        if (replaceNamesBtn) {
            replaceNamesBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.#handleReplaceNames(state.id, block);
            });
        }

        // Check replace-names button visibility on open and on textarea blur
        this.#updateReplaceNamesButton(block, state.content);
        if (textarea instanceof HTMLTextAreaElement) {
            textarea.addEventListener('blur', () => {
                this.#checkReplaceNamesDebounced(block, textarea.value);
            });
        }

        // Move buttons (save-to-alternates replaces move-up for temp greetings)
        const moveUpBtn = block.querySelector('.greeting-tools-move-up');
        if (moveUpBtn instanceof HTMLElement) {
            if (isTemp) {
                // Repurpose move-up button as save-to-alternates for temp greetings
                moveUpBtn.innerHTML = '';
                const saveIcon = document.createElement('i');
                saveIcon.classList.add('fa-solid', 'fa-save');
                moveUpBtn.appendChild(saveIcon);
                moveUpBtn.title = t`Save to alternates`;
                moveUpBtn.addEventListener('click', async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    await this.#handleSaveTempGreeting(state, list);
                });
            } else {
                moveUpBtn.classList.remove('move_up_alternate_greeting');
                moveUpBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.#handleMove(state.id, -1, list);
                });
            }
        }

        const moveDownBtn = block.querySelector('.greeting-tools-move-down');
        if (moveDownBtn instanceof HTMLElement) {
            if (isTemp) {
                moveDownBtn.style.display = 'none';
            } else {
                moveDownBtn.classList.remove('move_down_alternate_greeting');
                moveDownBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.#handleMove(state.id, 1, list);
                });
            }
        }

        // Delete button
        const deleteBtn = block.querySelector('.greeting-tools-delete');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (isTemp) {
                    await this.#handleDeleteTempGreeting(state, list);
                } else {
                    await this.#handleDelete(state.id, list);
                }
            });
        }

        return block;
    }

    /**
     * Finds the swipe index for a temp greeting by its ID.
     * @param {string} greetingId - The greeting ID to look up
     * @returns {number | undefined} The swipe index or undefined if not found
     */
    #findTempGreetingSwipeIndex(greetingId) {
        const tempGreetings = getTempGreetings();
        for (const [swipeIndex, data] of tempGreetings) {
            if (data.id === greetingId) return swipeIndex;
        }
        return undefined;
    }

    /**
     * Handles saving a temp greeting to character alternates.
     * @param {GreetingEditorState} state
     * @param {HTMLElement} list
     */
    async #handleSaveTempGreeting(state, list) {
        // Add to altStates (already a proper GreetingEditorState)
        this.#altStates.push({ ...state });

        // Sync to character
        this.#syncGreetingsToCharacter();
        await this.#saveAllMetadata();

        // Remove from temp states
        const tempIndex = this.#tempStates.findIndex(s => s.id === state.id);
        if (tempIndex !== -1) {
            this.#tempStates.splice(tempIndex, 1);
        }

        // Remove from chat metadata (look up swipeIndex by ID)
        const swipeIndex = this.#findTempGreetingSwipeIndex(state.id);
        if (swipeIndex !== undefined) {
            await removeTempGreeting(swipeIndex);
        }

        // Re-render
        this.#renderGreetingsList(list);
        this.#updateInfoLine();

        toastr.success(t`Temporary greeting saved to alternates`);
    }

    /**
     * Handles deleting a temp greeting.
     * @param {GreetingEditorState} state
     * @param {HTMLElement} list
     */
    async #handleDeleteTempGreeting(state, list) {
        const confirm = await Popup.show.confirm(
            t`Delete Temporary Greeting`,
            t`Are you sure you want to delete this temporary greeting? This cannot be undone.`,
        );
        if (!confirm) return;

        // Remove from temp states
        const tempIndex = this.#tempStates.findIndex(s => s.id === state.id);
        if (tempIndex !== -1) {
            this.#tempStates.splice(tempIndex, 1);
        }

        // Remove from chat metadata (look up swipeIndex by ID)
        const swipeIndex = this.#findTempGreetingSwipeIndex(state.id);
        if (swipeIndex !== undefined) {
            await removeTempGreeting(swipeIndex);
        }

        // Re-render
        this.#renderGreetingsList(list);
        this.#updateInfoLine();

        toastr.info(t`Temporary greeting deleted`);
    }

    /**
     * Renders all greetings in the list.
     * @param {HTMLElement} list
     */
    #renderGreetingsList(list) {
        // Capture current toggle states before re-rendering
        this.#captureToggleStates();

        // Clear existing alternate blocks (but keep the main greeting and hint)
        const blocks = list.querySelectorAll('.greeting-tools-block:not(.greeting-tools-main-block)');
        blocks.forEach(block => block.remove());

        // Render all saved greetings
        for (let i = 0; i < this.#altStates.length; i++) {
            const block = this.#createGreetingBlock(this.#altStates[i], i, list);
            list.appendChild(block);
        }

        // Render temp greetings with special marker
        for (let i = 0; i < this.#tempStates.length; i++) {
            const block = this.#createGreetingBlock(this.#tempStates[i], i, list, { isTemp: true });
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

        // Generate new greeting button handler
        const generateBtn = this.#template.querySelector('.greeting-tools-generate');
        if (generateBtn) {
            generateBtn.addEventListener('click', () => this.#handleGenerateNewGreeting(list));
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
     * Sets up keyboard navigation for greeting blocks.
     * - Arrow Up/Down: Navigate between blocks when not in textarea
     * - Ctrl+Arrow Up/Down: Navigate between blocks when in textarea
     * - Navigation wraps circularly
     */
    #setupKeyboardNavigation() {
        if (!this.#template) return;

        this.#template.addEventListener('keydown', (e) => {
            if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;

            const target = e.target;
            const isInTextarea = target instanceof HTMLTextAreaElement;
            const isCtrlPressed = e.ctrlKey || e.metaKey;

            // In textarea: only handle with CTRL modifier
            // Outside textarea: handle all arrow navigation, even without CTRL
            if (isInTextarea && !isCtrlPressed) return;

            // Find current greeting block
            const currentBlock = /** @type {HTMLElement | null} */ (
                target instanceof Element ? target.closest('.greeting-tools-block') : null
            );
            if (!currentBlock) return;

            // Get all greeting blocks (main + alts) in DOM order
            const allBlocks = /** @type {HTMLElement[]} */ (
                Array.from(this.#template?.querySelectorAll('.greeting-tools-block') ?? [])
            );
            if (allBlocks.length === 0) return;

            const currentIndex = allBlocks.indexOf(currentBlock);
            if (currentIndex === -1) return;

            // Calculate next index with circular wrapping
            const direction = e.key === 'ArrowUp' ? -1 : 1;
            const nextIndex = (currentIndex + direction + allBlocks.length) % allBlocks.length;
            const nextBlock = allBlocks[nextIndex];

            // Focus the summary element (keyboard-interactable, space toggles)
            const summary = nextBlock.querySelector('summary');
            if (summary instanceof HTMLElement) {
                e.preventDefault();
                summary.focus();
                // Scroll into view if needed
                nextBlock.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        });
    }

    /**
     * Collects existing greeting titles (excluding the current state).
     * @param {GreetingEditorState} state - The current greeting state
     * @returns {string} Formatted list of existing titles, or empty string
     */
    #getExistingTitles(state) {
        const titles = [];
        if (this.#mainState && this.#mainState.id !== state.id && this.#mainState.title) {
            titles.push(this.#mainState.title);
        }
        for (const alt of this.#altStates) {
            if (alt.id !== state.id && alt.title) {
                titles.push(alt.title);
            }
        }
        return titles.length > 0 ? titles.map(t => `- ${t}`).join('\n') : '';
    }

    /**
     * Truncates text with ellipsis if exceeding max length.
     * @param {string} text - The text to truncate
     * @param {number} maxLength - Maximum length
     * @returns {string} Truncated text
     */
    #truncateText(text, maxLength = 80) {
        if (!text || text.length <= maxLength) return text;
        return text.substring(0, maxLength - 3) + '...';
    }

    /**
     * Shows a before/after comparison popup for replacing values.
     * @param {string} currentTitle - Current title value
     * @param {string} currentDesc - Current description value
     * @param {string} newTitle - Generated title value
     * @param {string} newDesc - Generated description value
     * @param {boolean} replaceTitle - Whether to replace title
     * @param {boolean} replaceDesc - Whether to replace description
     * @returns {Promise<boolean>} Whether user confirmed replacement
     */
    async #showReplacePreview(currentTitle, currentDesc, newTitle, newDesc, replaceTitle, replaceDesc) {
        const items = [];

        if (replaceTitle) {
            items.push('<div class="replace-preview-section">');
            items.push(`<div class="replace-preview-label">${t`Title`}:</div>`);
            items.push(`<div class="replace-preview-old">${this.#truncateText(currentTitle)}</div>`);
            items.push(`<div class="replace-preview-new">${this.#truncateText(newTitle)}</div>`);
            items.push('</div>');
        }

        if (replaceDesc) {
            items.push('<div class="replace-preview-section">');
            items.push(`<div class="replace-preview-label">${t`Description`}:</div>`);
            items.push(`<div class="replace-preview-old">${this.#truncateText(currentDesc, 640)}</div>`);
            items.push(`<div class="replace-preview-new">${this.#truncateText(newDesc, 640)}</div>`);
            items.push('</div>');
        }

        const confirmed = await Popup.show.confirm(
            t`Replace Existing Greeting Information?`,
            `<div class="replace-preview-container">${items.join('')}</div>`,
        ) === POPUP_RESULT.AFFIRMATIVE;
        return confirmed;
    }

    /**
     * Performs auto-fill generation for a greeting state.
     * Can be called from both the edit popup button and the shortcut button.
     * @param {GreetingEditorState} state - The greeting state to auto-fill
     * @param {object} [options={}] - Options for the auto-fill
     * @param {HTMLTextAreaElement|null} [options.titleInput=null] - Title input element (if in popup)
     * @param {HTMLTextAreaElement|null} [options.descInput=null] - Description input element (if in popup)
     * @returns {Promise<boolean>} Whether values were updated
     */
    async #performAutoFill(state, { titleInput = null, descInput = null } = {}) {
        // Get current values
        const currentTitle = titleInput?.value?.trim() ?? state.title ?? '';
        const currentDesc = (descInput?.value ?? state.description ?? '').trim();

        // Pre-generation confirmation if both fields are filled
        if (currentTitle && currentDesc) {
            const confirmGenerate = await Popup.show.confirm(
                t`Generate New Title/Description?`,
                t`Both title and description already have values. Generate new content to replace them?`,
            ) === POPUP_RESULT.AFFIRMATIVE;
            if (!confirmGenerate) return false;
        }

        // Generate using the shared generator function
        const existingTitles = this.#getExistingTitles(state);
        const generated = await generateTitleAndDescription(state.content, { existingTitles });
        if (!generated) return false;

        // Helper to apply values to inputs or state
        const applyValues = (/** @type {string} */ title, /** @type {string} */ desc) => {
            if (titleInput) {
                titleInput.value = title;
            } else {
                state.title = title;
            }
            if (descInput) {
                descInput.value = desc;
            } else {
                state.description = desc;
            }
        };

        // Determine what to fill based on what's empty
        if (!currentTitle && !currentDesc) {
            // Both empty: fill both
            applyValues(generated.title, generated.description);
            toastr.success(t`Generated title and description`);
            return true;
        } else if (!currentTitle) {
            // Only title empty: fill title, ask about description
            applyValues(generated.title, currentDesc);

            // Ask if user wants to replace description too
            const replaceDesc = await this.#showReplacePreview(
                '', currentDesc, '', generated.description, false, true,
            );
            if (replaceDesc) {
                applyValues(generated.title, generated.description);
                toastr.success(t`Generated title and replaced description`);
            } else {
                toastr.success(t`Generated title`);
            }
            return true;
        } else if (!currentDesc) {
            // Only description empty: fill description, ask about title
            applyValues(currentTitle, generated.description);

            // Ask if user wants to replace title too
            const replaceTitle = await this.#showReplacePreview(
                currentTitle, '', generated.title, '', true, false,
            );
            if (replaceTitle) {
                applyValues(generated.title, generated.description);
                toastr.success(t`Replaced title and generated description`);
            } else {
                toastr.success(t`Generated description`);
            }
            return true;
        } else {
            // Both filled: already confirmed, show preview and replace
            const confirmReplace = await this.#showReplacePreview(
                currentTitle, currentDesc, generated.title, generated.description, true, true,
            );
            if (confirmReplace) {
                applyValues(generated.title, generated.description);
                toastr.success(t`Replaced title and description`);
                return true;
            }
            return false;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Greeting Context (uniform abstraction over main / alt / temp)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Resolves a greeting ID to a uniform {@link GreetingContext}.
     * Handlers can call `ctx.syncContent()` and `ctx.save()` without branching on greeting type.
     * @param {string} greetingId - The greeting ID to look up
     * @returns {GreetingContext | null} Context object or null if not found
     */
    #resolveGreetingContext(greetingId) {
        if (this.#mainState?.id === greetingId) {
            const state = this.#mainState;
            return {
                state,
                type: 'main',
                syncContent: () => this.#setMainGreeting(state.content),
                save: () => this.#saveDebounced(),
                refreshUI: () => this.#renderMainGreeting(),
            };
        }

        const altState = this.#altStates.find(s => s.id === greetingId);
        if (altState) {
            return {
                state: altState,
                type: 'alt',
                syncContent: () => this.#syncGreetingsToCharacter(),
                save: () => this.#saveDebounced(),
                refreshUI: (list) => this.#refreshAllAltBlocks(list),
            };
        }

        const tempState = this.#tempStates.find(s => s.id === greetingId);
        if (tempState) {
            return {
                state: tempState,
                type: 'temp',
                syncContent: () => this.#syncTempGreetingContent(tempState),
                save: () => this.#saveTempMetadata(),
                refreshUI: (list) => this.#refreshBlockTitle(tempState.id, list),
            };
        }

        return null;
    }

    /**
     * Syncs a temp greeting's content to the chat swipe array.
     * @param {GreetingEditorState} state - The temp greeting state
     */
    #syncTempGreetingContent(state) {
        const swipeIndex = this.#findTempGreetingSwipeIndex(state.id);
        if (swipeIndex !== undefined && chat?.[0]?.swipes) {
            chat[0].swipes[swipeIndex] = state.content;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Replace Names
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Updates the visibility of the "Replace names with macros" button for a greeting block.
     * Shows the button only if the greeting content contains character or user names.
     * @param {HTMLElement} block - The greeting block element
     * @param {string} content - The current greeting content
     */
    #updateReplaceNamesButton(block, content) {
        const btn = block.querySelector('.greeting-tools-replace-names');
        if (btn instanceof HTMLElement) {
            btn.style.display = textContainsNames(content) ? '' : 'none';
        }
    }

    /**
     * Handles clicking the "Replace names with macros" button.
     * Uses {@link GreetingContext} to handle any greeting type uniformly.
     * @param {string} greetingId - The greeting ID to operate on
     * @param {HTMLElement} block - The greeting block element
     */
    #handleReplaceNames(greetingId, block) {
        const ctx = this.#resolveGreetingContext(greetingId);
        if (!ctx) return;

        const textarea = block.querySelector('.greeting-tools-textarea');
        if (!(textarea instanceof HTMLTextAreaElement)) return;

        const replaced = replaceNamesWithMacros(textarea.value);
        if (replaced === textarea.value) return;

        textarea.value = replaced;
        ctx.state.content = replaced;
        ctx.state.contentHash = getStringHash(replaced);
        ctx.syncContent();
        ctx.save();

        this.#updateReplaceNamesButton(block, replaced);
        toastr.success(t`Replaced names with macros`);
    }

    /**
     * Directly auto-fills a greeting state without opening the edit popup.
     * Used by the shortcut button in the greeting block.
     * @param {GreetingEditorState} state - The greeting state to auto-fill
     * @param {() => void} onSave - Callback to refresh UI after save
     */
    async #handleAutoFill(state, onSave) {
        const updated = await this.#performAutoFill(state);
        if (updated) {
            onSave();
        }
    }

    /**
     * Shows the edit title/description popup for any greeting state.
     * @param {GreetingEditorState} state - The greeting state to edit
     * @param {() => void} onSave - Callback to refresh UI after save
     */
    async #showEditTitlePopup(state, onSave) {
        const content = PopupUtils.BuildTextWithHeader(
            t`Edit Greeting Details`,
            t`Give this greeting a memorable title and optional description.`,
        );
        const popup = new Popup(content, POPUP_TYPE.INPUT, state.title, {
            customInputs: [
                {
                    id: 'greeting-description-input',
                    label: t`Description` + ' / ' + t`Summary`,
                    type: 'textarea',
                    rows: 12,
                    defaultState: state.description,
                    tooltip: t`Optional description or summary`,
                },
            ],
            customButtons: [
                {
                    text: t`Auto-Fill`,
                    tooltip: t`Automatically generate a title and description based on the greeting content`,
                    icon: 'fa-wand-magic-sparkles',
                    action: async () => {
                        const titleInput = popup.mainInput;
                        const descInput = popup.body?.querySelector('#greeting-description-input');
                        await this.#performAutoFill(state, {
                            titleInput: titleInput ?? null,
                            descInput: descInput instanceof HTMLTextAreaElement ? descInput : null,
                        });
                    },
                },
            ],
        });

        const result = await popup.show();

        // For POPUP_TYPE.INPUT: result is input string on confirm, false on negative, null on cancel
        if (typeof result === 'string') {
            state.title = result.trim();
            state.description = String(popup.inputResults?.get('greeting-description-input') ?? '').trim();
            onSave();
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
        const index = this.#altStates.findIndex(s => s.id === greetingId);
        if (index === -1) return;

        const state = this.#altStates[index];
        const greetingNumber = index + 1;
        const greetingName = state.title
            ? `${t`greeting`} "${state.title}" (#${greetingNumber})`
            : `${t`Alternate Greeting`} #${greetingNumber}`;

        const confirm = await Popup.show.confirm(
            t`Delete Greeting`,
            t`Are you sure you want to delete ${greetingName}?`,
        );

        if (!confirm) return;

        // Remove from state
        this.#altStates.splice(index, 1);

        // Sync to character
        this.#syncGreetingsToCharacter();
        this.#saveDebounced();

        // Re-render the list
        this.#renderGreetingsList(list);

        // Update button count
        updateButtonAppearance(this.#chid);
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

        // Append the new block - force open for manually added empty greetings
        const block = this.#createGreetingBlock(newState, this.#altStates.length - 1, list, { forceOpen: true });
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

        // Update button count
        updateButtonAppearance(this.#chid);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Generate New Greeting
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Collects all existing greeting titles for context.
     * @returns {string} Formatted list of existing titles, or empty string
     */
    #getAllExistingTitles() {
        const titles = [];
        if (this.#mainState?.title) {
            titles.push(this.#mainState.title);
        }
        for (const alt of this.#altStates) {
            if (alt.title) {
                titles.push(alt.title);
            }
        }
        return titles.length > 0 ? titles.map(t => `- ${t}`).join('\n') : '';
    }

    /**
     * Shows the generate greeting popup and handles the generation flow.
     * Uses the unified generateGreetingFlow for the generation logic.
     * @param {HTMLElement} list - The greeting list container
     */
    async #handleGenerateNewGreeting(list) {
        /** @type {HTMLElement | undefined} */
        let block;

        // Use unified generation flow with callback for early UI update
        const generated = await generateGreetingFlow({
            existingTitles: this.#getAllExistingTitles(),
        });

        if (!generated) return;

        // Create new state with generated content
        const newState = /** @type {GreetingEditorState} */ ({
            id: generated.id,
            content: generated.content,
            title: generated.title,
            description: generated.description,
            contentHash: getStringHash(generated.content),
        });

        // Add to states and sync
        this.#altStates.push(newState);
        this.#syncGreetingsToCharacter();
        this.#saveDebounced();

        // Append the new block
        block = this.#createGreetingBlock(newState, this.#altStates.length - 1, list);
        list.appendChild(block);

        // Update UI states
        this.#updateMoveButtonStates(list);
        this.#updateHintVisibility(list);
        this.#updateInfoLine();

        // Scroll to bottom to show new greeting
        list.scrollTop = list.scrollHeight;

        // Update button count
        updateButtonAppearance(this.#chid);

        // Show success message
        if (generated.title) {
            toastr.success(t`New greeting created with title and description`);
        } else {
            toastr.success(t`New greeting created`);
        }

        // Focus the textarea
        const textarea = block?.querySelector('.greeting-tools-textarea');
        if (textarea instanceof HTMLTextAreaElement) {
            textarea.focus();
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Cleanup
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Handles popup close - saves data and triggers character save.
     * Preserves temp greetings and restores swipe position after re-render.
     */
    async #onClose() {
        // Save metadata on close
        await this.#saveAllMetadata();

        // Save character if not in create mode
        if (menu_type !== 'create') {
            // Capture current swipe index before save (to restore after re-render)
            const currentSwipeIndex = chat?.[0]?.swipe_id ?? 0;

            // Get temp greetings data to re-inject after re-render
            const tempGreetings = getTempGreetings();
            const hasTempGreetings = tempGreetings.size > 0;

            await createOrEditCharacter();

            // Re-inject temp greetings into first message swipes after re-render
            if (hasTempGreetings && chat?.[0]) {
                const firstMessage = chat[0];

                // Ensure swipes array exists
                if (!Array.isArray(firstMessage.swipes)) {
                    firstMessage.swipes = [firstMessage.mes];
                    firstMessage.swipe_id = 0;
                    firstMessage.swipe_info = [{}];
                }

                // Re-add temp greeting swipes at their original indices
                for (const [swipeIndex, tempData] of tempGreetings) {
                    // Only add if the swipe index is beyond current swipes (temp greetings)
                    while (firstMessage.swipes.length <= swipeIndex) {
                        firstMessage.swipes.push('');
                        firstMessage.swipe_info.push({});
                    }
                    firstMessage.swipes[swipeIndex] = tempData.content;
                }
            }

            // Restore swipe position after re-render (with small delay for DOM update)
            if (currentSwipeIndex > 0) {
                setTimeout(async () => {
                    const firstMessage = chat?.[0];
                    if (!firstMessage || !Array.isArray(firstMessage.swipes)) return;

                    // Validate the swipe index is still valid
                    const maxSwipeIndex = firstMessage.swipes.length - 1;
                    const targetIndex = Math.min(currentSwipeIndex, maxSwipeIndex);
                    if (targetIndex > 0) {
                        await swipe(null, SWIPE_DIRECTION.RIGHT, {
                            forceMesId: 0,
                            forceSwipeId: targetIndex,
                            message: firstMessage,
                        });
                    }
                }, 50);
            }
        }

        // Refresh button count
        updateButtonAppearance(this.#chid);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Popup Entry Point & Button Intercept
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Opens the greeting tools popup for a character.
 * @param {string} chid - Character ID
 * @param {OpenPopupOptions} [options] - Options object
 */
export async function openGreetingToolsPopup(chid, options = {}) {
    const popup = new GreetingToolsPopup(chid, options);
    await popup.show();
}

/**
 * Sets up the button intercept to replace ST's popup with ours.
 */
export function setupButtonIntercept() {
    updateButtonAppearance();

    // Update button when character changes
    eventSource.on(event_types.CHAT_CHANGED, () => updateButtonAppearance());

    document.addEventListener('click', (e) => {
        const target = e.target;
        if (!(target instanceof Element)) return;

        const button = target.closest('.open_alternate_greetings');
        if (!button) return;

        e.stopImmediatePropagation();
        e.preventDefault();

        const chidAttr = $(button).data('chid');
        const chid = chidAttr !== undefined ? String(chidAttr) : undefined;

        if (chid !== undefined || menu_type === 'create') {
            openGreetingToolsPopup(chid);
        }
    }, true);
}
