import { characters, this_chid } from '../../../../script.js';
import { writeExtensionField } from '../../../extensions.js';
import { EXTENSION_KEY } from './index.js';

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
