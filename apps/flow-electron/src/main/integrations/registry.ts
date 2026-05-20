import { agentCodeIntegration } from '@main/integrations/agentCode.js'
import { loadSettings } from '@main/services/settingsStore.js'
import type { DictationIntegration } from '@main/integrations/types.js'

const integrations: DictationIntegration[] = [
  agentCodeIntegration,
]

export type DictationIntegrationSummary = {
  id: string
  label: string
  enabledByDefault: boolean
}

export function listDictationIntegrations(): DictationIntegration[] {
  return integrations
}

export function listDictationIntegrationSummaries(): DictationIntegrationSummary[] {
  return integrations.map(integration => ({
    id: integration.id,
    label: integration.label,
    enabledByDefault: integration.enabledByDefault,
  }))
}

export async function enabledDictationIntegrations(): Promise<DictationIntegration[]> {
  const settings = await loadSettings()
  return integrations.filter(integration => {
    const override = settings.integrationHotkeyYield[integration.id]
    return override ?? integration.enabledByDefault
  })
}
