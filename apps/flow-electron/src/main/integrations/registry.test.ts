import assert from 'node:assert/strict'
import { test } from 'vitest'

// Relative imports, not the `@main/*` alias the rest of this directory uses.
// The alias is declared in apps/flow-electron/tsconfig.json and resolved by
// electron-vite at build time -- the root vitest config knows nothing about it,
// so an aliased runtime import here fails to resolve and the whole file loads as
// zero tests. Sibling files get away with `@main/...` because those imports are
// `import type` and erase before runtime; these two are real value imports.
// Mirrors the convention in apps/flow-electron/src/shared/hotkeyBinding.test.ts.
import { agentCodeIntegration } from './agentCode.js'
import {
  enabledDictationIntegrationsForSettings,
  hotkeyYieldTargetsForIntegrations,
} from './selection.js'

test('Agent Code integration targets the packaged bundle id', () => {
  // Packaged-only is deliberate -- see the WHY in agentCode.ts. If a dev id ever
  // shows up here, check it is not `com.github.Electron`, which every unpackaged
  // Electron app shares including Flow itself.
  assert.deepEqual(agentCodeIntegration.hotkeyYield.frontmostBundleIds, ['com.agentcode.app'])
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

  assert.deepEqual(targets.frontmostBundleIds, ['com.agentcode.app'])
  assert.deepEqual(targets.frontmostAppNames, ['Agent Code'])
})
