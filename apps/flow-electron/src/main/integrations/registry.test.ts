import assert from 'node:assert/strict'
import test from 'node:test'

import { agentCodeIntegration } from '@main/integrations/agentCode.js'
import {
  enabledDictationIntegrationsForSettings,
  hotkeyYieldTargetsForIntegrations,
} from '@main/integrations/selection.js'

test('Agent Code integration covers development and packaged bundle ids', () => {
  assert.deepEqual(agentCodeIntegration.hotkeyYield.frontmostBundleIds, [
    'com.electron.agent-code',
    'com.agentcode.app',
  ])
})

test('enabled integrations honor defaults and explicit settings overrides', () => {
  assert.deepEqual(
    enabledDictationIntegrationsForSettings([agentCodeIntegration], {
      integrationHotkeyYield: {},
    }).map(
      integration => integration.id,
    ),
    ['agent-code'],
  )

  assert.deepEqual(
    enabledDictationIntegrationsForSettings(
      [agentCodeIntegration],
      {
        integrationHotkeyYield: { 'agent-code': false },
      },
    ).map(integration => integration.id),
    [],
  )
})

test('hotkey yield targets flatten enabled integration routing data', () => {
  const targets = hotkeyYieldTargetsForIntegrations([agentCodeIntegration])

  assert.deepEqual(targets.frontmostBundleIds, [
    'com.electron.agent-code',
    'com.agentcode.app',
  ])
  assert.deepEqual(targets.frontmostAppNames, ['Agent Code'])
})
