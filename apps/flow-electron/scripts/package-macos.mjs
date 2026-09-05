import { cp, mkdir, readFile, writeFile, access } from 'node:fs/promises'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'

// Local installer input stays explicit: do not copy an entire checkout or its
// user-data directory into a redistributable bundle. Signing identity is a CLI
// argument so no developer-specific certificate information enters the repo.
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const root = resolve(appRoot, '../..')
const [runtime, destination, identity = '-'] = process.argv.slice(2)
if (!runtime || !destination) throw new Error('Usage: node scripts/package-macos.mjs <Electron.app> <new-output.app> [signing-identity]')
const target = resolve(destination)
try { await access(target); throw new Error(`Output already exists: ${target}`) } catch (err) { if (err.code !== 'ENOENT') throw err }
await cp(resolve(runtime), target, { recursive: true, verbatimSymlinks: true })
const resources = join(target, 'Contents/Resources')
const packaged = join(resources, 'app')
await mkdir(packaged)
const sourceManifest = JSON.parse(await readFile(join(appRoot, 'package.json'), 'utf8'))
await writeFile(join(packaged, 'package.json'), JSON.stringify(Object.fromEntries(['name', 'version', 'description', 'main', 'type'].map(key => [key, sourceManifest[key]])), null, 2))
await cp(join(appRoot, 'out'), join(packaged, 'out'), { recursive: true })
await mkdir(join(packaged, 'native'))
const helper = join(packaged, 'native/AgentVoiceHotkeyHelper')
const source = join(appRoot, 'native/macos-hotkey-helper/Sources/AgentVoiceHotkeyHelper')
execFileSync('/usr/bin/xcrun', ['swiftc', ...['main.swift', 'BindingState.swift', 'FocusPolicy.swift'].map(name => join(source, name)), '-O', '-o', helper], { env: { ...process.env, CLANG_MODULE_CACHE_PATH: join(tmpdir(), 'agent-voice-swift-cache') }, stdio: 'inherit', timeout: 120000 })
const dependency = join(packaged, 'node_modules/agent-voice-dictation')
await mkdir(dependency, { recursive: true })
await cp(join(root, 'package.json'), join(dependency, 'package.json'))
try { await cp(join(root, 'LICENSE'), join(dependency, 'LICENSE')) } catch (err) { if (err.code !== 'ENOENT') throw err }
await cp(join(root, 'dist'), join(dependency, 'dist'), { recursive: true })
await cp(join(root, 'node_modules/ws'), join(packaged, 'node_modules/ws'), { recursive: true })
// Python's standard plist library preserves binary/XML plist semantics without
// treating quoted product strings as shell code. No shell interpolation occurs.
execFileSync('python3', ['-c', `
import pathlib, plistlib, sys
bundle=pathlib.Path(sys.argv[1])
plist=bundle/'Contents/Info.plist'
data=plistlib.loads(plist.read_bytes())
data.update(CFBundleIdentifier='team.hackathons.agent-voice.local', CFBundleName='Agent Voice', CFBundleDisplayName='Agent Voice', CFBundleShortVersionString='0.1.0', CFBundleVersion='5', NSMicrophoneUsageDescription='Agent Voice uses your chosen microphone for dictation and input testing.', NSLocalNetworkUsageDescription='Agent Voice connects to your phone microphone over local Wi-Fi.', NSAppleEventsUsageDescription='Agent Voice can paste completed dictation into the focused application.')
data.pop('ElectronAsarIntegrity',None)
plist.write_bytes(plistlib.dumps(data))
for plist in (bundle/'Contents/Frameworks').glob('Electron Helper*.app/Contents/Info.plist'):
 data=plistlib.loads(plist.read_bytes())
 data['CFBundleIdentifier']='team.hackathons.agent-voice.local'+data['CFBundleIdentifier'].removeprefix('com.github.Electron')
 plist.write_bytes(plistlib.dumps(data))
(bundle/'Contents/Resources/default_app.asar').unlink()
`, target], { stdio: 'inherit' })
// Sign the standalone helper explicitly: --deep does not promise to discover
// arbitrary executables under Resources. The parent seal then covers its bytes.
execFileSync('/usr/bin/codesign', ['--force', '--sign', identity, helper], { stdio: 'inherit', timeout: 120000 })
execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', identity, target], { stdio: 'inherit', timeout: 120000 })
execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', target], { stdio: 'inherit' })
console.log(`Packaged and verified ${target}`)
