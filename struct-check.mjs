// Structural checker for a DSH profile patch: parse it with the PRODUCTION loader, then
// answer questions about ONE named insert row's `config.plugins` list.
//
// Why the production loader and not js-yaml: this dialect carries a custom `!!js` scalar
// (`disabled: !!js process.platform === 'win32'`), so a generic parser dies with
// `unknown tag !<tag:yaml.org,2002:js>` — and "validated with a generic parser" then means
// "not validated at all".
//
// Why it is scoped to ONE row: the interesting questions are about *attribution*
// ("does THIS row's subtree still contain X?"). A whole-file grep answers a different
// question and is the classic way a false claim gets confirmed: this file contains many
// `tool-subagent` occurrences that all belong to a DIFFERENT row. The script therefore
// prints BOTH numbers side by side (row-scoped + whole-file) so the gap is visible.
//
// Usage: node struct-check.mjs <patch.yml> <rowId> [targetId=tool-subagent]
//
// Verified by discriminating injection (2026-10-07): adding a `tool-subagent` entry to the
// OTHER row left CONTAINS false, which proves the check is row-scoped rather than a grep.

import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const [file, rowId, targetIdArg] = process.argv.slice(2)
if (!file || !rowId) throw new Error('usage: node struct-check.mjs <patch.yml> <rowId> [targetId]')
const targetId = targetIdArg ?? 'tool-subagent'

const DSH_TREE = 'C:/Users/常绚/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai'
const mod = await import(pathToFileURL(`${DSH_TREE}/dsh-app-boot/lib/index.js`).href)
if (typeof mod.loadOverlayPatches !== 'function') {
  console.log('CONCLUSION: PARSER_UNAVAILABLE')
  process.exit(3)
}

const parsed = mod.loadOverlayPatches('probe', file)
console.log(`PARSER              = production loadOverlayPatches (dsh-app-boot)`)
console.log(`TARGET_ID           = ${targetId}`)
console.log(`TOP_LEVEL_IS_ARRAY  = ${Array.isArray(parsed)}`)
console.log(`TOP_LEVEL_ENTRIES   = ${Array.isArray(parsed) ? parsed.length : 'n/a'}`)

const rows = []
for (let i = 0; i < parsed.length; i++) {
  const e = parsed[i]
  if (e && Array.isArray(e.insert)) for (const r of e.insert) rows.push({ topIndex: i, r })
}
console.log(`INSERT_ROWS         = ${rows.length}`)
console.log(`INSERT_ROW_IDS      = [${rows.map((x) => x.r && x.r.id).join(', ')}]`)
console.log(`TOP_LEVEL_IDS       = [${parsed.map((e) => (e && e.id) || '<insert-only>').join(', ')}]`)

const match = rows.filter((x) => x.r && x.r.id === rowId)
console.log(`ROWS_NAMED_${rowId} = ${match.length}`)
if (match.length !== 1) {
  console.log(`CONCLUSION: ROW_NOT_FOUND_OR_AMBIGUOUS count=${match.length}`)
  process.exit(2)
}

const spec = match[0].r
const plugins = spec.config && spec.config.plugins
console.log(`ROW_CONFIG_ID       = ${spec.config && spec.config.id}`)
console.log(`ROW_ORDER           = ${spec.config && spec.config.order}`)
console.log(`PLUGINS_IS_ARRAY    = ${Array.isArray(plugins)}`)
console.log(`PLUGINS_COUNT       = ${Array.isArray(plugins) ? plugins.length : 'n/a'}`)
const ids = Array.isArray(plugins) ? plugins.map((p) => p && p.id) : []
console.log(`PLUGIN_IDS          = [${ids.join(', ')}]`)
const has = ids.includes(targetId)
console.log(`CONTAINS_${targetId} = ${has}`)
const deleg = ids.filter((id) => /subagent|workflow|ralph/.test(String(id)))
console.log(`DELEGATION_LIKE_IDS = ${deleg.length} [${deleg.join(', ')}]`)

// Sanity: the parser really produced a nested object, not a string blob.
const first = Array.isArray(plugins) ? plugins[0] : null
console.log(`FIRST_PLUGIN_TYPE   = ${typeof first} keys=[${first && typeof first === 'object' ? Object.keys(first).join(',') : ''}]`)
console.log(`PLANNING_GROUP_KIDS = ${JSON.stringify((plugins.find((p) => p && p.id === 'planning') || {}).config || null).length} chars of nested config`)

// Contrast instrument (deliberately weak): whole-file substring count. Printed so the
// row-scoped and file-wide numbers can be compared — a big gap means a grep would mislead.
const txt = readFileSync(file, 'utf8')
console.log(`WHOLE_FILE_${targetId}_OCCURRENCES = ${txt.split(targetId).length - 1}`)
const at = txt.indexOf(`- id: ${rowId}`)
console.log(`RAW_ROW_ID_LINE     = ${txt.slice(0, at).split('\n').length}  (offset ${at})`)
console.log(`OCCURRENCES_AFTER_ROW_START = ${txt.slice(at).split(targetId).length - 1}`)

console.log(`CONCLUSION: ${has ? 'CONTAINS_TRUE' : 'CONTAINS_FALSE'}`)
