import { setupButtonIntercept } from './greeting-tools.js';
import { initGreetingSelector } from './greeting-selector.js';

export const EXTENSION_KEY = 'greeting_tools';
export const EXTENSION_NAME = 'SillyTavern-GreetingTools';

/**
 * Extension initialization
 */
export async function init() {
    console.debug(`[${EXTENSION_NAME}] Extension loaded`);
    setupButtonIntercept();
    initGreetingSelector();
}
