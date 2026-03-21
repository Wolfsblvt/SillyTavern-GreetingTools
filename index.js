import { setupButtonIntercept } from './greeting-tools.js';
import { initGreetingSelector } from './greeting-selector.js';

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

    console.debug(`[${EXTENSION_NAME}] Extension loaded`);
    setupButtonIntercept();
    initGreetingSelector();

    initialized = true;
}
