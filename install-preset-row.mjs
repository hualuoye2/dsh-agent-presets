// Install ONE desktop preset row into the live desktop profile patch. Reversible.
//
// Generic form of install-128k-row.mjs: the row id is an argument, the identity checks are
// derived from the row itself. A bad patch layer does not fail gracefully — it throws at
// boot — so the gates are the point of this script:
//   1. parse with the PRODUCTION parser (plain js-yaml dies on the `!!js` tag)
//   2. back up the live file first (timestamped, never overwritten)
//   3. the RESULT must parse, keep every original entry id, and add exactly one insert row
//   4. refuse if the row id is already present (duplicate loader id = boot failure)
//   5. print the one-line restore
//
// Usage: node install-preset-row.mjs <live cordis.patch.yml> <row.yml> <expected-row-id>

import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const [live, rowFile, expectedId] = process.argv.slice(2)
if (!live || !rowFile || !expectedId) throw new Error('usage: node install-preset-row.mjs <live> <row.yml> <expected-row-id>')

const DSH_TREE = 'C:/Users/常绚/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai'

let parse = null
let parserName = ''
try {
  const mod = await import(pathToFileURL(`${DSH_TREE}/dsh-app-boot/lib/index.js`).href)
  if (typeof mod.loadOverlayPatches === 'function') {
    parse = (file) => mod.loadOverlayPatches('probe', file)
    parserName = 'loader loadOverlayPatches (production)'
  }
} catch (e) {
  console.log(`  (生产解析器不可用: ${e.message.slice(0, 70)})`)
}
if (!parse) {
  const require = createRequire(import.meta.url)
  const yaml = require('C:/Users/常绚/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/node_modules/js-yaml')
  const JsType = new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: (d) => d })
  parse = (file) => yaml.load(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''), { schema: yaml.DEFAULT_SCHEMA.extend([JsType]) })
  parserName = 'js-yaml + !!js type (fallback)'
}
console.log(`  解析器 = ${parserName}`)

const row = readFileSync(rowFile, 'utf8').replace(/^\uFEFF/, '')
const parsedRow = parse(rowFile)
if (!Array.isArray(parsedRow) || parsedRow.length !== 1) throw new Error(`row file must be a 1-entry array`)
const inserted = parsedRow[0].insert
if (!Array.isArray(inserted) || inserted.length !== 1) throw new Error('row file must contain exactly one `- insert:` entry')
const spec = inserted[0]
if (spec.id !== expectedId) throw new Error(`row id is ${spec.id}, expected ${expectedId}`)
if (spec.name !== '@deepseek-ai/dsh-agent-preset') throw new Error(`unexpected plugin name: ${spec.name}`)
const plugins = spec.config?.plugins
if (!Array.isArray(plugins) || !plugins.length) throw new Error('row declares no plugins')
const budget = plugins.find((p) => p.id === 'agent-instructions')?.config?.maxBytes
const delegIds = plugins.map((p) => p.id).filter((id) => /subagent|workflow|ralph/.test(String(id)))
console.log(`  row ok: id=${spec.id} config.id=${spec.config.id} order=${spec.config.order} plugins=${plugins.length} maxBytes=${budget}`)
console.log(`  委派类插件（应为 0）= ${delegIds.length ? delegIds.join(', ') : '0'}`)

const before = readFileSync(live, 'utf8')
if (before.includes(`- id: ${expectedId}`)) throw new Error(`${expectedId} already present — refusing to install twice`)
const parsedBefore = parse(live)
if (!Array.isArray(parsedBefore)) throw new Error('live patch is not a top-level YAML array')
const idsBefore = parsedBefore.filter((e) => e && e.id).map((e) => e.id)
console.log(`  live: ${parsedBefore.length} entries, ids = ${idsBefore.join(', ')}`)

const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
const backup = `${live}.bak-${stamp}-${expectedId}`
if (existsSync(backup)) throw new Error(`backup path exists: ${backup}`)
copyFileSync(live, backup)
console.log(`  备份 -> ${backup}`)

writeFileSync(live, before + (before.endsWith('\n') ? '\n' : '\n\n') + row.trimEnd() + '\n', { encoding: 'utf8' })

const parsedAfter = parse(live)
if (!Array.isArray(parsedAfter)) throw new Error('RESULT does not parse — restore from backup!')
const idsAfter = parsedAfter.filter((e) => e && e.id).map((e) => e.id)
const lost = idsBefore.filter((id) => !idsAfter.includes(id))
if (lost.length) throw new Error(`original entries disappeared: ${lost.join(', ')} — restore from backup!`)
const allInserts = parsedAfter.flatMap((e) => e.insert ?? [])
const mine = allInserts.filter((r) => r.id === expectedId)
if (mine.length !== 1) throw new Error(`expected exactly 1 ${expectedId}, found ${mine.length} — restore from backup!`)
const dupes = allInserts.map((r) => r.id).filter((id, i, a) => a.indexOf(id) !== i)
if (dupes.length) throw new Error(`duplicate insert ids: ${dupes.join(', ')} — restore from backup!`)

console.log('')
console.log(`  ✅ 已安装 ${expectedId} 到 ${live}`)
console.log(`     条目 ${parsedBefore.length} -> ${parsedAfter.length}   insert 行 = ${allInserts.map((r) => r.id).join(', ')}`)
console.log(`     还原: Copy-Item "${backup}" "${live}" -Force`)
