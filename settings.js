/**
 * Settings management for Greeting Tools extension.
 * Handles loading, saving, and accessing extension settings.
 */

import { saveSettingsDebounced } from '../../../../script.js';
import { extension_settings, renderExtensionTemplateAsync } from '../../../extensions.js';
import { t } from '../../../i18n.js';
import { EXTENSION_KEY, EXTENSION_NAME } from './index.js';
import { DEFAULT_GENERATE_SYSTEM_PROMPT, DEFAULT_GENERATE_GREETING_SYSTEM_PROMPT, DEFAULT_GENERATION_PROMPT_WITH_THEME, DEFAULT_GENERATION_PROMPT_WITHOUT_THEME } from './prompts.js';

/** @readonly Default settings values */
const defaultSettings = {
    collapseByDefault: false,
    replaceNamesWithMacros: true,
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
};

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

    uiInjected = true;
}
