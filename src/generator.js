/**
 * Shared greeting generation utilities.
 * Used by both the Greeting Tools popup and the inline greeting selector.
 */

import { characters, generateRaw, substituteParams, name1, name2, this_chid } from '../../../../../script.js';
import { ConnectionManagerRequestService } from '../../../../extensions/shared.js';
import { Popup, POPUP_TYPE } from '../../../../popup.js';
import { t } from '../../../../i18n.js';
import { escapeRegex } from '../../../../utils.js';
import { greetingToolsSettings, isConnectionManagerAvailable } from './settings.js';
import { getGreetingToolsData, generateGreetingId } from './data.js';
import { StreamingDisplay } from '../../../../streaming-display.js';
import { loader } from '/scripts/action-loader.js';

/**
 * Default max tokens for connection profile generation requests.
 * Used when generating via ConnectionManagerRequestService instead of the main model.
 */
const CONNECTION_PROFILE_MAX_TOKENS = 2048;

/** Default placeholder text for the generate greeting popup */
const GENERATE_GREETING_PLACEHOLDER = t`Describe what kind of greeting scenario you want to generate. Leave empty for a general new greeting based on the character.`;

/**
 * @typedef {Object} GeneratePopupResult
 * @property {string} prompt - The custom prompt text (empty for default)
 * @property {boolean} generateTitleDesc - Whether to generate title and description
 */

/**
 * Shows a popup for the user to enter a custom prompt for greeting generation.
 * @param {object} [options] - Popup options
 * @param {string} [options.title] - Custom title for the popup (default: "Generate Greeting")
 * @returns {Promise<GeneratePopupResult | null>} The options or null if cancelled
 */
export async function showGenerateGreetingPopup({ title: popupTitle } = {}) {
    // Build custom popup content with checkbox
    const container = document.createElement('div');
    container.classList.add('flex-container', 'flexFlowColumn', 'gap5');

    const header = document.createElement('h3');
    header.textContent = popupTitle || t`Generate Greeting`;
    container.appendChild(header);

    const description = document.createElement('p');
    description.textContent = t`Scenario or prompt for the new greeting:`;
    container.appendChild(description);

    const popup = new Popup(container, POPUP_TYPE.INPUT, '', {
        large: false,
        rows: 7,
        placeholder: GENERATE_GREETING_PLACEHOLDER,
        okButton: t`Generate`,
        cancelButton: t`Cancel`,
        customInputs: [
            {
                type: 'checkbox',
                id: 'greeting_gen_title_desc',
                defaultState: true,
                label: t`Also generate title and description`,
            },
        ],
    });

    const result = await popup.show();
    if (typeof result !== 'string') return null;

    const generateTitleDesc = popup.inputResults.get('greeting_gen_title_desc');

    return {
        prompt: result.trim(),
        generateTitleDesc: generateTitleDesc === true,
    };
}

/**
 * Checks whether the given text contains the character or user name as whole words (case-sensitive).
 * @param {string} text - The text to check
 * @returns {boolean} True if the text contains either name
 */
export function textContainsNames(text) {
    if (!text) return false;

    const charName = characters[this_chid]?.name || name2 || '';
    const userName = name1 || '';

    if (charName && new RegExp(`\\b${escapeRegex(charName)}\\b`).test(text)) return true;
    if (userName && new RegExp(`\\b${escapeRegex(userName)}\\b`).test(text)) return true;

    return false;
}

/**
 * Replaces character and user names with macros in the given text (case-sensitive, whole word).
 * @param {string} text - The text to process
 * @returns {string} Text with names replaced by macros
 */
export function replaceNamesWithMacros(text) {
    const charName = characters[this_chid]?.name || name2 || '';
    const userName = name1 || '';    if (!charName && !userName) return text;

    let result = text;

    if (charName) {
        result = result.replace(new RegExp(`\\b${escapeRegex(charName)}\\b`, 'g'), '{{char}}');
    }
    if (userName) {
        result = result.replace(new RegExp(`\\b${escapeRegex(userName)}\\b`, 'g'), '{{user}}');
    }

    return result;
}

/**
 * Collects all existing greeting titles for context.
 * @param {string} [chid] - Character ID (defaults to this_chid)
 * @returns {string} Formatted list of existing titles, or empty string
 */
export function getAllExistingTitles(chid = this_chid) {
    const metadata = getGreetingToolsData({ chid });
    const titles = [];

    if (metadata.mainGreeting?.title) {
        titles.push(metadata.mainGreeting.title);
    }

    for (const greetingId of Object.keys(metadata.greetings)) {
        const greeting = metadata.greetings[greetingId];
        if (greeting?.title) {
            titles.push(greeting.title);
        }
    }

    return titles.length > 0 ? titles.map(t => `- ${t}`).join('\n') : '';
}

/**
 * Generates greeting content using LLM.
 * @param {string} customPrompt - Optional custom prompt from user
 * @param {object} [options] - Generation options
 * @param {string} [options.loaderMessage] - Custom loader message
 * @param {string} [options.existingTitles] - Pre-computed existing titles (if not provided, fetched from metadata)
 * @returns {Promise<string | null>} Generated greeting content or null on failure
 */
export async function generateGreetingContent(customPrompt, { loaderMessage, existingTitles: providedTitles } = {}) {
    // Build dynamic macros
    const existingTitles = providedTitles ?? getAllExistingTitles();
    const dynamicMacros = {
        existingTitles,
        customPrompt: customPrompt || '',
        greetingLength: greetingToolsSettings.greetingLengthValue,
    };

    // Substitute macros in system prompt (uses customizable prompt from settings)
    const systemPrompt = substituteParams(greetingToolsSettings.generateGreetingSystemPrompt, undefined, undefined, dynamicMacros);

    // Use configurable prompts from settings
    const promptTemplate = customPrompt
        ? greetingToolsSettings.generationPromptWithTheme
        : greetingToolsSettings.generationPromptWithoutTheme;
    const prompt = substituteParams(promptTemplate, undefined, undefined, dynamicMacros);

    const greetingLoader = loader.show({
        message: loaderMessage || t`Generating new greeting...`,
    });

    const display = new StreamingDisplay();
    display.show({ label: t`Generating greeting...`, icon: ConnectionManagerRequestService.getProfileIcon(greetingToolsSettings.connectionProfileId) });

    try {
        const { content: response, reasoning } = await callLLM(prompt, systemPrompt, {
            onStream: (update) => {
                display.updateReasoning(update.reasoning);
                display.updateContent(update.text);
            },
        });

        // For non-streaming: show reasoning if returned
        if (reasoning && !display.hasContent) {
            display.updateReasoning(reasoning);
        }

        console.info('[GreetingTools] Generated greeting content', { text: response, reasoning });

        if (!response || typeof response !== 'string') {
            toastr.error(t`No response from LLM`);
            return null;
        }

        // Clean up the response - remove any leading/trailing whitespace
        let content = response.trim();

        if (!content) {
            toastr.error(t`Generated content is empty`);
            return null;
        }

        // Replace character/user names with macros if setting is enabled
        if (greetingToolsSettings.replaceNamesWithMacros) {
            content = replaceNamesWithMacros(content);
        }

        return content;
    } catch (error) {
        console.error('[GreetingTools] Failed to generate greeting:', error);
        toastr.error(t`Failed to generate greeting`);
        return null;
    } finally {
        display.complete({ label: 'Generated Greeting' }); // Green LED, auto-hide after default delay
        await greetingLoader.hide();
    }
}

/**
 * Generates title and description for a greeting.
 * @param {string} greetingContent - The greeting content to generate title/desc for
 * @param {object} [options] - Generation options
 * @param {string} [options.existingTitles] - Already formatted existing titles string
 * @param {boolean} [options.showLoader=true] - Whether to show the blocking loader
 * @param {AbortSignal | null} [options.signal] - Optional abort signal to cancel the generation
 * @returns {Promise<{ title: string, description: string } | null>} Generated title/desc or null on failure
 */
export async function generateTitleAndDescription(greetingContent, { existingTitles, showLoader = true, signal = null } = {}) {
    if (!greetingContent || greetingContent.trim().length === 0) {
        toastr.warning(t`Cannot generate without greeting content`);
        return null;
    }

    const character = characters[this_chid];
    if (!character) return null;

    const titles = existingTitles ?? getAllExistingTitles();

    const dynamicMacros = {
        charDescription: character.description || '',
        charPersonality: character.personality || '',
        scenario: character.scenario || '',
        existingTitles: titles,
        titleLength: greetingToolsSettings.titleLengthValue,
        descriptionLength: greetingToolsSettings.descriptionLengthValue,
    };

    const systemPrompt = substituteParams(greetingToolsSettings.generateSystemPrompt, undefined, undefined, dynamicMacros);
    const prompt = greetingContent;

    const genLoader = showLoader
        ? loader.show({ message: t`Generating title and description...` })
        : null;

    const display = new StreamingDisplay();
    display.show({ label: t`Generating title & description...`, icon: ConnectionManagerRequestService.getProfileIcon(greetingToolsSettings.connectionProfileId) });

    try {
        const { content: response, reasoning } = await callLLM(prompt, systemPrompt, {
            onStream: (update) => {
                display.updateReasoning(update.reasoning);
                display.updateContent(update.text);
            },
            signal,
        });

        // For non-streaming: show reasoning if returned
        if (reasoning && !display.hasContent) {
            display.updateReasoning(reasoning);
        }

        // Log full response for debugging
        console.info('[GreetingTools] LLM response for title/description', { text: response, reasoning });

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
                console.log('[GreetingTools] Used fallback parsing for title/description response');
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
            console.log('[GreetingTools] Title/description generation was cancelled by user');
        } else {
            console.error('[GreetingTools] Failed to generate title/description:', error);
            toastr.error(t`Generation failed: ${error.message}`);
        }
        return null;
    } finally {
        display.complete({ label: 'Generated Greeting' }); // Green LED, auto-hide after default delay
        await genLoader?.hide();
    }
}

/**
 * @typedef {Object} GeneratedGreeting
 * @property {string} id - Unique greeting ID
 * @property {string} content - Generated greeting content
 * @property {string} title - Generated or default title
 * @property {string} description - Generated or empty description
 */

/**
 * Unified greeting generation flow - shows popup, generates content, optionally generates title/desc.
 * @param {object} [options] - Generation options
 * @param {string} [options.popupTitle] - Custom popup title
 * @param {string} [options.defaultTitle] - Default title if not generating title/desc
 * @param {string} [options.loaderMessage] - Custom loader message for content generation
 * @param {string} [options.existingTitles] - Pre-computed existing titles for context
 * @param {(content: string) => void} [options.onContentGenerated] - Callback after content is generated (before title/desc)
 * @returns {Promise<GeneratedGreeting | null>} Generated greeting data or null if cancelled/failed
 */
export async function generateGreetingFlow({
    popupTitle,
    defaultTitle = '',
    loaderMessage,
    existingTitles,
    onContentGenerated,
} = {}) {
    // Show popup
    const popupResult = await showGenerateGreetingPopup({ title: popupTitle });
    if (popupResult === null) return null;

    const { prompt: customPrompt, generateTitleDesc } = popupResult;

    /** @type {Set<JQuery<HTMLElement>>} */
    const tempToasts = new Set();

    // Show wrapping loader
    const wrappingLoader = loader.show({ toastMode: loader.ToastMode.NONE });

    try {
        // Generate content
        const content = await generateGreetingContent(customPrompt, {
            loaderMessage,
            existingTitles,
        });
        if (!content) return null;

        // Notify caller that content is ready (useful for UI updates)
        onContentGenerated?.(content);

        // Initialize result
        let title = defaultTitle;
        let description = '';

        if (generateTitleDesc) {
            // Show persistent success toast
            const successToast = toastr.success(t`Greeting content generated`, '', {
                timeOut: 0,
                extendedTimeOut: 0,
                tapToDismiss: false,
            });
            tempToasts.add(successToast);

            // Generate title/description
            const generated = await generateTitleAndDescription(content, { existingTitles });
            if (generated) {
                title = generated.title;
                description = generated.description;
            }
        }

        return {
            id: generateGreetingId(),
            content,
            title,
            description,
        };
    } finally {
        // Clear temp toasts
        for (const toast of tempToasts) {
            toastr.clear(toast, { force: true });
        }
        tempToasts.clear();
        await wrappingLoader.hide();
    }
}

/**
 * @typedef {Object} LLMResponse
 * @property {string} content - The generated text content
 * @property {string} reasoning - The reasoning/thinking text (empty if unavailable)
 */

/**
 * @typedef {Object} StreamUpdate
 * @property {string} text - Accumulated content text so far
 * @property {string} reasoning - Accumulated reasoning text so far
 */

/**
 * Calls the LLM with the given prompt and system prompt.
 * Uses ConnectionManagerRequestService if a connection profile is selected and available,
 * otherwise falls back to generateRaw with the main model.
 * When using CMRS with an onStream callback, enables streaming for live output.
 * @param {string} prompt - The user prompt
 * @param {string} systemPrompt - The system prompt
 * @param {Object} [options]
 * @param {(update: StreamUpdate) => void} [options.onStream] - Callback for streaming updates. Enables streaming when provided and CMRS is used.
 * @param {AbortSignal | null} [options.signal] - Optional abort signal to cancel the request
 * @returns {Promise<LLMResponse>} The LLM response with content and reasoning
 */
async function callLLM(prompt, systemPrompt, { onStream, signal = null } = {}) {
    const profileId = greetingToolsSettings.connectionProfileId;

    if (profileId && isConnectionManagerAvailable()) {
        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt },
        ];

        // Attempt streaming if callback provided
        if (onStream) {
            try {
                const streamResponse = await ConnectionManagerRequestService.sendRequest(
                    profileId,
                    messages,
                    CONNECTION_PROFILE_MAX_TOKENS,
                    { extractData: true, includePreset: true, stream: true, signal },
                );

                if (typeof streamResponse === 'function') {
                    const generator = /** @type {AsyncGenerator<import('../../../../custom-request.js').StreamResponse>} */ (streamResponse());
                    let finalText = '';
                    let finalReasoning = '';
                    for await (const chunk of generator) {
                        finalText = chunk.text;
                        finalReasoning = chunk.state?.reasoning || '';
                        onStream({ text: finalText, reasoning: finalReasoning });
                    }
                    return { content: finalText, reasoning: finalReasoning };
                }

                // Response wasn't a stream generator — extract as non-streaming
                return extractNonStreamingResponse(streamResponse);
            } catch (error) {
                console.warn('[GreetingTools] Streaming failed, falling back to non-streaming:', error);
            }
        }

        // Non-streaming path (default or fallback from failed streaming)
        const response = /** @type {import('../../../../custom-request.js').ExtractedData} */ (await ConnectionManagerRequestService.sendRequest(
            profileId,
            messages,
            CONNECTION_PROFILE_MAX_TOKENS,
            { extractData: true, includePreset: true, stream: false, signal },
        ));
        return extractNonStreamingResponse(response);
    }

    // Fallback: generateRaw (no streaming, no reasoning available)
    // generateRaw doesn't support AbortSignal, so check before and after
    signal?.throwIfAborted();
    const result = await generateRaw({
        prompt,
        systemPrompt,
        instructOverride: true,
    });
    signal?.throwIfAborted();
    return { content: result, reasoning: '' };
}

/**
 * Extracts content and reasoning from a non-streaming CMRS response.
 * @param {import('../../../../custom-request.js').ExtractedData | string} response
 * @returns {LLMResponse}
 */
function extractNonStreamingResponse(response) {
    if (typeof response === 'string') return { content: response, reasoning: '' };
    const extracted = /** @type {import('../../../../custom-request.js').ExtractedData} */ (response);
    return { content: extracted?.content || '', reasoning: extracted?.reasoning || '' };
}
