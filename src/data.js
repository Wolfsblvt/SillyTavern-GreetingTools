/**
 * Data layer for Greeting Tools extension.
 * Provides types, metadata CRUD, temp greeting CRUD, and shared utility functions.
 */

import { characters, this_chid, chat_metadata, saveChatConditional } from '../../../../../script.js';
import { writeExtensionField } from '../../../../extensions.js';
import { t, translate } from '../../../../i18n.js';
import { EXTENSION_KEY, EXTENSION_NAME } from '../index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

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

/**
 * @typedef {Object} TempGreetingData
 * @property {string} id - Unique greeting ID
 * @property {string} title - Display title
 * @property {string} description - Description
 * @property {string} content - Greeting text content
 * @property {number} swipeIndex - Index in the swipes array
 */

// ─────────────────────────────────────────────────────────────────────────────
// Utility Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generates a unique greeting ID.
 * @returns {string} A unique identifier
 */
export function generateGreetingId() {
    return `g_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * Creates a TEMP marker element for temporary greetings.
 * @returns {HTMLElement} The TEMP marker span element
 */
export function createTempMarker() {
    const tempMarker = document.createElement('span');
    tempMarker.classList.add('greeting-tools-temp-marker');
    tempMarker.textContent = translate('TEMP', 'temp_marker_text');
    return tempMarker;
}

// ─────────────────────────────────────────────────────────────────────────────
// Character Metadata CRUD
// ─────────────────────────────────────────────────────────────────────────────

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
// Temp Greeting CRUD (chat metadata)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Gets temp greetings from chat metadata.
 * @returns {Map<number, TempGreetingData>} Map of swipe index to temp greeting data
 */
export function getTempGreetings() {
    const stored = chat_metadata[EXTENSION_NAME]?.tempGreetings;
    if (!stored || typeof stored !== 'object') {
        return new Map();
    }
    // Convert object to Map (JSON doesn't preserve Map)
    return new Map(Object.entries(stored).map(([k, v]) => [Number(k), v]));
}

/**
 * Saves temp greetings to chat metadata.
 * @param {Map<number, TempGreetingData>} tempGreetings - Map of temp greetings
 * @param {object} [options] - Options
 * @param {boolean} [options.saveChat=true] - Whether to save the chat
 */
export async function saveTempGreetings(tempGreetings, { saveChat = true } = {}) {
    if (!chat_metadata[EXTENSION_NAME]) {
        chat_metadata[EXTENSION_NAME] = {};
    }
    // Convert Map to object for JSON serialization
    chat_metadata[EXTENSION_NAME].tempGreetings = Object.fromEntries(tempGreetings);
    if (saveChat) {
        await saveChatConditional();
    }
}

/**
 * Adds a temp greeting to chat metadata.
 * @param {number} swipeIndex - Swipe index
 * @param {TempGreetingData} data - Temp greeting data
 */
export async function addTempGreeting(swipeIndex, data) {
    const tempGreetings = getTempGreetings();
    tempGreetings.set(swipeIndex, { ...data, swipeIndex });
    await saveTempGreetings(tempGreetings);
}

/**
 * Removes a temp greeting from chat metadata.
 * @param {number} swipeIndex - Swipe index to remove
 */
export async function removeTempGreeting(swipeIndex) {
    const tempGreetings = getTempGreetings();
    tempGreetings.delete(swipeIndex);
    await saveTempGreetings(tempGreetings);
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared UI Utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Gets the total greeting count for a character (main + alternates).
 * @param {string|null} [chid=null] - Character ID (defaults to current character)
 * @returns {number} Total number of greetings
 */
function getGreetingCount(chid = null) {
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
    const tempCount = getTempGreetings().size;

    buttons.forEach(button => {
        // Update tooltip with count info
        const tooltip = count > 1
            ? t`Manage ${count}${tempCount > 0 ? `+${tempCount}` : ''} greetings - edit titles, descriptions, and reorder`
            : t`Manage greetings - edit titles, descriptions, and reorder`;
        button.setAttribute('title', tooltip);

        const textSpan = button.querySelector('span');
        if (textSpan instanceof HTMLElement) {
            // Show count in parentheses only if more than 1 greeting
            const displayText = count > 1 ? t`Greeting Tools` + ` (${count}${tempCount > 0 ? `+${tempCount}` : ''})` : t`Greeting Tools`;
            textSpan.textContent = displayText;
        }
    });
}
