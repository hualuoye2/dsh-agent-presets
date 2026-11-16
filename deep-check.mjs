// Deep (recursive) checker: does the named insert row contain ANY node whose `id`
// equals the target, at ANY nesting depth inside config.plugins (groups nest children
// in `config: [...]`)?  Uses the production loader to parse the `!!js` dialect.
// Usage: node deep-check.mjs <file> <rowId> <targetId>
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const [file, rowId, targetId] = process.argv.slice(2)
if (!file || !rowId || !targetId) throw new Error('usage: node deep-check.mjs <file> <rowId> <targetId>')

const DSH_TREE = 'C:/Users/常绚/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai'
const mod = await import(pathToFileURL(`${DSH_TREE}/dsh-app-boot/lib/index.js`).href)
const parsed = mod.loadOverlayPatches('probe', file)

const rows = []
for (const e of parsed) if (e && Array.isArray(e.insert)) for (const r of e.insert) rows.push(r)
const spec = rows.find((r) => r && r.id === rowId)
if (!spec) {
  console.log(`CONCLUSION: ROW_NOT_FOUND ${rowId}`)
  process.exit(2)
}

const found = []
const ids = []
let nodes = 0
const walk = (v, path) => {
  if (Array.isArray(v)) {
    v.forEach((x, i) => walk(x, `${path}[${i}]`))
    return
  }
  if (v && typeof v === 'object') {
    nodes++
    if (typeof v.id === 'string') {
      ids.push(v.id)
      if (v.id === targetId) found.push(`${path}.id`)
    }
    for (const k of Object.keys(v)) walk(v[k], `${path}.${k}`)
  }
}
walk(spec.config, 'config')

console.log(`FILE                     = ${file}`)
console.log(`ROW                      = ${rowId}  (config.id = ${spec.config && spec.config.id})`)
console.log(`TARGET_ID                = ${targetId}`)
console.log(`OBJECT_NODES_VISITED     = ${nodes}`)
console.log(`ID_NODES_TOTAL           = ${ids.length}`)
console.log(`IDS_ALL_DEPTHS           = [${ids.join(', ')}]`)
console.log(`TARGET_FOUND_ANY_DEPTH   = ${found.length > 0}   count=${found.length}`)
for (const p of found) console.log(`   at ${p}`)
console.log(`WHOLE_FILE_TARGET_LITERAL_OCCURRENCES = ${readFileSync(file, 'utf8').split(targetId).length - 1}`)
console.log(`CONCLUSION: ${found.length > 0 ? 'DEEP_CONTAINS_TRUE' : 'DEEP_CONTAINS_FALSE'}`)
