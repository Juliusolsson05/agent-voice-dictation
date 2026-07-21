import type { DictationIntegration } from '@main/integrations/types.js'

export const agentCodeIntegration: DictationIntegration = {
  id: 'agent-code',
  label: 'Agent Code',
  enabledByDefault: true,
  hotkeyYield: {
    // Bundle ids are the routing contract, not display names: the native event
    // tap sees the frontmost app before Electron receives the hotkey, and ids
    // survive localization and a user-renamed .app bundle. This value is the
    // `appId` in Agent Code's electron-builder.yml -- that file is the source of
    // truth, so a rename there must be mirrored here.
    //
    // Packaged builds only, deliberately. An unpackaged Electron app does NOT
    // report its own id -- it reports `com.github.Electron` (name `Electron`),
    // which every Electron app in dev shares, INCLUDING Flow itself. Listing
    // that id would make Flow yield its dictation hotkey whenever any dev-mode
    // Electron window was frontmost, up to and including Flow's own. An earlier
    // revision listed a `com.electron.agent-code` dev id; nothing ever reports
    // that string, so it was silently dead weight. Yield in dev therefore does
    // not work, and that is the correct trade rather than a gap to close.
    frontmostBundleIds: ['com.agentcode.app'],
    frontmostAppNames: ['Agent Code'],
  },
}
