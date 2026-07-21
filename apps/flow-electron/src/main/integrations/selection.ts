import type { DictationIntegration } from '@main/integrations/types.js'

export type HotkeyYieldTargets = {
  frontmostBundleIds: string[]
  frontmostAppNames: string[]
}

export type IntegrationHotkeyYieldSettings = {
  integrationHotkeyYield: Record<string, boolean>
}

export function enabledDictationIntegrationsForSettings(
  integrations: DictationIntegration[],
  settings: IntegrationHotkeyYieldSettings,
): DictationIntegration[] {
  // WHY this is pure and separate from settingsStore:
  // integration enablement is routing policy, not persistence. Keeping
  // the decision in a dependency-light helper gives the native-hotkey
  // boundary a cheap regression test without booting Electron's app module
  // or touching userData. The registry wires real settings into this helper;
  // tests pass a tiny object with the one field that matters.
  return integrations.filter(integration => {
    const override = settings.integrationHotkeyYield[integration.id]
    return override ?? integration.enabledByDefault
  })
}

export function hotkeyYieldTargetsForIntegrations(
  integrations: DictationIntegration[],
): HotkeyYieldTargets {
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
