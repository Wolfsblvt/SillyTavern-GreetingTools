import { characters, menu_type, this_chid } from '../../../../script.js';
import { writeExtensionField } from '../../../extensions.js';
import { t } from '../../../i18n.js';
import { EXTENSION_KEY } from './index.js';
import { GreetingToolsPopup } from './greeting-tools-popup.js';

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
 * @param {string | undefined} chid - Character ID
 */
export async function openGreetingToolsPopup(chid) {
    const popup = new GreetingToolsPopup(chid);
    await popup.show();
}

// ─────────────────────────────────────────────────────────────────────────────
// Button Intercept Setup
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Updates the button text and tooltip to reflect the extension's functionality.
 */
function updateButtonAppearance() {
    const buttons = document.querySelectorAll('.open_alternate_greetings');
    buttons.forEach(button => {
        button.setAttribute('title', t`Manage greetings - edit titles, descriptions, and reorder`);

        const textSpan = button.querySelector('span');
        if (textSpan instanceof HTMLElement) {
            textSpan.textContent = t`Greeting Tools`;
            textSpan.dataset.i18n = 'Greeting Tools';
        }
    });
}

/**
 * Sets up the button intercept to replace ST's popup with ours.
 */
export function setupButtonIntercept() {
    updateButtonAppearance();

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
