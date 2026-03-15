import { characters, menu_type, create_save, createOrEditCharacter, generateRaw, substituteParams } from '../../../../script.js';
import { renderExtensionTemplateAsync } from '../../../extensions.js';
import { Popup, POPUP_TYPE, POPUP_RESULT } from '../../../popup.js';
import { t } from '../../../i18n.js';
import { debounce, flashHighlight, getStringHash } from '../../../utils.js';
import { debounce_timeout } from '../../../constants.js';
import { EXTENSION_NAME } from './index.js';
import { generateGreetingId, getGreetingToolsData, saveGreetingToolsData, updateButtonAppearance } from './greeting-tools.js';
import { showGenerationLoader } from '../../../generation-loader.js';

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
     * Re-renders all alternate greeting block indices and titles.
     * @param {HTMLElement} list
     */
    #refreshAllAltBlocks(list) {
        const blocks = list.querySelectorAll('.greeting-tools-block:not(.greeting-tools-main-block)');
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

        // Auto-fill button (shortcut for auto-generating title/description)
        const autoFillBtn = block.querySelector('.greeting-tools-auto-fill');
        if (autoFillBtn) {
            autoFillBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (!this.#mainState) return;
                await this.#handleAutoFill(this.#mainState, () => this.#renderMainGreeting());
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
                await this.#showEditTitlePopup(clickedState, () => this.#refreshAllAltBlocks(list));
            });
        }

        // Auto-fill button (shortcut for auto-generating title/description)
        const autoFillBtn = block.querySelector('.greeting-tools-auto-fill');
        if (autoFillBtn) {
            autoFillBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                const clickedState = this.#altStates.find(s => s.id === state.id);
                if (!clickedState) return;
                await this.#handleAutoFill(clickedState, () => this.#refreshAllAltBlocks(list));
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

    /** System prompt template for greeting title/description generation */
    static #GENERATE_SYSTEM_PROMPT = `You are helping organize greeting messages for a character named '{{char}}'.

Your task is to generate a short, memorable **title** and a brief **description** for the following greeting message.

## Instructions
- The **title** should be 2-7 words, catchy and descriptive of the greeting's theme or mood, making it unique and recognizable between the other greetings
- The **description** should be 2-6 sentences summarizing what makes this greeting unique
- Be creative but accurate to the greeting's content
- Output **ONLY** the title and description in the exact format shown below

{{#if charDescription}}
## Character Description (for context)
{{charDescription}}

{{/if}}
{{#if charPersonality}}
## Character Personality
{{charPersonality}}

{{/if}}
{{#if scenario}}
## Scenario
{{scenario}}

{{/if}}
{{#if existingTitles}}
## Existing Greeting Titles (avoid identical or too similar names)
{{existingTitles}}

{{/if}}

## Required Output Format
You **MUST** respond with exactly this format, no other text:

\`\`\`title
[Your generated title here]
\`\`\`

\`\`\`description
[Your generated description here]
\`\`\``;

    /** System prompt template for generating new greeting content */
    static #GENERATE_GREETING_SYSTEM_PROMPT = `You are writing a new opening greeting message for a roleplay character named '{{char}}'.

## Your Task
Write a compelling, immersive **first message** that establishes an interesting scenario or situation. This message should:
- Be written from {{char}}'s perspective (first person or third person narrative as appropriate)
- Set up an engaging scene, situation, or encounter
- Reflect the character's personality and speaking style
- Be detailed enough to give {{user}} something to respond to
- Include scene-setting, actions, dialogue, or inner thoughts as appropriate

{{#if charDescription}}
## Character Description
{{charDescription}}

{{/if}}
{{#if charPersonality}}
## Character Personality
{{charPersonality}}

{{/if}}
{{#if scenario}}
## Base Scenario
{{scenario}}

{{/if}}
{{#if existingTitles}}
## Existing Greeting Themes (try to create something different)
The following greetings already exist. Try to create a unique scenario that differs from these:
{{existingTitles}}

{{/if}}
{{#if customPrompt}}
## Special Instructions
The user has requested the following specific theme or scenario for this greeting:
**{{customPrompt}}**

Make sure to incorporate this into the greeting while staying true to the character.

{{/if}}
## Output Format
Write ONLY the greeting message itself. Do not include titles, labels, explanations, or meta-commentary.
Just write the actual greeting text that {{char}} would say/do to start a conversation or scene with {{user}}.`;

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
     * Generates title and description using LLM.
     * @param {GreetingEditorState} state - The greeting state
     * @param {object} [options={}] - Generation options
     * @param {boolean} [options.showLoader=true] - Whether to show the blocking loader (false for chained generation)
     * @returns {Promise<{title: string, description: string} | null>}
     */
    async #generateTitleAndDescription(state, { showLoader = true } = {}) {
        if (!state.content || state.content.trim().length === 0) {
            toastr.warning(t`Cannot generate without greeting content`);
            return null;
        }

        // Build dynamic macros for this generation
        const existingTitles = this.#getExistingTitles(state);
        const dynamicMacros = { existingTitles };

        // Substitute macros in system prompt
        const systemPrompt = substituteParams(GreetingToolsPopup.#GENERATE_SYSTEM_PROMPT, undefined, undefined, dynamicMacros);

        // Main prompt is just the greeting content
        const prompt = state.content;

        const loader = showLoader
            ? showGenerationLoader({ message: t`Generating title and description...` })
            : null;

        try {
            const response = await generateRaw({
                prompt,
                systemPrompt,
                instructOverride: true,
            });

            // Log full response for debugging
            console.info('[GreetingTools] LLM response', { text: response });

            if (!response || typeof response !== 'string') {
                toastr.error(t`No response from LLM`);
                return null;
            }

            // Parse code blocks from response
            const titleMatch = response.match(/```title\s*\n?([\s\S]*?)```/i);
            const descMatch = response.match(/```description\s*\n?([\s\S]*?)```/i);

            let title = titleMatch?.[1]?.trim() ?? '';
            let description = descMatch?.[1]?.trim() ?? '';

            // Fallback: if no code blocks, try to extract from plain text
            if (!title && !description) {
                const lines = response.trim().split('\n').filter(l => l.trim());
                if (lines.length >= 1) {
                    // First non-empty line as title, rest as description
                    title = lines[0].replace(/^(title:|#|\*)+\s*/i, '').trim();
                    if (lines.length >= 2) {
                        description = lines.slice(1).join(' ').replace(/^(description:|#|\*)+\s*/i, '').trim();
                    }
                    console.log('[GreetingTools] Used fallback parsing for response');
                }
            }

            if (!title) {
                toastr.error(t`Could not parse title from LLM response`);
                return null;
            }

            return { title, description };
        } catch (error) {
            // Don't show error toast for intentional user aborts
            const isAborted = error?.name === 'AbortError' || error?.message?.includes('Cancelled');
            if (isAborted) {
                console.log('[GreetingTools] Generation was cancelled by user');
            } else {
                console.error('[GreetingTools] Generation error:', error);
                toastr.error(t`Generation failed: ${error.message}`);
            }
            return null;
        } finally {
            if (loader) await loader.hide();
        }
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
     * @param {() => void} [options.onSave=null] - Callback after saving (for direct mode)
     * @returns {Promise<boolean>} Whether values were updated
     */
    async #performAutoFill(state, { titleInput = null, descInput = null, onSave = null } = {}) {
        // Get current values
        const currentTitle = titleInput?.value?.trim() ?? state.title ?? '';
        const currentDesc = (descInput?.value ?? state.description ?? '').trim();

        // Pre-generation confirmation if both fields are filled
        if (currentTitle && currentDesc) {
            const confirmGenerate = await Popup.show.confirm(
                t`Generate new values?`,
                t`Both title and description already have values. Generate new content to replace them?`,
            ) === POPUP_RESULT.AFFIRMATIVE;
            if (!confirmGenerate) return false;
        }

        // Generate
        const generated = await this.#generateTitleAndDescription(state);
        if (!generated) return false;

        // Helper to apply values
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
            // If direct mode (no inputs), save immediately
            if (!titleInput && !descInput && onSave) {
                onSave();
                this.#saveDebounced();
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

    /**
     * Directly auto-fills a greeting state without opening the edit popup.
     * Used by the shortcut button in the greeting block.
     * @param {GreetingEditorState} state - The greeting state to auto-fill
     * @param {() => void} onSave - Callback to refresh UI after save
     */
    async #handleAutoFill(state, onSave) {
        const updated = await this.#performAutoFill(state, { onSave });
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
        const content = document.createElement('div');
        content.innerHTML = `
            <h3 data-i18n="Edit Greeting Details">Edit Greeting Details</h3>
            <p data-i18n="Give this greeting a memorable title and optional description.">Give this greeting a memorable title and optional description.</p>
        `;

        /** @type {Popup} */
        let popup;

        const handleGenerate = async () => {
            const titleInput = popup.mainInput;
            const descInput = popup.body?.querySelector('#greeting-description-input');
            await this.#performAutoFill(state, {
                titleInput: titleInput ?? null,
                descInput: descInput instanceof HTMLTextAreaElement ? descInput : null,
            });
        };

        popup = new Popup(content, POPUP_TYPE.INPUT, state.title, {
            customInputs: [
                {
                    id: 'greeting-description-input',
                    label: t`Description` + ' / ' + t`Summary`,
                    type: 'textarea',
                    rows: 7,
                    defaultState: state.description,
                    tooltip: t`Optional description or summary`,
                },
            ],
            customButtons: [
                {
                    text: t`Auto-Fill`,
                    tooltip: t`Automatically generate a title and description based on the greeting content`,
                    icon: 'fa-wand-magic-sparkles',
                    action: handleGenerate,
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

        // Update button count
        updateButtonAppearance(this.#chid);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Generate New Greeting
    // ─────────────────────────────────────────────────────────────────────────

    /** Default placeholder text for the generate greeting popup */
    static #GENERATE_GREETING_PLACEHOLDER = t`Describe the scenario or theme for this greeting... (leave empty for a general new greeting)`;

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
     * @param {HTMLElement} list - The greeting list container
     */
    async #handleGenerateNewGreeting(list) {
        // Show popup with text input for custom prompt
        const customPrompt = await this.#showGenerateGreetingPromptPopup();

        // User cancelled
        if (customPrompt === null) return;

        // Generate the greeting content
        const content = await this.#generateGreetingContent(customPrompt);
        if (!content) return;

        // Create new state with generated content
        const newState = {
            id: generateGreetingId(),
            content,
            title: '',
            description: '',
            contentHash: getStringHash(content),
        };

        // Add to states and sync
        this.#altStates.push(newState);
        this.#syncGreetingsToCharacter();
        await this.#saveDebounced();

        // Append the new block
        const block = this.#createGreetingBlock(newState, this.#altStates.length - 1, list);
        list.appendChild(block);

        // Update UI states
        this.#updateMoveButtonStates(list);
        this.#updateHintVisibility(list);
        this.#updateInfoLine();

        // Scroll to bottom to show new greeting
        list.scrollTop = list.scrollHeight;

        // Update button count
        updateButtonAppearance(this.#chid);

        // Show success toast for content generation (will auto-dismiss)
        toastr.success(t`Greeting content generated successfully`);

        // Generate title and description with blocking loader
        const generated = await this.#generateTitleAndDescription(newState);

        if (generated) {
            newState.title = generated.title;
            newState.description = generated.description;

            // Update the block's display
            this.#updateBlockTitle(block, newState, { index: this.#altStates.length - 1 });

            // Save the updated metadata
            await this.#saveDebounced();

            toastr.success(t`Title and description added`);
        } else {
            // Content was generated but title/description failed - still a partial success
            toastr.warning(t`Could not generate title/description. You can add them manually.`);
        }

        // Focus the textarea
        const textarea = block.querySelector('.greeting-tools-textarea');
        if (textarea instanceof HTMLTextAreaElement) {
            textarea.focus();
        }
    }
    /**
     * Shows a popup for the user to enter a custom prompt for greeting generation.
     * @returns {Promise<string | null>} The custom prompt text, empty string for default, or null if cancelled
     */
    async #showGenerateGreetingPromptPopup() {
        const popup = new Popup(t`Describe what kind of greeting scenario you want to generate. Leave empty for a general new greeting based on the character.`, POPUP_TYPE.INPUT, '', {
            large: false,
            rows: 7,
            placeholder: GreetingToolsPopup.#GENERATE_GREETING_PLACEHOLDER,
            okButton: t`Generate`,
            cancelButton: t`Cancel`,
        });

        const result = await popup.show();
        return typeof result === 'string' ? result.trim() : null;
    }

    /**
     * Generates greeting content using LLM.
     * @param {string} customPrompt - Optional custom prompt from user
     * @returns {Promise<string | null>} Generated greeting content or null on failure
     */
    async #generateGreetingContent(customPrompt) {
        // Build dynamic macros
        const existingTitles = this.#getAllExistingTitles();
        const dynamicMacros = {
            existingTitles,
            customPrompt: customPrompt || '',
        };

        // Substitute macros in system prompt
        const systemPrompt = substituteParams(GreetingToolsPopup.#GENERATE_GREETING_SYSTEM_PROMPT, undefined, undefined, dynamicMacros);

        // The prompt to the LLM is minimal - system prompt has all context
        const prompt = customPrompt
            ? t`Generate a greeting for {{char}} with this theme:\n${customPrompt}`
            : t`Generate a new greeting for {{char}} that differs from existing greetings.`;

        const loader = showGenerationLoader({
            message: t`Generating new greeting...`,
        });

        try {
            const response = await generateRaw({
                prompt,
                systemPrompt,
                instructOverride: true,
            });

            console.info('[GreetingTools] Generated greeting content', { text: response });

            if (!response || typeof response !== 'string') {
                toastr.error(t`No response from LLM`);
                return null;
            }

            // Clean up the response - remove any leading/trailing whitespace
            const content = response.trim();

            if (!content) {
                toastr.error(t`Generated content is empty`);
                return null;
            }

            return content;
        } catch (error) {
            // Don't show error toast for intentional user aborts
            const isAborted = error?.name === 'AbortError' || error?.message?.includes('Cancelled');
            if (isAborted) {
                console.log('[GreetingTools] Greeting generation was cancelled by user');
            } else {
                console.error('[GreetingTools] Greeting generation error:', error);
                toastr.error(t`Generation failed: ${error.message}`);
            }
            return null;
        } finally {
            await loader.hide();
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

        // Refresh button count
        updateButtonAppearance(this.#chid);
    }
}
