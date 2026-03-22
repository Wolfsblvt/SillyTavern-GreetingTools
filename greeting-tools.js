import { characters, eventSource, event_types, menu_type, this_chid } from '../../../../script.js';
import { writeExtensionField } from '../../../extensions.js';
import { t } from '../../../i18n.js';
import { EXTENSION_KEY } from './index.js';
import { GreetingToolsPopup } from './greeting-tools-popup.js';

/** @typedef {import('./greeting-tools-popup.js').OpenPopupOptions} OpenPopupOptions */

/**
 * @typedef {Object} GreetingMetadata
 * @property {string} [id] - Unique greeting ID
 * @property {string} [title] - User-defined title for the greeting
 * @property {string} [description] - Optional description
 * @property {number} [contentHash] - Hash of content when metadata was last set
 */

/**
 * @typedef {Object} GreetingToolsData
 * @property {GreetingMetadata} mainGreeting - Main greeting metadata
 * @property {{ [greetingId: string]: GreetingMetadata }} greetings - Greeting metadata keyed by unique ID
 * @property {{ [index: number]: string }} indexMap - Maps greeting index to greeting ID
 */

// ─────────────────────────────────────────────────────────────────────────────
// Data Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generates a unique greeting ID.
 * @returns {string} A unique identifier
 */
export function generateGreetingId() {
    return `g_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * Finds matching metadata for a greeting by index or content hash.
 * @param {GreetingToolsData} metadata - The greeting tools metadata
 * @param {number} index - The greeting index in alternate_greetings array
 * @param {number} contentHash - Hash of the greeting content
 * @returns {GreetingMetadata | null} Matching metadata or null
 */
export function findGreetingMetadata(metadata, index, contentHash) {
    // Primary: match by index using indexMap (most reliable, survives content normalization)
    const indexMappedId = metadata.indexMap?.[index];
    if (indexMappedId && metadata.greetings[indexMappedId]) {
        return metadata.greetings[indexMappedId];
    }

    // Fallback: match by contentHash (for backwards compatibility or reordered greetings)
    for (const meta of Object.values(metadata.greetings)) {
        if (meta.contentHash === contentHash) {
            return meta;
        }
    }

    return null;
}

/**
 * Gets the greeting tools data for the current character.
 * @param {Object} [options={}]
 * @param {string} [options.chid] - Character ID
 * @returns {GreetingToolsData}
 */
export function getGreetingToolsData({ chid = null } = {}) {
    const id = chid ?? this_chid;
    const character = characters[id];
    if (!character) {
        return { greetings: {}, indexMap: {}, mainGreeting: {} };
    }

    const extensions = character?.data?.extensions;
    if (!extensions?.[EXTENSION_KEY]) {
        return { greetings: {}, indexMap: {}, mainGreeting: {} };
    }

    const data = extensions[EXTENSION_KEY];
    return {
        greetings: data.greetings ?? {},
        indexMap: data.indexMap ?? {},
        mainGreeting: data.mainGreeting ?? {},
    };
}

/**
 * Saves the greeting tools data for a character.
 * @param {GreetingToolsData} data - The data to save
 * @param {{ chid?: string }} [options]
 * @returns {Promise<void>}
 */
export async function saveGreetingToolsData(data, { chid = null } = {}) {
    const id = chid ?? this_chid;
    if (id === undefined) {
        console.warn('[GreetingTools] No character selected');
        return;
    }

    await writeExtensionField(id, EXTENSION_KEY, data);
}

// ─────────────────────────────────────────────────────────────────────────────
// Popup Entry Point
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

// ─────────────────────────────────────────────────────────────────────────────
// Button Intercept Setup
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Gets the total greeting count for a character (main + alternates).
 * @param {string} [chid] - Character ID (defaults to current character)
 * @returns {number} Total number of greetings
 */
function getGreetingCount(chid) {
    const id = chid ?? this_chid;
    const character = characters[id];
    if (!character) return 0;

    const altGreetings = character.data?.alternate_greetings ?? [];
    // Main greeting counts as 1, plus all alternate greetings
    return 1 + altGreetings.length;
}

/**
 * Updates the button text and tooltip to reflect the extension's functionality.
 * @param {string} [chid] - Character ID to get count for
 */
export function updateButtonAppearance(chid) {
    const buttons = document.querySelectorAll('.open_alternate_greetings');
    const count = getGreetingCount(chid);

    buttons.forEach(button => {
        // Update tooltip with count info
        const tooltip = count > 1
            ? t`Manage ${count} greetings - edit titles, descriptions, and reorder`
            : t`Manage greetings - edit titles, descriptions, and reorder`;
        button.setAttribute('title', tooltip);

        const textSpan = button.querySelector('span');
        if (textSpan instanceof HTMLElement) {
            // Show count in parentheses only if more than 1 greeting
            const displayText = count > 1 ? t`Greeting Tools` + ` (${count})` : t`Greeting Tools`;
            textSpan.textContent = displayText;
            textSpan.dataset.i18n = 'Greeting Tools';
        }
    });
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
