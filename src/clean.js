/**
 * Clean/uninstall routine for Greeting Tools extension.
 * Removes all extension data using the bulk merge-attributes API
 * so that even shallow/lazy-loaded characters are cleaned on the server side.
 */

import { saveSettings } from '../../../../../script.js';
import { extension_settings, writeExtensionFieldBulk, UNSET_VALUE } from '../../../../extensions.js';
import { t } from '../../../../i18n.js';
import { EXTENSION_KEY, EXTENSION_NAME } from '../index.js';

/**
 * Removes all data added by this extension:
 *  - Extension settings block (global preferences & prompts)
 *  - Per-character greeting metadata (titles, descriptions, index maps)
 *
 * Character data is cleaned via a single bulk API call. The server filters
 * characters that actually have the extension field set, so shallow/lazy-loaded
 * characters are handled transparently — no time budget needed.
 *
 * Chat-level temp greeting metadata (stored in individual chat files) cannot be
 * cleaned automatically without loading and re-saving every chat file.
 */
export async function cleanAllGreetingToolsData() {
    // 1. Remove extension settings (fast, always completes)
    delete extension_settings[EXTENSION_KEY];
    await saveSettings();

    // 2. Bulk-delete per-character extension data (server-side filtering + parallel)
    await cleanCharacterData();

    // 3. Chat metadata cannot be cleaned without loading every chat file
    toastr.warning(
        t`Chat-based temp greeting metadata will not be removed automatically.`,
        t`Greeting Tools Cleanup`,
    );
}

/**
 * Removes greeting tools extension data from all characters using a single
 * bulk API call. The server reads each character card, checks the filter, and
 * only updates those that actually have the extension field set.
 */
async function cleanCharacterData() {
    // Pass null avatars → server scans all characters in the directory
    // Pass UNSET_VALUE  → server deletes the extension key entirely
    // Default filter auto-applies: only characters with data.extensions.[key] set
    const result = await writeExtensionFieldBulk(null, EXTENSION_KEY, UNSET_VALUE);

    if (result.updated.length > 0) {
        toastr.info(t`Cleaned greeting metadata from ${result.updated.length} character(s).`);
        console.info(`[${EXTENSION_NAME}] Cleaned greeting metadata from ${result.updated.length} character(s).`, result);
    }

    if (result.failed.length > 0) {
        toastr.warning(
            t`Cleaned ${result.updated.length} character(s), but ${result.failed.length} failed. Their greeting metadata will remain in the character card data.`,
            t`Greeting Tools Cleanup`,
            { timeOut: 10000 },
        );
    }
}
