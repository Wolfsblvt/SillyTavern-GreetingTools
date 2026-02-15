import { characters, this_chid } from '../../../../script.js';
import { getStringHash } from '../../../../scripts/utils.js';
import { writeExtensionField } from '../../../extensions.js';
import { EXTENSION_KEY } from './index.js';


/**
 * @typedef {Object} GreetingMetadata
 * @property {string} [title] - User-defined title for the greeting
 * @property {string} [summary] - Optional summary (for future use)
 * @property {number} [contentHash] - Hash of content when metadata was last set
 * @property {number} [lastUsed] - Timestamp of last use (for future tracking)
 */

/**
 * @typedef {{ [index: number]: string }} GreetingIndexMap
 */

/**
 * @typedef {Object} GreetingToolsData
 * @property {{ [greetingId: string]: GreetingMetadata }} greetings - Greeting metadata keyed by unique ID
 * @property {GreetingIndexMap} indexMap - Maps greeting index to greeting ID
 */

/**
 * Generates a unique greeting ID.
 * @returns {string} A unique identifier
 */
export function generateGreetingId() {
    return `g_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * Gets the alternate greetings array for a character.
 * @param {Object} [options={}]
 * @param {string} [options.chid] - Character ID
 * @returns {string[]}
 */
export function getAlternateGreetings({ chid = null } = {}) {
    const id = chid ?? this_chid;
    const character = characters[id];
    if (!character?.data?.alternate_greetings) return [];
    return character.data.alternate_greetings;
}

/**
 * Gets the content of a greeting by index.
 * @param {number} index - Greeting index
 * @param {Object} [options={}] - Options object
 * @param {string} [options.chid] - Character ID
 * @returns {string}
 */
function getGreetingContent(index, { chid = null } = {}) {
    const greetings = getAlternateGreetings({ chid });
    return greetings[index] ?? '';
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
        return { greetings: {}, indexMap: {} };
    }

    const extensions = character?.data?.extensions;
    if (!extensions?.[EXTENSION_KEY]) {
        return { greetings: {}, indexMap: {} };
    }

    const data = extensions[EXTENSION_KEY];
    return {
        greetings: data.greetings ?? {},
        indexMap: data.indexMap ?? {},
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

/**
 * Gets or creates a greeting ID for a specific index.
 * If the content at that index has changed, creates a new ID.
 * @param {number} index - Greeting index
 * @param {Object} [options={}]
 * @param {string} [options.chid] - Character ID
 * @returns {{ greetingId: string, isNew: boolean }}
 */
function getOrCreateGreetingId(index, { chid = null } = {}) {
    const content = getGreetingContent(index, { chid });
    const data = getGreetingToolsData({ chid });
    const existingId = data.indexMap[index];
    const contentHash = getStringHash(content);

    if (existingId) {
        const metadata = data.greetings[existingId];
        // Check if content matches - if so, return existing ID
        if (metadata?.contentHash === contentHash) {
            return { greetingId: existingId, isNew: false };
        }

        // Content changed - try to find matching ID by content hash
        for (const [id, meta] of Object.entries(data.greetings)) {
            if (meta.contentHash === contentHash) {
                return { greetingId: id, isNew: false };
            }
        }
    }

    // No match found - generate new ID
    return { greetingId: generateGreetingId(), isNew: true };
}

/**
 * Finds metadata for a greeting, trying indexMap first then content hash fallback.
 * @param {number} index - Greeting index
 * @param {Object} [options={}]
 * @param {string} [options.chid] - Character ID
 * @returns {{ metadata: GreetingMetadata | null, greetingId: string | null }}
 */
function findGreetingMetadata(index, { chid = null } = {}) {
    const data = getGreetingToolsData({ chid });
    const content = getGreetingContent(index, { chid });
    const contentHash = getStringHash(content);

    // Try index map first
    const mappedId = data.indexMap[index];
    if (mappedId && data.greetings[mappedId]) {
        return { metadata: data.greetings[mappedId], greetingId: mappedId };
    }

    // Fallback: find by content hash
    for (const [gId, meta] of Object.entries(data.greetings)) {
        if (meta.contentHash === contentHash) {
            return { metadata: meta, greetingId: gId };
        }
    }

    return { metadata: null, greetingId: null };
}

/**
 * Gets the title for a greeting by index.
 * @param {number} index - Greeting index
 * @param {Object} [options={}]
 * @param {string} [options.chid] - Character ID
 * @returns {string}
 */
export function getGreetingTitle(index, { chid = null } = {}) {
    const { metadata } = findGreetingMetadata(index, { chid });
    return metadata?.title ?? '';
}

/**
 * Checks if a greeting metadata entry is empty (has no meaningful data).
 * @param {GreetingMetadata} metadata - The metadata to check
 * @returns {boolean} True if the metadata is empty
 */
function isMetadataEmpty(metadata) {
    if (!metadata) return true;
    return !metadata.title && !metadata.summary;
}

/**
 * Cleans up empty metadata entries from the data object.
 * Removes greeting entries with no meaningful data and their index map references.
 * @param {GreetingToolsData} data - The data object to clean
 */
function cleanupEmptyEntries(data) {
    for (const [greetingId, metadata] of Object.entries(data.greetings)) {
        if (isMetadataEmpty(metadata)) {
            delete data.greetings[greetingId];

            // Also remove from index map
            for (const [indexStr, gId] of Object.entries(data.indexMap)) {
                if (gId === greetingId) {
                    delete data.indexMap[parseInt(indexStr, 10)];
                }
            }
        }
    }
}

/**
 * Updates greeting metadata and saves.
 * Handles index map update, content hash tracking, and cleanup.
 * @param {number} index - Greeting index
 * @param {Partial<GreetingMetadata>} updates - Metadata fields to update
 * @param {Object} [options={}]
 * @param {string} [options.chid] - Character ID
 * @returns {Promise<void>}
 */
export async function updateGreetingMetadata(index, updates, { chid = null } = {}) {
    const id = chid ?? this_chid;
    if (id === undefined) {
        console.warn('[GreetingTools] No character selected');
        return;
    }

    const content = getGreetingContent(index, { chid: id });
    const data = getGreetingToolsData({ chid: id });
    const { greetingId } = getOrCreateGreetingId(index, { chid: id });
    const contentHash = getStringHash(content);

    // Update index map
    data.indexMap[index] = greetingId;

    // Merge updates with existing metadata, always update contentHash
    data.greetings[greetingId] = {
        ...data.greetings[greetingId],
        ...updates,
        contentHash,
    };

    // Clean up empty entries
    cleanupEmptyEntries(data);

    await saveGreetingToolsData(data, { chid: id });
}

/**
 * Sets the title for a greeting.
 * @param {number} index - Greeting index
 * @param {string} title - The title to set
 * @param {Object} [options={}]
 * @param {string} [options.chid] - Character ID
 * @returns {Promise<void>}
 */
export async function setGreetingTitle(index, title, { chid = null } = {}) {
    await updateGreetingMetadata(index, { title: title || '' }, { chid });
}

/**
 * Updates just the content hash for a greeting (used when content changes).
 * This keeps the title associated with the greeting even after edits.
 * @param {number} index - Greeting index
 * @param {Object} [options={}] - Options object
 * @param {string} [options.chid] - Character ID
 * @returns {Promise<void>}
 */
export async function updateContentHash(index, { chid = null } = {}) {
    const id = chid ?? this_chid;
    if (id === undefined) return;

    const content = getGreetingContent(index, { chid: id });
    if (!content) return;

    const data = getGreetingToolsData({ chid: id });
    const contentHash = getStringHash(content);

    // Find existing metadata by index map
    const greetingId = data.indexMap[index];
    if (greetingId && data.greetings[greetingId]) {
        // Update the content hash
        data.greetings[greetingId].contentHash = contentHash;
        await saveGreetingToolsData(data, { chid: id });
    }
}

/**
 * Syncs the index map with current greeting content.
 * Useful after loading or major changes.
 * @param {Object} [options={}]
 * @param {string} [options.chid] - Character ID
 * @returns {Promise<void>}
 */
export async function syncIndexMap({ chid = null } = {}) {
    const id = chid ?? this_chid;
    if (id === undefined) return;

    const greetings = getAlternateGreetings({ chid: id });
    const data = getGreetingToolsData({ chid: id });

    // Build new index map based on content hash matching
    const newIndexMap = /** @type {GreetingIndexMap} */ ({});
    const usedIds = new Set();

    for (let i = 0; i < greetings.length; i++) {
        const content = greetings[i];
        const contentHash = getStringHash(content);

        // Try to find existing metadata with matching content hash
        let matchedId = null;
        for (const [gId, meta] of Object.entries(data.greetings)) {
            if (meta.contentHash === contentHash && !usedIds.has(gId)) {
                matchedId = gId;
                break;
            }
        }

        if (matchedId) {
            newIndexMap[i] = matchedId;
            usedIds.add(matchedId);
        }
        // If no match, greeting has no metadata yet - that's fine
    }

    data.indexMap = newIndexMap;
    await saveGreetingToolsData(data, { chid: id });
}
