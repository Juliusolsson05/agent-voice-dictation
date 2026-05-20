import { enabledDictationIntegrations } from '@main/integrations/registry.js'

export type HotkeyYieldTargets = {
  frontmostBundleIds: string[]
  frontmostAppNames: string[]
}

export async function getHotkeyYieldTargets(): Promise<HotkeyYieldTargets> {
  // WHY this module flattens integrations into plain strings:
  // `services/hotkey.ts` should know only that "some enabled integration
  // wants pass-through for these frontmost apps." If hotkey.ts imports
  // Agent Code directly, Flow's generic product surface slowly becomes a
  // pile of one-off host-app checks. The registry owns integration identity;
  // the hotkey layer receives a dumb routing table.
  const integrations = await enabledDictationIntegrations()
  return {
    frontmostBundleIds: unique(
      integrations.flatMap(integration => integration.hotkeyYield.frontmostBundleIds),
    ),
    frontmostAppNames: unique(
      integrations.flatMap(integration => integration.hotkeyYield.frontmostAppNames),
    ),
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))]
}
