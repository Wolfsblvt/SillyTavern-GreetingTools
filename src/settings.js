/**
 * Settings management for Greeting Tools extension.
 * Handles loading, saving, and accessing extension settings.
 */

import { saveSettingsDebounced } from '../../../../../script.js';
import { extension_settings, renderExtensionTemplateAsync } from '../../../../extensions.js';
import { ConnectionManagerRequestService } from '../../../../extensions/shared.js';
import { t } from '../../../../i18n.js';
import { EXTENSION_KEY, EXTENSION_NAME } from '../index.js';
import { DEFAULT_GENERATE_SYSTEM_PROMPT, DEFAULT_GENERATE_GREETING_SYSTEM_PROMPT, DEFAULT_GENERATION_PROMPT_WITH_THEME, DEFAULT_GENERATION_PROMPT_WITHOUT_THEME } from './default-prompts.js';

/**
 * Predefined greeting length options.
 * Each value is the instruction text injected into the generation prompt as {{greetingLength}}.
 * @readonly
 * @enum {string}
 */
export const GREETING_LENGTH = /** @type {const} */ ({
    short: 'short (1-3 paragraphs)',
    medium: 'medium (3-5 paragraphs)',
    long: 'long (5-8 paragraphs)',
    very_long: 'very long (8+ paragraphs)',
    custom: 'custom',
});

/** @typedef {keyof typeof GREETING_LENGTH} GreetingLengthKey */

/** Default greeting length key */
const DEFAULT_GREETING_LENGTH = /** @type {GreetingLengthKey} */ ('medium');

/**
 * Predefined title/description length options.
 * Each value is a pair of instruction strings injected as {{titleLength}} and {{descriptionLength}}.
 * @readonly
 */
export const TITLE_DESC_LENGTH = /** @type {const} */ ({
    brief: { title: '2-4 words', description: '1-2 sentences' },
    short: { title: '2-5 words', description: '2-3 sentences' },
    medium: { title: '3-6 words', description: '2-4 sentences' },
    detailed: { title: '4-7 words', description: '3-6 sentences' },
    custom: { title: 'custom', description: 'custom' },
});

/** @typedef {keyof typeof TITLE_DESC_LENGTH} TitleDescLengthKey */

/** Default title/description length key */
const DEFAULT_TITLE_DESC_LENGTH = /** @type {TitleDescLengthKey} */ ('medium');

/** @readonly Default settings values */
const defaultSettings = {
    collapseByDefault: false,
    replaceNamesWithMacros: true,
    connectionProfileId: '',
    greetingLength: DEFAULT_GREETING_LENGTH,
    greetingLengthCustom: '',
    titleDescLength: DEFAULT_TITLE_DESC_LENGTH,
    titleDescLengthCustomTitle: '',
    titleDescLengthCustomDescription: '',
    generateSystemPrompt: DEFAULT_GENERATE_SYSTEM_PROMPT,
    generateGreetingSystemPrompt: DEFAULT_GENERATE_GREETING_SYSTEM_PROMPT,
    generationPromptWithTheme: DEFAULT_GENERATION_PROMPT_WITH_THEME,
    generationPromptWithoutTheme: DEFAULT_GENERATION_PROMPT_WITHOUT_THEME,
};

let uiInjected = false;

/**
 * Ensures extension settings exist with default values.
 * @returns {typeof defaultSettings}
 */
function ensureSettings() {
    extension_settings[EXTENSION_KEY] = extension_settings[EXTENSION_KEY] || {};

    const settings = extension_settings[EXTENSION_KEY];
    for (const [key, value] of Object.entries(defaultSettings)) {
        if (!(key in settings)) {
            settings[key] = value;
        }
    }

    return settings;
}

/**
 * Exported settings object with getters for easy access.
 * Usage: `greetingToolsSettings.collapseByDefault` or `greetingToolsSettings.generateSystemPrompt`
 */
export const greetingToolsSettings = {
    get collapseByDefault() {
        return Boolean(ensureSettings().collapseByDefault);
    },
    get replaceNamesWithMacros() {
        return Boolean(ensureSettings().replaceNamesWithMacros);
    },
    /** @returns {string} The selected connection profile ID, or empty string for default/main model */
    get connectionProfileId() {
        return ensureSettings().connectionProfileId || '';
    },
    get generateSystemPrompt() {
        return ensureSettings().generateSystemPrompt || DEFAULT_GENERATE_SYSTEM_PROMPT;
    },
    get generateGreetingSystemPrompt() {
        return ensureSettings().generateGreetingSystemPrompt || DEFAULT_GENERATE_GREETING_SYSTEM_PROMPT;
    },
    get generationPromptWithTheme() {
        return ensureSettings().generationPromptWithTheme || DEFAULT_GENERATION_PROMPT_WITH_THEME;
    },
    get generationPromptWithoutTheme() {
        return ensureSettings().generationPromptWithoutTheme || DEFAULT_GENERATION_PROMPT_WITHOUT_THEME;
    },
    /** @returns {GreetingLengthKey} */
    get greetingLength() {
        const val = ensureSettings().greetingLength;
        return (val in GREETING_LENGTH) ? /** @type {GreetingLengthKey} */ (val) : DEFAULT_GREETING_LENGTH;
    },
    get greetingLengthCustom() {
        return String(ensureSettings().greetingLengthCustom || '');
    },
    /**
     * Returns the resolved greeting length instruction string to use in prompts.
     * If 'custom' is selected and the custom text is non-empty, uses that; otherwise falls back to medium.
     * @returns {string}
     */
    get greetingLengthValue() {
        const key = this.greetingLength;
        if (key === 'custom') {
            return this.greetingLengthCustom || GREETING_LENGTH[DEFAULT_GREETING_LENGTH];
        }
        return GREETING_LENGTH[key];
    },
    /** @returns {TitleDescLengthKey} */
    get titleDescLength() {
        const val = ensureSettings().titleDescLength;
        return (val in TITLE_DESC_LENGTH) ? /** @type {TitleDescLengthKey} */ (val) : DEFAULT_TITLE_DESC_LENGTH;
    },
    get titleDescLengthCustomTitle() {
        return String(ensureSettings().titleDescLengthCustomTitle || '');
    },
    get titleDescLengthCustomDescription() {
        return String(ensureSettings().titleDescLengthCustomDescription || '');
    },
    /**
     * Returns the resolved title length instruction string.
     * @returns {string}
     */
    get titleLengthValue() {
        const key = this.titleDescLength;
        if (key === 'custom') {
            return this.titleDescLengthCustomTitle || TITLE_DESC_LENGTH[DEFAULT_TITLE_DESC_LENGTH].title;
        }
        return TITLE_DESC_LENGTH[key].title;
    },
    /**
     * Returns the resolved description length instruction string.
     * @returns {string}
     */
    get descriptionLengthValue() {
        const key = this.titleDescLength;
        if (key === 'custom') {
            return this.titleDescLengthCustomDescription || TITLE_DESC_LENGTH[DEFAULT_TITLE_DESC_LENGTH].description;
        }
        return TITLE_DESC_LENGTH[key].description;
    },
};

/**
 * Checks whether the Connection Manager extension is available (enabled and loaded).
 * @returns {boolean}
 */
export function isConnectionManagerAvailable() {
    try {
        const context = SillyTavern.getContext();
        return !context.extensionSettings.disabledExtensions.includes('connection-manager');
    } catch {
        return false;
    }
}

/**
 * Shows or hides the custom greeting length input based on the selected length key.
 * @param {string} lengthKey
 */
function updateGreetingLengthCustomVisibility(lengthKey) {
    const wrapper = document.getElementById('greeting_tools_greeting_length_custom_wrapper');
    if (wrapper) {
        wrapper.classList.toggle('displayNone', lengthKey !== 'custom');
    }
}

/**
 * Shows or hides the custom title/description length inputs based on the selected length key.
 * @param {string} lengthKey
 */
function updateTitleDescLengthCustomVisibility(lengthKey) {
    const wrapper = document.getElementById('greeting_tools_title_desc_length_custom_wrapper');
    if (wrapper) {
        wrapper.classList.toggle('displayNone', lengthKey !== 'custom');
    }
}

/**
 * Applies settings to UI elements.
 */
function applySettingsToUI() {
    const settings = ensureSettings();

    const collapseToggle = document.getElementById('greeting_tools_collapse_by_default');
    if (collapseToggle instanceof HTMLInputElement) {
        collapseToggle.checked = settings.collapseByDefault;
    }

    const replaceNamesToggle = document.getElementById('greeting_tools_replace_names');
    if (replaceNamesToggle instanceof HTMLInputElement) {
        replaceNamesToggle.checked = settings.replaceNamesWithMacros;
    }

    const greetingLengthSelect = document.getElementById('greeting_tools_greeting_length');
    if (greetingLengthSelect instanceof HTMLSelectElement) {
        greetingLengthSelect.value = settings.greetingLength ?? DEFAULT_GREETING_LENGTH;
    }

    const greetingLengthCustomInput = document.getElementById('greeting_tools_greeting_length_custom');
    if (greetingLengthCustomInput instanceof HTMLInputElement) {
        greetingLengthCustomInput.value = settings.greetingLengthCustom ?? '';
    }

    updateGreetingLengthCustomVisibility(settings.greetingLength ?? DEFAULT_GREETING_LENGTH);

    const titleDescLengthSelect = document.getElementById('greeting_tools_title_desc_length');
    if (titleDescLengthSelect instanceof HTMLSelectElement) {
        titleDescLengthSelect.value = settings.titleDescLength ?? DEFAULT_TITLE_DESC_LENGTH;
    }

    const titleDescCustomTitleInput = document.getElementById('greeting_tools_title_desc_length_custom_title');
    if (titleDescCustomTitleInput instanceof HTMLInputElement) {
        titleDescCustomTitleInput.value = settings.titleDescLengthCustomTitle ?? '';
    }

    const titleDescCustomDescInput = document.getElementById('greeting_tools_title_desc_length_custom_description');
    if (titleDescCustomDescInput instanceof HTMLInputElement) {
        titleDescCustomDescInput.value = settings.titleDescLengthCustomDescription ?? '';
    }

    updateTitleDescLengthCustomVisibility(settings.titleDescLength ?? DEFAULT_TITLE_DESC_LENGTH);

    const generatePromptTextarea = document.getElementById('greeting_tools_generate_prompt');
    if (generatePromptTextarea instanceof HTMLTextAreaElement) {
        generatePromptTextarea.value = settings.generateSystemPrompt;
    }

    const greetingPromptTextarea = document.getElementById('greeting_tools_greeting_prompt');
    if (greetingPromptTextarea instanceof HTMLTextAreaElement) {
        greetingPromptTextarea.value = settings.generateGreetingSystemPrompt;
    }

    const promptWithThemeTextarea = document.getElementById('greeting_tools_prompt_with_theme');
    if (promptWithThemeTextarea instanceof HTMLTextAreaElement) {
        promptWithThemeTextarea.value = settings.generationPromptWithTheme;
    }

    const promptWithoutThemeTextarea = document.getElementById('greeting_tools_prompt_without_theme');
    if (promptWithoutThemeTextarea instanceof HTMLTextAreaElement) {
        promptWithoutThemeTextarea.value = settings.generationPromptWithoutTheme;
    }
}

/**
 * Registers event listeners for settings UI.
 */
function registerSettingsEventListeners() {
    const settings = ensureSettings();

    document.getElementById('greeting_tools_collapse_by_default')?.addEventListener('change', (e) => {
        if (e.target instanceof HTMLInputElement) {
            settings.collapseByDefault = e.target.checked;
            saveSettingsDebounced();
        }
    });

    document.getElementById('greeting_tools_replace_names')?.addEventListener('change', (e) => {
        if (e.target instanceof HTMLInputElement) {
            settings.replaceNamesWithMacros = e.target.checked;
            saveSettingsDebounced();
        }
    });

    document.getElementById('greeting_tools_greeting_length')?.addEventListener('change', (e) => {
        if (e.target instanceof HTMLSelectElement) {
            settings.greetingLength = /** @type {GreetingLengthKey} */ (e.target.value);
            saveSettingsDebounced();
            updateGreetingLengthCustomVisibility(settings.greetingLength);
        }
    });

    document.getElementById('greeting_tools_greeting_length_custom')?.addEventListener('input', (e) => {
        if (e.target instanceof HTMLInputElement) {
            settings.greetingLengthCustom = e.target.value;
            saveSettingsDebounced();
        }
    });

    document.getElementById('greeting_tools_title_desc_length')?.addEventListener('change', (e) => {
        if (e.target instanceof HTMLSelectElement) {
            settings.titleDescLength = /** @type {TitleDescLengthKey} */ (e.target.value);
            saveSettingsDebounced();
            updateTitleDescLengthCustomVisibility(settings.titleDescLength);
        }
    });

    document.getElementById('greeting_tools_title_desc_length_custom_title')?.addEventListener('input', (e) => {
        if (e.target instanceof HTMLInputElement) {
            settings.titleDescLengthCustomTitle = e.target.value;
            saveSettingsDebounced();
        }
    });

    document.getElementById('greeting_tools_title_desc_length_custom_description')?.addEventListener('input', (e) => {
        if (e.target instanceof HTMLInputElement) {
            settings.titleDescLengthCustomDescription = e.target.value;
            saveSettingsDebounced();
        }
    });

    document.getElementById('greeting_tools_generate_prompt')?.addEventListener('input', (e) => {
        if (e.target instanceof HTMLTextAreaElement) {
            settings.generateSystemPrompt = e.target.value;
            saveSettingsDebounced();
        }
    });

    document.getElementById('greeting_tools_reset_generate_prompt')?.addEventListener('click', () => {
        settings.generateSystemPrompt = DEFAULT_GENERATE_SYSTEM_PROMPT;
        saveSettingsDebounced();
        const textarea = document.getElementById('greeting_tools_generate_prompt');
        if (textarea instanceof HTMLTextAreaElement) {
            textarea.value = DEFAULT_GENERATE_SYSTEM_PROMPT;
        }
        toastr.success(t`Prompt restored to default`);
    });

    document.getElementById('greeting_tools_greeting_prompt')?.addEventListener('input', (e) => {
        if (e.target instanceof HTMLTextAreaElement) {
            settings.generateGreetingSystemPrompt = e.target.value;
            saveSettingsDebounced();
        }
    });

    document.getElementById('greeting_tools_reset_greeting_prompt')?.addEventListener('click', () => {
        settings.generateGreetingSystemPrompt = DEFAULT_GENERATE_GREETING_SYSTEM_PROMPT;
        saveSettingsDebounced();
        const textarea = document.getElementById('greeting_tools_greeting_prompt');
        if (textarea instanceof HTMLTextAreaElement) {
            textarea.value = DEFAULT_GENERATE_GREETING_SYSTEM_PROMPT;
        }
        toastr.success(t`Prompt restored to default`);
    });

    document.getElementById('greeting_tools_prompt_with_theme')?.addEventListener('input', (e) => {
        if (e.target instanceof HTMLTextAreaElement) {
            settings.generationPromptWithTheme = e.target.value;
            saveSettingsDebounced();
        }
    });

    document.getElementById('greeting_tools_reset_prompt_with_theme')?.addEventListener('click', () => {
        settings.generationPromptWithTheme = DEFAULT_GENERATION_PROMPT_WITH_THEME;
        saveSettingsDebounced();
        const textarea = document.getElementById('greeting_tools_prompt_with_theme');
        if (textarea instanceof HTMLTextAreaElement) {
            textarea.value = DEFAULT_GENERATION_PROMPT_WITH_THEME;
        }
        toastr.success(t`Prompt restored to default`);
    });

    document.getElementById('greeting_tools_prompt_without_theme')?.addEventListener('input', (e) => {
        if (e.target instanceof HTMLTextAreaElement) {
            settings.generationPromptWithoutTheme = e.target.value;
            saveSettingsDebounced();
        }
    });

    document.getElementById('greeting_tools_reset_prompt_without_theme')?.addEventListener('click', () => {
        settings.generationPromptWithoutTheme = DEFAULT_GENERATION_PROMPT_WITHOUT_THEME;
        saveSettingsDebounced();
        const textarea = document.getElementById('greeting_tools_prompt_without_theme');
        if (textarea instanceof HTMLTextAreaElement) {
            textarea.value = DEFAULT_GENERATION_PROMPT_WITHOUT_THEME;
        }
        toastr.success(t`Prompt restored to default`);
    });
}

/**
 * Initializes extension settings with defaults.
 */
export function initSettings() {
    ensureSettings();
}

/**
 * Injects the extension settings UI into the settings panel.
 */
export async function injectSettingsUI() {
    if (uiInjected || document.getElementById('extension_settings_greeting_tools')) {
        return;
    }

    // Check which settings column has fewer children
    const col2 = document.getElementById('extensions_settings2');
    const col1 = document.getElementById('extensions_settings');
    const parent = col2 && col1 ? (col2.children.length > col1.children.length ? col1 : col2) : (col2 || col1);

    if (!parent) {
        console.error('[GreetingTools] Could not find settings container');
        return;
    }

    const html = await renderExtensionTemplateAsync(`third-party/${EXTENSION_NAME}`, 'templates/settings');
    const template = document.createElement('template');
    template.innerHTML = html;
    parent.appendChild(template.content);

    applySettingsToUI();
    registerSettingsEventListeners();
    initConnectionProfileDropdown();

    uiInjected = true;
}

/**
 * Initializes the connection profile dropdown if Connection Manager is available.
 * Uses ConnectionManagerRequestService.handleDropdown for population and event handling.
 */
function initConnectionProfileDropdown() {
    const wrapper = document.getElementById('greeting_tools_connection_profile_wrapper');
    if (!wrapper) return;

    if (!isConnectionManagerAvailable()) {
        wrapper.style.display = 'none';
        return;
    }

    wrapper.style.display = '';

    const settings = ensureSettings();
    const selector = '#greeting_tools_connection_profile';

    try {
        // Register our delete listener BEFORE handleDropdown sets up its own.
        // This ensures our listener runs first, while settings.connectionProfileId still holds the old value.
        // handleDropdown's internal listener fires onChange (which clears the setting) before its onDelete callback.
        const { eventSource, eventTypes } = SillyTavern.getContext();
        eventSource.on(eventTypes.CONNECTION_PROFILE_DELETED, (profile) => {
            if (settings.connectionProfileId === profile.id) {
                toastr.warning(
                    t`The connection profile "${profile.name}" used for Greeting Tools generation was deleted. Falling back to the main model.`,
                    t`Greeting Tools`,
                    { timeOut: 5000 },
                );
            }
        });

        ConnectionManagerRequestService.handleDropdown(
            selector,
            settings.connectionProfileId,
            // onChange: fires on user selection, profile delete (resets to ''), and profile update
            (profile) => {
                settings.connectionProfileId = profile?.id || '';
                saveSettingsDebounced();
            },
        );

        // Replace the default "Select a Connection Profile" option text with our custom default
        const dropdown = document.querySelector(selector);
        const defaultOption = dropdown?.querySelector('option[value=""]');
        if (defaultOption) {
            defaultOption.textContent = t`Default (Main Model)`;
            defaultOption.dataset.i18n = 'Default (Main Model)';
        }
    } catch (error) {
        console.warn('[GreetingTools] Could not initialize connection profile dropdown:', error);
        wrapper.style.display = 'none';
    }
}
