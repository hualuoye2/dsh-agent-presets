// Install the `preset-standard-128k` row into the live desktop profile patch. Reversible.
//
// Safety shape, because a bad patch layer does not fail gracefully — it throws at boot:
//   1. validate with the PRODUCTION parser, not a generic one
//   2. back up the live file first (timestamped, never overwritten)
//   3. validate the RESULT parses and every original entry id survived
//   4. refuse if the row id is already present (double-install = duplicate loader id)
//   5. print the one-line restore
//
// Lesson baked in: plain `js-yaml` CANNOT parse these files. The dialect carries a custom
// `!!js` tag (`disabled: !!js process.platform === 'win32'`), so a generic parse dies with
// `unknown tag !<tag:yaml.org,2002:js>` — and the first version of this script did exactly
// that. It aborted before writing (fail-closed, which is why the live file stayed intact),
// but it meant "validated" was really "not validated". Now the loader's own
// `loadOverlayPatches` parses, with a `!!js`-aware js-yaml schema as fallback.
//
// Writes UTF-8 without BOM (a BOM here would be a load-time parse failure).

import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const [live, rowFile] = process.argv.slice(2)
if (!live || !rowFile) throw new Error('usage: node install-128k-row.mjs <live cordis.patch.yml> <row.yml>')

const DSH_TREE = 'C:/Users/常绚/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai'

// ── pick a parser that speaks this dialect ────────────────────────────────────
let parse = null
let parserName = ''
try {
  const mod = await import(pathToFileURL(`${DSH_TREE}/dsh-app-boot/lib/index.js`).href)
  if (typeof mod.loadOverlayPatches === 'function') {
    parse = (file, label) => mod.loadOverlayPatches(label, file)
    parserName = 'loader loadOverlayPatches (production)'
  }
} catch (e) {
  console.log(`  (生产解析器不可用: ${e.message.slice(0, 80)})`)
}
if (!parse) {
  const require = createRequire(import.meta.url)
  const yaml = require('C:/Users/常绚/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/node_modules/js-yaml')
  const JsType = new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: (d) => d })
  const schema = yaml.DEFAULT_SCHEMA.extend([JsType])
  parse = (file) => yaml.load(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''), { schema })
  parserName = 'js-yaml + !!js type (fallback)'
}
console.log(`  解析器 = ${parserName}`)

const ROW_ID = 'preset-standard-128k'
const row = readFileSync(rowFile, 'utf8').replace(/^\uFEFF/, '')

// 1) the row file must be a 1-entry array whose insert declares the expected preset
const parsedRow = parse(rowFile, 'probe')
if (!Array.isArray(parsedRow) || parsedRow.length !== 1) throw new Error(`row file must be a 1-entry array, got ${JSON.stringify(parsedRow)?.slice(0, 80)}`)
const inserted = parsedRow[0].insert
if (!Array.isArray(inserted) || inserted.length !== 1) throw new Error('row file must contain exactly one `- insert:` entry')
const spec = inserted[0]
if (spec.id !== ROW_ID || spec.name !== '@deepseek-ai/dsh-agent-preset') throw new Error(`unexpected identity: ${spec.id} / ${spec.name}`)
const budget = spec.config?.plugins?.find((p) => p.id === 'agent-instructions')?.config?.maxBytes
if (budget !== 131072) throw new Error(`agent-instructions.maxBytes = ${budget}, expected 131072`)
console.log(`  row ok: id=${spec.id} config.id=${spec.config.id} order=${spec.config.order} plugins=${spec.config.plugins.length} maxBytes=${budget}`)

// 4) refuse a double install
const before = readFileSync(live, 'utf8')
if (before.includes(`- id: ${ROW_ID}`)) throw new Error(`${ROW_ID} already present — refusing to install twice`)
const parsedBefore = parse(live, 'live')
if (!Array.isArray(parsedBefore)) throw new Error('live patch is not a top-level YAML array')
const idsBefore = parsedBefore.filter((e) => e && e.id).map((e) => e.id)
console.log(`  live: ${parsedBefore.length} entries, ids = ${idsBefore.join(', ')}`)

// 2) backup
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
const backup = `${live}.bak-${stamp}-agent128k`
if (existsSync(backup)) throw new Error(`backup path exists: ${backup}`)
copyFileSync(live, backup)
console.log(`  备份 -> ${backup}`)

// write: original text verbatim + the block appended
writeFileSync(live, before + (before.endsWith('\n') ? '\n' : '\n\n') + row.trimEnd() + '\n', { encoding: 'utf8' })

// 3) the result must parse, keep every original id, and add exactly one insert row
const parsedAfter = parse(live, 'live-after')
if (!Array.isArray(parsedAfter)) throw new Error('RESULT does not parse — restore from backup!')
const idsAfter = parsedAfter.filter((e) => e && e.id).map((e) => e.id)
const lost = idsBefore.filter((id) => !idsAfter.includes(id))
if (lost.length) throw new Error(`original entries disappeared: ${lost.join(', ')} — restore from backup!`)
const inserts = parsedAfter.flatMap((e) => e.insert ?? [])
const mine = inserts.filter((r) => r.id === ROW_ID)
if (mine.length !== 1) throw new Error(`expected exactly 1 ${ROW_ID}, found ${mine.length} — restore from backup!`)

console.log('')
console.log(`  ✅ 已安装 ${live}`)
console.log(`     条目 ${parsedBefore.length} -> ${parsedAfter.length}   新行 id=${mine[0].id} maxBytes=${mine[0].config.plugins.find((p) => p.id === 'agent-instructions').config.maxBytes}`)
console.log(`     还原: Copy-Item "${backup}" "${live}" -Force`)
