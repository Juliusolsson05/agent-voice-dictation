import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { ensureHelperBinary } from './macHotkeyHelper'
import { getHotkeyYieldTargets } from './dictationRouting'
const exec = promisify(execFile)

export async function allowsAutomaticPaste(): Promise<boolean> {
  if (process.platform !== 'darwin') return false
  const targets = await getHotkeyYieldTargets()
  if (!targets.frontmostBundleIds.length && !targets.frontmostAppNames.length) return true
  try {
    const binary = await ensureHelperBinary()
    const { stdout } = await exec(binary, ['--query-yield', JSON.stringify(targets)], { timeout: 1000, maxBuffer: 1024 })
    // Only an explicit native "false" permits insertion. Missing output,
    // helper failure or unknown focus leaves the completed text on clipboard.
    return stdout.trim() === 'false'
  } catch { return false }
}
