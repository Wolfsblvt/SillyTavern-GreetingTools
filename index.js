import { setupButtonIntercept } from './greeting-tools-popup.js';
import { initGreetingSelector } from './greeting-selector.js';
import { initSettings, injectSettingsUI } from './settings.js';
import { Popup } from '/scripts/popup.js';
import { t } from '/scripts/i18n.js';
import { disableExtension } from '/scripts/extensions.js';

export const EXTENSION_KEY = 'greeting_tools';
export const EXTENSION_NAME = 'SillyTavern-GreetingTools';

let initializeCalled = false;
export let initialized = false;

/**
 * Extension initialization
 */
export async function init() {
    if (initializeCalled) return;
    initializeCalled = true;

    console.debug(`[${EXTENSION_NAME}] Initializing...`);

    const { eventSource, eventTypes } = SillyTavern.getContext();

    // Initialize settings
    initSettings();
    await injectSettingsUI();

    setupButtonIntercept();
    initGreetingSelector();

    eventSource.on(eventTypes.APP_INITIALIZED, checkMacroEngine);

    console.debug(`[${EXTENSION_NAME}] Extension activated`);

    initialized = true;
}

// TODO: This function is needed as long as the experimental macro engine can be off
async function checkMacroEngine() {
    const { powerUserSettings, POPUP_RESULT } = SillyTavern.getContext();

    if (powerUserSettings.experimental_macro_engine) {
        return;
    }

    const result = await Popup.show.confirm(
        t`Greeting Tools - Enable Macro Engine`,
        t`This extension requires the experimental macro engine to be enabled. Would you like to enable it now?`,
        {
            okButton: t`Enable`,
            cancelButton: t`Disable Extension (and reload)`,
        });

    if (result == POPUP_RESULT.AFFIRMATIVE) {
        powerUserSettings.experimental_macro_engine = true;
        $('#experimental_macro_engine').prop('checked', powerUserSettings.experimental_macro_engine).trigger('input');
        location.reload();
    }

    await disableExtension(`third-party/${EXTENSION_NAME}`);
}
