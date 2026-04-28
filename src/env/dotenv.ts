// Tiny dotenv parser.
//
// We deliberately do not depend on the `dotenv` npm package. The package's
// other runtime deps stay narrow (just `ws` for Deepgram streaming), and
// this parser is small enough that an extra dependency would cost more in
// supply-chain surface than it saves in code. The set of features we
// actually use is also narrow: KEY=value, optional surrounding quotes,
// `#` line comments, blank lines.
//
// If you find yourself reaching for variable expansion, multi-line values,
// or export semantics — that's the signal to bring in dotenv proper.

export function parseDotEnv(raw: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx === -1) continue
    const key = trimmed.slice(0, idx).trim()
    if (!key) continue
    const value = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '')
    result[key] = value
  }
  return result
}
