import type { DictationIntegration } from '@main/integrations/types.js'

export const agentCodeIntegration: DictationIntegration = {
  id: 'agent-code',
  label: 'Agent Code',
  enabledByDefault: true,
  hotkeyYield: {
    // Electron dev/preview and packaged Agent Code report different bundle
    // ids. Keep both here instead of leaning on the app-name fallback: bundle
    // ids are the stable routing contract the native event tap sees before
    // Electron receives the hotkey, while display names can drift with
    // packaging, localization, or a user-renamed .app bundle.
    frontmostBundleIds: ['com.electron.agent-code', 'com.agentcode.app'],
    frontmostAppNames: ['Agent Code'],
  },
}
