/**
 * macOS notarization, run by electron-builder after signing.
 *
 * Skips cleanly when credentials are absent so a local `npm run dist` still
 * produces a working unsigned build; only CI supplies the Apple credentials.
 */
const { notarize } = require('@electron/notarize');

exports.default = async function notarizing(context) {
    const { electronPlatformName, appOutDir } = context;
    if (electronPlatformName !== 'darwin') return;

    const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = process.env;
    if (!APPLE_ID || !APPLE_APP_SPECIFIC_PASSWORD || !APPLE_TEAM_ID) {
        console.log('  • notarization skipped: Apple credentials not present in the environment');
        return;
    }

    const appName = context.packager.appInfo.productFilename;
    console.log(`  • notarizing ${appName}.app`);
    await notarize({
        tool: 'notarytool',
        appPath: `${appOutDir}/${appName}.app`,
        appleId: APPLE_ID,
        appleIdPassword: APPLE_APP_SPECIFIC_PASSWORD,
        teamId: APPLE_TEAM_ID,
    });
};
