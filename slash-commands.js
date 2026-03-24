/**
 * Slash command registration for Greeting Tools extension.
 * Provides STscript commands for managing greetings programmatically.
 */

import { characters, this_chid, chat, getRequestHeaders, getOneCharacter, eventSource, event_types } from '../../../../script.js';
import { findChar, getStringHash, isTrueBoolean } from '../../../utils.js';
import { SlashCommand } from '../../../slash-commands/SlashCommand.js';
import { SlashCommandArgument, SlashCommandNamedArgument, ARGUMENT_TYPE } from '../../../slash-commands/SlashCommandArgument.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';
import { SlashCommandEnumValue, enumTypes } from '../../../slash-commands/SlashCommandEnumValue.js';
import { commonEnumProviders } from '../../../slash-commands/SlashCommandCommonEnumsProvider.js';
import {
    getGreetingToolsData,
    saveGreetingToolsData,
    generateGreetingId,
    findGreetingMetadata,
    updateButtonAppearance,
} from './greeting-tools.js';
import { switchToGreeting } from './greeting-selector.js';
import {
    generateGreetingContent,
    generateTitleAndDescription,
    replaceNamesWithMacros,
} from './greeting-generator.js';
import { greetingToolsSettings } from './settings.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolves a character ID from a name argument or falls back to current character.
 * Uses SillyTavern's findChar for robust case/accent-insensitive matching.
 * @param {string} [name] - Character name or avatar key
 * @returns {{ chid: string, character: object } | null}
 */
function resolveCharacter(name) {
    if (name) {
        const character = findChar({ name });
        if (!character) {
            toastr.warning(`Character "${name}" not found.`);
            return null;
        }
        const index = characters.indexOf(character);
        return { chid: String(index), character };
    }

    if (this_chid === undefined) {
        toastr.warning('No character selected.');
        return null;
    }
    return { chid: String(this_chid), character: characters[this_chid] };
}

/**
 * Parses and validates a greeting index argument (1-based for users, 0 = main).
 * @param {string} indexStr - The index string from the user (1-based)
 * @param {object} character - The character object
 * @param {object} [options]
 * @param {boolean} [options.allowMain=true] - Whether index 0 (main greeting) is allowed
 * @returns {number | null} The validated 0-based index (0=main, 1+=alternate index), or null
 */
function parseGreetingIndex(indexStr, character, { allowMain = true } = {}) {
    const index = parseInt(indexStr, 10);
    if (isNaN(index)) {
        toastr.warning('Greeting index must be a number.');
        return null;
    }

    const altGreetings = character.data?.alternate_greetings ?? [];
    const maxIndex = altGreetings.length; // 0 = main, 1..N = alternates

    if (index < 0 || index > maxIndex) {
        toastr.warning(`Greeting index out of range. Valid range: ${allowMain ? 0 : 1}-${maxIndex} (0 = main greeting).`);
        return null;
    }

    if (index === 0 && !allowMain) {
        toastr.warning('Index 0 (main greeting) is not allowed for this command.');
        return null;
    }

    return index;
}

/**
 * Saves the character's greeting data after modifications using the merge-attributes API.
 * @param {string} chid - Character ID
 * @returns {Promise<boolean>} Whether the save was successful
 */
async function saveCharacterGreetings(chid) {
    const character = characters[chid];
    if (!character) return false;

    const updateData = {
        avatar: character.avatar,
        first_mes: character.first_mes,
        data: {
            first_mes: character.first_mes,
            alternate_greetings: character.data?.alternate_greetings ?? [],
        },
    };

    try {
        const response = await fetch('/api/characters/merge-attributes', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify(updateData),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.message || `Server returned ${response.status}`);
        }

        // Refresh in-memory character data
        await getOneCharacter(character.avatar);
        await eventSource.emit(event_types.CHARACTER_EDITED, { detail: { id: chid, character: characters[chid] } });

        updateButtonAppearance(chid);
        return true;
    } catch (error) {
        console.error('[GreetingTools] Failed to save character greetings:', error);
        toastr.error(`Failed to save greeting: ${error.message}`);
        return false;
    }
}

/**
 * Provides enum values for greeting indices of the current character.
 * @returns {() => SlashCommandEnumValue[]}
 */
function greetingIndexEnumProvider() {
    return () => {
        if (this_chid === undefined) return [];
        const character = characters[this_chid];
        if (!character) return [];

        const metadata = getGreetingToolsData({ chid: this_chid });
        const altGreetings = character.data?.alternate_greetings ?? [];
        const results = [];

        // Main greeting
        const mainTitle = metadata.mainGreeting?.title || 'Main Greeting';
        results.push(new SlashCommandEnumValue('0', mainTitle, enumTypes.number, '🏠'));

        // Alternate greetings
        for (let i = 0; i < altGreetings.length; i++) {
            const contentHash = getStringHash(altGreetings[i]);
            const matchedMeta = findGreetingMetadata(metadata, i, contentHash);
            const title = matchedMeta?.title || `Alternate Greeting #${i + 1}`;
            results.push(new SlashCommandEnumValue(String(i + 1), title, enumTypes.number, '💬'));
        }

        return results;
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Registration
// ─────────────────────────────────────────────────────────────────────────────

/** Registers all Greeting Tools slash commands. */
export function registerGreetingToolsSlashCommands() {
    // ── /greeting-list ───────────────────────────────────────────────────
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'greeting-list',
        aliases: ['greetings'],
        returns: 'JSON array of greeting objects with index, title, description, and content preview',
        callback: ({ name, full }) => {
            if (typeof name !== 'string' || !name.trim()) throw new Error('Character name must be a non-empty string');
            if (typeof full !== 'string') throw new Error('Full parameter must be a string');

            const resolved = resolveCharacter(name);
            if (!resolved) return '[]';

            const { chid, character } = resolved;
            const metadata = getGreetingToolsData({ chid });
            const includeFull = isTrueBoolean(full);
            const results = [];

            // Main greeting
            const mainContent = character.first_mes ?? '';
            const mainMeta = metadata.mainGreeting ?? {};
            results.push({
                index: 0,
                title: mainMeta.title || 'Main Greeting',
                description: mainMeta.description || '',
                ...(includeFull ? { content: mainContent } : { preview: mainContent.substring(0, 100) }),
            });

            // Alternate greetings
            const altGreetings = character.data?.alternate_greetings ?? [];
            for (let i = 0; i < altGreetings.length; i++) {
                const contentHash = getStringHash(altGreetings[i]);
                const matchedMeta = findGreetingMetadata(metadata, i, contentHash);
                results.push({
                    index: i + 1,
                    title: matchedMeta?.title || `Alternate Greeting #${i + 1}`,
                    description: matchedMeta?.description || '',
                    ...(includeFull ? { content: altGreetings[i] } : { preview: altGreetings[i].substring(0, 100) }),
                });
            }

            return JSON.stringify(results);
        },
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({
                name: 'name',
                description: 'Character name or avatar key',
                typeList: [ARGUMENT_TYPE.STRING],
                defaultValue: '{{char}}',
                enumProvider: commonEnumProviders.characters('character'),
            }),
            SlashCommandNamedArgument.fromProps({
                name: 'full',
                description: 'Include full greeting content instead of just a preview',
                typeList: [ARGUMENT_TYPE.BOOLEAN],
                defaultValue: 'false',
                enumList: commonEnumProviders.boolean('trueFalse')(),
            }),
        ],
        helpString: `
        <div>
            Lists all greetings for a character, including main and alternate greetings with their metadata (title, description).
            Returns a JSON array of greeting objects.
        </div>
        <div>
            <strong>Example:</strong>
            <ul>
                <li><pre><code>/greeting-list</code></pre> lists greetings for the current character.</li>
                <li><pre><code>/greeting-list name="Alice" full=true</code></pre> lists all greetings for Alice with full content.</li>
            </ul>
        </div>
        `,
    }));

    // ── /greeting-count ──────────────────────────────────────────────────
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'greeting-count',
        returns: 'The total number of greetings (main + alternates)',
        callback: ({ name }) => {
            if (typeof name !== 'string' || !name.trim()) throw new Error('Character name must be a non-empty string');

            const resolved = resolveCharacter(name);
            if (!resolved) return '0';

            const { character } = resolved;
            const altGreetings = character.data?.alternate_greetings ?? [];
            return String(1 + altGreetings.length);
        },
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({
                name: 'name',
                description: 'Character name or avatar key',
                typeList: [ARGUMENT_TYPE.STRING],
                defaultValue: '{{char}}',
                enumProvider: commonEnumProviders.characters('character'),
            }),
        ],
        helpString: `
        <div>
            Returns the total number of greetings for a character (1 main + alternates).
        </div>
        <div>
            <strong>Example:</strong>
            <ul>
                <li><pre><code>/greeting-count</code></pre> returns the count for the current character.</li>
            </ul>
        </div>
        `,
    }));

    // ── /greeting-get ────────────────────────────────────────────────────
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'greeting-get',
        returns: 'The greeting content as a string, or a JSON object if metadata=true',
        callback: ({ name, metadata: includeMeta }, indexStr) => {
            if (typeof name !== 'string' || !name.trim()) throw new Error('Character name must be a non-empty string');
            if (typeof includeMeta !== 'string') throw new Error('Metadata parameter must be a string');
            if (typeof indexStr !== 'string' || !indexStr) throw new Error('Index parameter is required');

            const resolved = resolveCharacter(name);
            if (!resolved) return '';

            const { chid, character } = resolved;
            const index = parseGreetingIndex(indexStr, character);
            if (index === null) return '';

            let content;
            if (index === 0) {
                content = character.first_mes ?? '';
            } else {
                content = character.data?.alternate_greetings?.[index - 1] ?? '';
            }

            if (isTrueBoolean(includeMeta)) {
                const meta = getGreetingToolsData({ chid });
                let title = '';
                let description = '';

                if (index === 0) {
                    title = meta.mainGreeting?.title || '';
                    description = meta.mainGreeting?.description || '';
                } else {
                    const contentHash = getStringHash(content);
                    const matched = findGreetingMetadata(meta, index - 1, contentHash);
                    title = matched?.title || '';
                    description = matched?.description || '';
                }

                return JSON.stringify({ index, title, description, content });
            }

            return content;
        },
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({
                name: 'name',
                description: 'Character name or avatar key',
                typeList: [ARGUMENT_TYPE.STRING],
                defaultValue: '{{char}}',
                enumProvider: commonEnumProviders.characters('character'),
            }),
            SlashCommandNamedArgument.fromProps({
                name: 'metadata',
                description: 'Return a JSON object with title, description, and content instead of just content',
                typeList: [ARGUMENT_TYPE.BOOLEAN],
                defaultValue: 'false',
                enumList: commonEnumProviders.boolean('trueFalse')(),
            }),
        ],
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'Greeting index (0 = main greeting, 1+ = alternate greetings)',
                typeList: [ARGUMENT_TYPE.NUMBER],
                isRequired: true,
                enumProvider: greetingIndexEnumProvider(),
            }),
        ],
        helpString: `
        <div>
            Gets a greeting's content by index. Use <code>0</code> for the main greeting, <code>1</code>+ for alternates.
            With <code>metadata=true</code>, returns a JSON object including title and description.
        </div>
        <div>
            <strong>Example:</strong>
            <ul>
                <li><pre><code>/greeting-get 0</code></pre> returns the main greeting content.</li>
                <li><pre><code>/greeting-get metadata=true 2</code></pre> returns greeting #2 as JSON with metadata.</li>
            </ul>
        </div>
        `,
    }));

    // ── /greeting-add ────────────────────────────────────────────────────
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'greeting-add',
        returns: 'The index of the newly added greeting',
        callback: async ({ name, title, description }, content) => {
            if (typeof name !== 'string' || !name.trim()) throw new Error('Character name must be a non-empty string');
            if (typeof title !== 'string') throw new Error('Title must be a string');
            if (typeof description !== 'string') throw new Error('Description must be a string');
            if (typeof content !== 'string') throw new Error('Content must be a string');

            const resolved = resolveCharacter(name);
            if (!resolved) return '';

            const { chid, character } = resolved;

            if (!character.data) character.data = {};
            if (!Array.isArray(character.data.alternate_greetings)) {
                character.data.alternate_greetings = [];
            }

            const newIndex = character.data.alternate_greetings.length;
            character.data.alternate_greetings.push(content || '');

            // Save metadata if title or description provided
            if (title || description) {
                const metadata = getGreetingToolsData({ chid });
                const id = generateGreetingId();
                metadata.greetings[id] = {
                    id,
                    title: title || '',
                    description: description || '',
                    contentHash: getStringHash(content || ''),
                };
                if (!metadata.indexMap) metadata.indexMap = {};
                metadata.indexMap[newIndex] = id;
                await saveGreetingToolsData(metadata, { chid });
            }

            await saveCharacterGreetings(chid);
            return String(newIndex + 1);
        },
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({
                name: 'name',
                description: 'Character name or avatar key',
                typeList: [ARGUMENT_TYPE.STRING],
                defaultValue: '{{char}}',
                enumProvider: commonEnumProviders.characters('character'),
            }),
            SlashCommandNamedArgument.fromProps({
                name: 'title',
                description: 'Title for the new greeting',
                typeList: [ARGUMENT_TYPE.STRING],
            }),
            SlashCommandNamedArgument.fromProps({
                name: 'description',
                description: 'Description for the new greeting',
                typeList: [ARGUMENT_TYPE.STRING],
            }),
        ],
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'The greeting content text',
                typeList: [ARGUMENT_TYPE.STRING],
                isRequired: true,
            }),
        ],
        helpString: `
        <div>
            Adds a new alternate greeting to a character. Optionally set a title and description.
        </div>
        <div>
            <strong>Example:</strong>
            <ul>
                <li><pre><code>/greeting-add title="Café Meeting" *{{char}} sits at a small table* Hey there!</code></pre></li>
            </ul>
        </div>
        `,
    }));

    // ── /greeting-set ────────────────────────────────────────────────────
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'greeting-set',
        returns: 'true/false - Whether the greeting was updated',
        callback: async ({ name, at }, content) => {
            if (typeof name !== 'string' || !name.trim()) throw new Error('Character name must be a non-empty string');
            if (typeof at !== 'string') throw new Error('at parameter must be a string');
            if (typeof content !== 'string') throw new Error('Content must be a string');

            const resolved = resolveCharacter(name);
            if (!resolved) return 'false';

            const { chid, character } = resolved;
            const index = parseGreetingIndex(at, character);
            if (index === null) return 'false';

            if (index === 0) {
                character.first_mes = content;
                if (String(this_chid) === chid) {
                    const textarea = document.querySelector('#firstmessage_textarea');
                    if (textarea instanceof HTMLTextAreaElement) {
                        textarea.value = content;
                    }
                }
            } else {
                if (!character.data?.alternate_greetings) return 'false';
                character.data.alternate_greetings[index - 1] = content;
            }

            // Update content hash in metadata
            const metadata = getGreetingToolsData({ chid });
            if (index === 0 && metadata.mainGreeting) {
                metadata.mainGreeting.contentHash = getStringHash(content);
            } else if (index > 0) {
                const mappedId = metadata.indexMap?.[index - 1];
                if (mappedId && metadata.greetings[mappedId]) {
                    metadata.greetings[mappedId].contentHash = getStringHash(content);
                }
            }
            await saveGreetingToolsData(metadata, { chid });

            await saveCharacterGreetings(chid);
            return 'true';
        },
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({
                name: 'name',
                description: 'Character name or avatar key',
                typeList: [ARGUMENT_TYPE.STRING],
                defaultValue: '{{char}}',
                enumProvider: commonEnumProviders.characters('character'),
            }),
            SlashCommandNamedArgument.fromProps({
                name: 'at',
                description: 'Greeting index to update (0 = main, 1+ = alternate)',
                typeList: [ARGUMENT_TYPE.NUMBER],
                isRequired: true,
                enumProvider: greetingIndexEnumProvider(),
            }),
        ],
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'New greeting content',
                typeList: [ARGUMENT_TYPE.STRING],
                isRequired: true,
            }),
        ],
        helpString: `
        <div>
            Replaces the content of a greeting at the given index.
            Use <code>0</code> for the main greeting, <code>1</code>+ for alternates.
        </div>
        <div>
            <strong>Example:</strong>
            <ul>
                <li><pre><code>/greeting-set at=0 *New main greeting text*</code></pre></li>
                <li><pre><code>/greeting-set at=2 name="Alice" *Updated alternate greeting*</code></pre></li>
            </ul>
        </div>
        `,
    }));

    // ── /greeting-delete ─────────────────────────────────────────────────
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'greeting-delete',
        aliases: ['greeting-remove'],
        returns: 'true/false - Whether the greeting was deleted',
        callback: async ({ name }, indexStr) => {
            const resolved = resolveCharacter(name);
            if (!resolved) return 'false';

            const { chid, character } = resolved;
            const index = parseGreetingIndex(indexStr, character, { allowMain: false });
            if (index === null) return 'false';

            const altIndex = index - 1;
            character.data.alternate_greetings.splice(altIndex, 1);

            // Rebuild metadata index map
            const metadata = getGreetingToolsData({ chid });
            const oldId = metadata.indexMap?.[altIndex];
            if (oldId) {
                delete metadata.greetings[oldId];
            }
            // Rebuild indexMap for remaining greetings
            const newIndexMap = {};
            const altGreetings = character.data.alternate_greetings;
            for (let i = 0; i < altGreetings.length; i++) {
                const contentHash = getStringHash(altGreetings[i]);
                const matched = findGreetingMetadata(metadata, i, contentHash);
                if (matched?.id) {
                    newIndexMap[i] = matched.id;
                }
            }
            metadata.indexMap = newIndexMap;
            await saveGreetingToolsData(metadata, { chid });

            await saveCharacterGreetings(chid);
            return 'true';
        },
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({
                name: 'name',
                description: 'Character name or avatar key',
                typeList: [ARGUMENT_TYPE.STRING],
                defaultValue: '{{char}}',
                enumProvider: commonEnumProviders.characters('character'),
            }),
        ],
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'Index of the alternate greeting to delete (1+, cannot delete main greeting)',
                typeList: [ARGUMENT_TYPE.NUMBER],
                isRequired: true,
                enumProvider: greetingIndexEnumProvider(),
            }),
        ],
        helpString: `
        <div>
            Deletes an alternate greeting by index. The main greeting (index 0) cannot be deleted.
        </div>
        <div>
            <strong>Example:</strong>
            <ul>
                <li><pre><code>/greeting-delete 3</code></pre> deletes alternate greeting #3.</li>
            </ul>
        </div>
        `,
    }));

    // ── /greeting-move ───────────────────────────────────────────────────
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'greeting-move',
        aliases: ['greeting-reorder'],
        returns: 'true/false - Whether the greeting was moved',
        callback: async ({ name, from, to }) => {
            const resolved = resolveCharacter(name);
            if (!resolved) return 'false';

            const { chid, character } = resolved;
            const fromIndex = parseGreetingIndex(from, character, { allowMain: false });
            const toIndex = parseGreetingIndex(to, character, { allowMain: false });
            if (fromIndex === null || toIndex === null) return 'false';
            if (fromIndex === toIndex) return 'true';

            const altGreetings = character.data.alternate_greetings;
            const fromAlt = fromIndex - 1;
            const toAlt = toIndex - 1;

            // Remove and re-insert
            const [moved] = altGreetings.splice(fromAlt, 1);
            altGreetings.splice(toAlt, 0, moved);

            // Rebuild metadata index map
            const metadata = getGreetingToolsData({ chid });
            const newIndexMap = {};
            for (let i = 0; i < altGreetings.length; i++) {
                const contentHash = getStringHash(altGreetings[i]);
                const matched = findGreetingMetadata(metadata, i, contentHash);
                if (matched?.id) {
                    newIndexMap[i] = matched.id;
                }
            }
            metadata.indexMap = newIndexMap;
            await saveGreetingToolsData(metadata, { chid });

            await saveCharacterGreetings(chid);
            return 'true';
        },
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({
                name: 'name',
                description: 'Character name or avatar key',
                typeList: [ARGUMENT_TYPE.STRING],
                defaultValue: '{{char}}',
                enumProvider: commonEnumProviders.characters('character'),
            }),
            SlashCommandNamedArgument.fromProps({
                name: 'from',
                description: 'Index of the greeting to move (1+)',
                typeList: [ARGUMENT_TYPE.NUMBER],
                isRequired: true,
                enumProvider: greetingIndexEnumProvider(),
            }),
            SlashCommandNamedArgument.fromProps({
                name: 'to',
                description: 'Target index to move the greeting to (1+)',
                typeList: [ARGUMENT_TYPE.NUMBER],
                isRequired: true,
                enumProvider: greetingIndexEnumProvider(),
            }),
        ],
        helpString: `
        <div>
            Moves an alternate greeting from one position to another.
            Only alternate greetings (1+) can be reordered.
        </div>
        <div>
            <strong>Example:</strong>
            <ul>
                <li><pre><code>/greeting-move from=3 to=1</code></pre> moves greeting #3 to position #1.</li>
            </ul>
        </div>
        `,
    }));

    // ── /greeting-swap-main ──────────────────────────────────────────────
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'greeting-swap-main',
        returns: 'true/false - Whether the swap was performed',
        callback: async ({ name }, indexStr) => {
            const resolved = resolveCharacter(name);
            if (!resolved) return 'false';

            const { chid, character } = resolved;
            const index = parseGreetingIndex(indexStr, character, { allowMain: false });
            if (index === null) return 'false';

            const altIndex = index - 1;
            const altGreetings = character.data.alternate_greetings;

            // Swap content
            const mainContent = character.first_mes;
            character.first_mes = altGreetings[altIndex];
            altGreetings[altIndex] = mainContent;

            // Update character panel textarea if this is the current character
            if (String(this_chid) === chid) {
                const textarea = document.querySelector('#firstmessage_textarea');
                if (textarea instanceof HTMLTextAreaElement) {
                    textarea.value = character.first_mes;
                }
            }

            // Swap metadata
            const metadata = getGreetingToolsData({ chid });
            const oldMainMeta = { ...(metadata.mainGreeting ?? {}) };
            const altContentHash = getStringHash(altGreetings[altIndex]);
            const altMeta = findGreetingMetadata(metadata, altIndex, altContentHash);

            // New main gets the alt's metadata
            metadata.mainGreeting = altMeta ? { ...altMeta, contentHash: getStringHash(character.first_mes) } : {};

            // Old main gets inserted into alt metadata
            if (oldMainMeta.id) {
                oldMainMeta.contentHash = altContentHash;
                metadata.greetings[oldMainMeta.id] = oldMainMeta;
                if (!metadata.indexMap) metadata.indexMap = {};
                metadata.indexMap[altIndex] = oldMainMeta.id;
            }

            await saveGreetingToolsData(metadata, { chid });
            await saveCharacterGreetings(chid);
            return 'true';
        },
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({
                name: 'name',
                description: 'Character name or avatar key',
                typeList: [ARGUMENT_TYPE.STRING],
                defaultValue: '{{char}}',
                enumProvider: commonEnumProviders.characters('character'),
            }),
        ],
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'Index of the alternate greeting to swap with the main greeting (1+)',
                typeList: [ARGUMENT_TYPE.NUMBER],
                isRequired: true,
                enumProvider: greetingIndexEnumProvider(),
            }),
        ],
        helpString: `
        <div>
            Swaps the main greeting with the specified alternate greeting. The current main becomes the alternate and vice versa.
        </div>
        <div>
            <strong>Example:</strong>
            <ul>
                <li><pre><code>/greeting-swap-main 2</code></pre> swaps the main greeting with alternate #2.</li>
            </ul>
        </div>
        `,
    }));

    // ── /greeting-meta-set ───────────────────────────────────────────────
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'greeting-meta-set',
        aliases: ['greeting-title'],
        returns: 'true/false - Whether metadata was updated',
        callback: async ({ name, at, title, description }) => {
            const resolved = resolveCharacter(name);
            if (!resolved) return 'false';

            const { chid, character } = resolved;
            const index = parseGreetingIndex(at, character);
            if (index === null) return 'false';

            if (title === undefined && description === undefined) {
                toastr.warning('At least one of title= or description= must be provided.');
                return 'false';
            }

            const metadata = getGreetingToolsData({ chid });

            if (index === 0) {
                // Main greeting metadata
                if (!metadata.mainGreeting) {
                    metadata.mainGreeting = { id: generateGreetingId(), contentHash: getStringHash(character.first_mes ?? '') };
                }
                if (title !== undefined) metadata.mainGreeting.title = title;
                if (description !== undefined) metadata.mainGreeting.description = description;
            } else {
                // Alternate greeting metadata
                const altIndex = index - 1;
                const content = character.data?.alternate_greetings?.[altIndex] ?? '';
                const contentHash = getStringHash(content);
                let matched = findGreetingMetadata(metadata, altIndex, contentHash);

                if (!matched) {
                    const id = generateGreetingId();
                    matched = { id, contentHash };
                    metadata.greetings[id] = matched;
                    if (!metadata.indexMap) metadata.indexMap = {};
                    metadata.indexMap[altIndex] = id;
                }

                if (title !== undefined) matched.title = title;
                if (description !== undefined) matched.description = description;
            }

            await saveGreetingToolsData(metadata, { chid });
            return 'true';
        },
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({
                name: 'name',
                description: 'Character name or avatar key',
                typeList: [ARGUMENT_TYPE.STRING],
                defaultValue: '{{char}}',
                enumProvider: commonEnumProviders.characters('character'),
            }),
            SlashCommandNamedArgument.fromProps({
                name: 'at',
                description: 'Greeting index (0 = main, 1+ = alternate)',
                typeList: [ARGUMENT_TYPE.NUMBER],
                isRequired: true,
                enumProvider: greetingIndexEnumProvider(),
            }),
            SlashCommandNamedArgument.fromProps({
                name: 'title',
                description: 'New title for the greeting',
                typeList: [ARGUMENT_TYPE.STRING],
            }),
            SlashCommandNamedArgument.fromProps({
                name: 'description',
                description: 'New description for the greeting',
                typeList: [ARGUMENT_TYPE.STRING],
            }),
        ],
        helpString: `
        <div>
            Sets the title and/or description metadata for a greeting.
            At least one of <code>title</code> or <code>description</code> must be provided.
        </div>
        <div>
            <strong>Example:</strong>
            <ul>
                <li><pre><code>/greeting-meta-set at=0 title="Moonlit Meeting"</code></pre></li>
                <li><pre><code>/greeting-meta-set at=2 title="Beach Episode" description="A fun day at the beach"</code></pre></li>
            </ul>
        </div>
        `,
    }));

    // ── /greeting-meta-get ───────────────────────────────────────────────
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'greeting-meta-get',
        returns: 'JSON object with title and description, or just the field value if field= is specified',
        callback: ({ name, at, field }) => {
            const resolved = resolveCharacter(name);
            if (!resolved) return '';

            const { chid, character } = resolved;
            const index = parseGreetingIndex(at, character);
            if (index === null) return '';

            const metadata = getGreetingToolsData({ chid });
            let title = '';
            let description = '';

            if (index === 0) {
                title = metadata.mainGreeting?.title || '';
                description = metadata.mainGreeting?.description || '';
            } else {
                const altIndex = index - 1;
                const content = character.data?.alternate_greetings?.[altIndex] ?? '';
                const contentHash = getStringHash(content);
                const matched = findGreetingMetadata(metadata, altIndex, contentHash);
                title = matched?.title || '';
                description = matched?.description || '';
            }

            if (field === 'title') return title;
            if (field === 'description') return description;
            return JSON.stringify({ title, description });
        },
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({
                name: 'name',
                description: 'Character name or avatar key',
                typeList: [ARGUMENT_TYPE.STRING],
                defaultValue: '{{char}}',
                enumProvider: commonEnumProviders.characters('character'),
            }),
            SlashCommandNamedArgument.fromProps({
                name: 'at',
                description: 'Greeting index (0 = main, 1+ = alternate)',
                typeList: [ARGUMENT_TYPE.NUMBER],
                isRequired: true,
                enumProvider: greetingIndexEnumProvider(),
            }),
            SlashCommandNamedArgument.fromProps({
                name: 'field',
                description: 'Return only a specific field instead of JSON',
                typeList: [ARGUMENT_TYPE.STRING],
                enumList: [
                    new SlashCommandEnumValue('title', 'Return only the title', enumTypes.enum),
                    new SlashCommandEnumValue('description', 'Return only the description', enumTypes.enum),
                ],
            }),
        ],
        helpString: `
        <div>
            Gets the metadata (title and description) for a greeting. Returns JSON by default, or a single field with <code>field=</code>.
        </div>
        <div>
            <strong>Example:</strong>
            <ul>
                <li><pre><code>/greeting-meta-get at=0</code></pre> returns <code>{"title":"...","description":"..."}</code></li>
                <li><pre><code>/greeting-meta-get at=1 field=title</code></pre> returns just the title string.</li>
            </ul>
        </div>
        `,
    }));

    // ── /greeting-select ─────────────────────────────────────────────────
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'greeting-select',
        aliases: ['greeting-switch'],
        returns: 'true/false - Whether the greeting was switched',
        callback: async (_args, indexStr) => {
            if (!chat || chat.length === 0) {
                toastr.warning('No active chat.');
                return 'false';
            }
            if (chat.length !== 1) {
                toastr.warning('Greeting can only be changed when the chat has exactly one message.');
                return 'false';
            }

            const firstMessage = chat[0];
            if (!Array.isArray(firstMessage.swipes) || firstMessage.swipes.length <= 1) {
                const character = characters[this_chid];
                const altCount = character?.data?.alternate_greetings?.length ?? 0;
                if (altCount === 0) {
                    toastr.warning('No alternate greetings available.');
                    return 'false';
                }
            }

            const swipeIndex = parseInt(indexStr, 10);
            if (isNaN(swipeIndex) || swipeIndex < 0) {
                toastr.warning('Invalid greeting index.');
                return 'false';
            }

            const maxIndex = (firstMessage.swipes?.length ?? 1) - 1;
            if (swipeIndex > maxIndex) {
                toastr.warning(`Greeting index out of range. Max: ${maxIndex}`);
                return 'false';
            }

            await switchToGreeting(swipeIndex);
            return 'true';
        },
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'Swipe index to switch to (0 = main greeting)',
                typeList: [ARGUMENT_TYPE.NUMBER],
                isRequired: true,
                enumProvider: greetingIndexEnumProvider(),
            }),
        ],
        helpString: `
        <div>
            Switches the active greeting in the current chat to the specified index.
            Only works when the chat has exactly one message (the greeting).
        </div>
        <div>
            <strong>Example:</strong>
            <ul>
                <li><pre><code>/greeting-select 2</code></pre> switches to alternate greeting #2.</li>
            </ul>
        </div>
        `,
    }));

    // ── /greeting-generate ───────────────────────────────────────────────
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'greeting-generate',
        returns: 'The generated greeting content, or a JSON object if save=true (with index, title, description, content)',
        callback: async ({ name, prompt, save, title: generateTitle, replace: replaceMacros }) => {
            const resolved = resolveCharacter(name);
            if (!resolved) return '';

            const { chid, character } = resolved;
            const shouldSave = isTrueBoolean(save);
            const shouldGenerateTitle = generateTitle === undefined ? true : isTrueBoolean(generateTitle);
            const shouldReplaceMacros = replaceMacros === undefined
                ? greetingToolsSettings.replaceNamesWithMacros
                : isTrueBoolean(replaceMacros);

            // Generate the greeting content
            let content = await generateGreetingContent(prompt || '', {
                loaderMessage: 'Generating greeting via slash command...',
            });
            if (!content) return '';

            // Optionally replace names with macros (override the setting-based replacement that already happened)
            if (!greetingToolsSettings.replaceNamesWithMacros && shouldReplaceMacros) {
                content = replaceNamesWithMacros(content);
            }

            let generatedTitle = '';
            let generatedDesc = '';

            if (shouldGenerateTitle) {
                const titleResult = await generateTitleAndDescription(content);
                if (titleResult) {
                    generatedTitle = titleResult.title;
                    generatedDesc = titleResult.description;
                }
            }

            // Optionally save as new alternate greeting
            if (shouldSave) {
                if (!character.data) character.data = {};
                if (!Array.isArray(character.data.alternate_greetings)) {
                    character.data.alternate_greetings = [];
                }

                const newIndex = character.data.alternate_greetings.length;
                character.data.alternate_greetings.push(content);

                // Save metadata
                if (generatedTitle || generatedDesc) {
                    const metadata = getGreetingToolsData({ chid });
                    const id = generateGreetingId();
                    metadata.greetings[id] = {
                        id,
                        title: generatedTitle,
                        description: generatedDesc,
                        contentHash: getStringHash(content),
                    };
                    if (!metadata.indexMap) metadata.indexMap = {};
                    metadata.indexMap[newIndex] = id;
                    await saveGreetingToolsData(metadata, { chid });
                }

                await saveCharacterGreetings(chid);

                return JSON.stringify({
                    index: newIndex + 1,
                    title: generatedTitle,
                    description: generatedDesc,
                    content,
                });
            }

            // Return just the content if not saving
            if (generatedTitle || generatedDesc) {
                return JSON.stringify({
                    title: generatedTitle,
                    description: generatedDesc,
                    content,
                });
            }
            return content;
        },
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({
                name: 'name',
                description: 'Character name or avatar key',
                typeList: [ARGUMENT_TYPE.STRING],
                defaultValue: '{{char}}',
                enumProvider: commonEnumProviders.characters('character'),
            }),
            SlashCommandNamedArgument.fromProps({
                name: 'prompt',
                description: 'Custom scenario/theme prompt for the generation (leave empty for a general greeting)',
                typeList: [ARGUMENT_TYPE.STRING],
            }),
            SlashCommandNamedArgument.fromProps({
                name: 'save',
                description: 'Automatically save the generated greeting as a new alternate greeting',
                typeList: [ARGUMENT_TYPE.BOOLEAN],
                defaultValue: 'false',
                enumList: commonEnumProviders.boolean('trueFalse')(),
            }),
            SlashCommandNamedArgument.fromProps({
                name: 'title',
                description: 'Also generate a title and description for the greeting (default: true)',
                typeList: [ARGUMENT_TYPE.BOOLEAN],
                defaultValue: 'true',
                enumList: commonEnumProviders.boolean('trueFalse')(),
            }),
            SlashCommandNamedArgument.fromProps({
                name: 'replace',
                description: 'Replace character/user names with {{char}}/{{user}} macros (default: uses extension setting)',
                typeList: [ARGUMENT_TYPE.BOOLEAN],
                enumList: commonEnumProviders.boolean('trueFalse')(),
            }),
        ],
        helpString: `
        <div>
            Generates a new greeting using the LLM. Optionally saves it as a new alternate greeting.
        </div>
        <div>
            <strong>Example:</strong>
            <ul>
                <li><pre><code>/greeting-generate</code></pre> generates a general greeting for the current character.</li>
                <li><pre><code>/greeting-generate prompt="A rainy day in the park" save=true</code></pre> generates and saves a themed greeting.</li>
                <li><pre><code>/greeting-generate title=false</code></pre> generates content only, no title/description.</li>
            </ul>
        </div>
        `,
    }));

    // ── /greeting-autofill ───────────────────────────────────────────────
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'greeting-autofill',
        aliases: ['greeting-auto-title'],
        returns: 'JSON object with generated title and description, or empty string on failure',
        callback: async ({ name, at }) => {
            const resolved = resolveCharacter(name);
            if (!resolved) return '';

            const { chid, character } = resolved;
            const index = parseGreetingIndex(at, character);
            if (index === null) return '';

            let content;
            if (index === 0) {
                content = character.first_mes ?? '';
            } else {
                content = character.data?.alternate_greetings?.[index - 1] ?? '';
            }

            if (!content.trim()) {
                toastr.warning('Cannot generate title for an empty greeting.');
                return '';
            }

            const result = await generateTitleAndDescription(content);
            if (!result) return '';

            // Save the generated metadata
            const metadata = getGreetingToolsData({ chid });

            if (index === 0) {
                if (!metadata.mainGreeting) {
                    metadata.mainGreeting = { id: generateGreetingId(), contentHash: getStringHash(content) };
                }
                metadata.mainGreeting.title = result.title;
                metadata.mainGreeting.description = result.description;
            } else {
                const altIndex = index - 1;
                const contentHash = getStringHash(content);
                let matched = findGreetingMetadata(metadata, altIndex, contentHash);

                if (!matched) {
                    const id = generateGreetingId();
                    matched = { id, contentHash };
                    metadata.greetings[id] = matched;
                    if (!metadata.indexMap) metadata.indexMap = {};
                    metadata.indexMap[altIndex] = id;
                }

                matched.title = result.title;
                matched.description = result.description;
            }

            await saveGreetingToolsData(metadata, { chid });

            return JSON.stringify(result);
        },
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({
                name: 'name',
                description: 'Character name or avatar key',
                typeList: [ARGUMENT_TYPE.STRING],
                defaultValue: '{{char}}',
                enumProvider: commonEnumProviders.characters('character'),
            }),
            SlashCommandNamedArgument.fromProps({
                name: 'at',
                description: 'Greeting index to auto-fill (0 = main, 1+ = alternate)',
                typeList: [ARGUMENT_TYPE.NUMBER],
                isRequired: true,
                enumProvider: greetingIndexEnumProvider(),
            }),
        ],
        helpString: `
        <div>
            Uses the LLM to automatically generate a title and description for an existing greeting based on its content.
            The generated metadata is saved to the greeting.
        </div>
        <div>
            <strong>Example:</strong>
            <ul>
                <li><pre><code>/greeting-autofill at=0</code></pre> auto-generates title/description for the main greeting.</li>
                <li><pre><code>/greeting-autofill at=3</code></pre> auto-generates for alternate greeting #3.</li>
            </ul>
        </div>
        `,
    }));

    // ── /greeting-duplicate ──────────────────────────────────────────────
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'greeting-duplicate',
        aliases: ['greeting-copy'],
        returns: 'The index of the new duplicate greeting',
        callback: async ({ name }, indexStr) => {
            const resolved = resolveCharacter(name);
            if (!resolved) return '';

            const { chid, character } = resolved;
            const index = parseGreetingIndex(indexStr, character);
            if (index === null) return '';

            let content;
            if (index === 0) {
                content = character.first_mes ?? '';
            } else {
                content = character.data?.alternate_greetings?.[index - 1] ?? '';
            }

            if (!character.data) character.data = {};
            if (!Array.isArray(character.data.alternate_greetings)) {
                character.data.alternate_greetings = [];
            }

            const newIndex = character.data.alternate_greetings.length;
            character.data.alternate_greetings.push(content);

            // Copy metadata
            const metadata = getGreetingToolsData({ chid });
            let sourceTitle = '';
            let sourceDesc = '';

            if (index === 0) {
                sourceTitle = metadata.mainGreeting?.title || '';
                sourceDesc = metadata.mainGreeting?.description || '';
            } else {
                const contentHash = getStringHash(content);
                const matched = findGreetingMetadata(metadata, index - 1, contentHash);
                sourceTitle = matched?.title || '';
                sourceDesc = matched?.description || '';
            }

            if (sourceTitle || sourceDesc) {
                const id = generateGreetingId();
                metadata.greetings[id] = {
                    id,
                    title: sourceTitle ? `${sourceTitle} (copy)` : '',
                    description: sourceDesc,
                    contentHash: getStringHash(content),
                };
                if (!metadata.indexMap) metadata.indexMap = {};
                metadata.indexMap[newIndex] = id;
                await saveGreetingToolsData(metadata, { chid });
            }

            await saveCharacterGreetings(chid);
            return String(newIndex + 1);
        },
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({
                name: 'name',
                description: 'Character name or avatar key',
                typeList: [ARGUMENT_TYPE.STRING],
                defaultValue: '{{char}}',
                enumProvider: commonEnumProviders.characters('character'),
            }),
        ],
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'Index of the greeting to duplicate (0 = main, 1+ = alternate)',
                typeList: [ARGUMENT_TYPE.NUMBER],
                isRequired: true,
                enumProvider: greetingIndexEnumProvider(),
            }),
        ],
        helpString: `
        <div>
            Duplicates a greeting as a new alternate greeting. Copies both content and metadata (title/description).
        </div>
        <div>
            <strong>Example:</strong>
            <ul>
                <li><pre><code>/greeting-duplicate 0</code></pre> duplicates the main greeting as a new alternate.</li>
                <li><pre><code>/greeting-duplicate 2</code></pre> duplicates alternate greeting #2.</li>
            </ul>
        </div>
        `,
    }));

    console.debug('[GreetingTools] Slash commands registered');
}
