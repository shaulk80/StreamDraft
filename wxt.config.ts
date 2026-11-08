import { defineConfig } from 'wxt';

// The version comes from package.json. The Firefox add-on ID must never change
// once a version has been signed: a different ID is a different add-on.
export default defineConfig({
  // WXT builds Firefox as Manifest V2 unless told otherwise.
  manifestVersion: 3,
  zip: {
    // Keep generated and local folders out of the sources zip that Mozilla may review.
    excludeSources: ['coverage/**', 'dist/**', '.claude/**'],
  },
  manifest: ({ browser }) => ({
    name: 'StreamDraft',
    description: 'Download videos from the page you are on.',
    permissions: [
      'storage',
      'contextMenus',
      'webRequest',
      'downloads',
      // Chrome runs the stream engine in an offscreen document; Firefox does not know the permission.
      ...(browser === 'firefox' ? [] : ['offscreen']),
    ],
    // Detection watches the responses of every site; see docs/decisions/0002-detection-permissions.md.
    host_permissions: ['<all_urls>'],
    browser_specific_settings: {
      gecko: {
        id: 'streamdraft@shaulk80.github.io',
        strict_min_version: '140.0',
        data_collection_permissions: { required: ['none'] },
      },
      // Android is a non-goal, but the manifest key above needs Android 142.
      gecko_android: { strict_min_version: '142.0' },
    },
  }),
});
