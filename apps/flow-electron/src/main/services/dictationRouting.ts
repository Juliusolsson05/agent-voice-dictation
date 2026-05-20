import { enabledDictationIntegrations } from '@main/integrations/registry.js'
import {
  hotkeyYieldTargetsForIntegrations,
  type HotkeyYieldTargets,
} from '@main/integrations/selection.js'

export async function getHotkeyYieldTargets(): Promise<HotkeyYieldTargets> {
  // WHY this module flattens integrations into plain strings:
  // `services/hotkey.ts` should know only that "some enabled integration
  // wants pass-through for these frontmost apps." If hotkey.ts imports
  // Agent Code directly, Flow's generic product surface slowly becomes a
  // pile of one-off host-app checks. The registry owns integration identity;
  // the hotkey layer receives a dumb routing table.
  const integrations = await enabledDictationIntegrations()
  return hotkeyYieldTargetsForIntegrations(integrations)
}
