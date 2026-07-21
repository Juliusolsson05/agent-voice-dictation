export type FrontmostApp = {
  name: string
  bundleId: string | null
}

export type DictationIntegration = {
  id: string
  label: string
  enabledByDefault: boolean
  /**
   * Frontmost-app conditions where Flow should not consume the global
   * dictation hotkey.
   *
   * WHY this data shape exists instead of an arbitrary callback:
   * the macOS event tap must decide pass-through BEFORE Electron receives a
   * hotkey event. If the helper returns `nil`, the event is swallowed and
   * Agent Code never sees its own Fn press. Keeping integrations as declarative
   * target lists lets main serialize the policy into the native helper while
   * keeping product-specific app names out of the helper itself.
   */
  hotkeyYield: {
    frontmostBundleIds: string[]
    frontmostAppNames: string[]
  }
}
