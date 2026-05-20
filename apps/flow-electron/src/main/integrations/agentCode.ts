import type { DictationIntegration } from '@main/integrations/types.js'

export const agentCodeIntegration: DictationIntegration = {
  id: 'agent-code',
  label: 'Agent Code',
  enabledByDefault: true,
  hotkeyYield: {
    // Electron development builds report the bundle id below. Packaged builds
    // may eventually use a product-specific id; the app-name fallback keeps
    // the integration working while packaging metadata settles. This is the
    // only Agent Code-specific file in the Flow app on purpose: normal Flow
    // users should not pay for Agent Code concepts leaking through the core
    // hotkey or dictation controller modules.
    frontmostBundleIds: ['com.electron.agent-code'],
    frontmostAppNames: ['Agent Code'],
  },
}
