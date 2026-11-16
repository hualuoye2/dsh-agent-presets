// Validate a locally authored agent preset WITHOUT the runtime.
//
// Why this exists: the authoritative check is `standingKeyFor(id)` mount
// validation, which needs the `cordis_mount` tool from the `cordis` preset. This
// session runs `standard`, so that tool is absent. This script reproduces the
// part of mount validation that can be decided statically, and states plainly
// which part it cannot decide.
//
// What it decides:
//   C1  the file parses in the loader's YAML dialect and is a list of named rows
//   C2  every row's package resolves (one of the four mount rejection modes)
//   C3  the authored row set equals `standard`'s minus exactly the intended rows
//   C4  no row is left consuming a service only the removed group provided
//   C5  row ids are unique
//   C6  realm (`isolate`) keys are exactly the intended set
//
// What it CANNOT decide, and therefore does not claim:
//   - a row whose config is invalid (`invalid config: $.<field> ...`)
//   - a row that never activates (waiting for a service the composition never supplies)
//   - a service published into the root realm
// Only a real mount catches those. Do not read this script's PASS as mount-valid.
//
// Per this workspace's own rule, a checker that reports zero problems has not
// been shown to work, only to run. So every check below is fault-injected at the
// end and must be observed to FAIL.

import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(
  'C:/Users/常绚/.dsh/profiles/desktop/node_modules/_resolve-anchor.js',
)
const yaml = require('js-yaml')

const VERIFY = 'D:/deepseek/.agent-presets/verify/agent.cordis.yml'
const STANDARD =
  'C:/Users/常绚/.dsh/profiles/node_modules/@deepseek-ai/dsh-agent-presets/presets/standard/agent.cordis.yml'

// The loader dialect allows `!!js <expression>` on `disabled`. Accept it as a
// scalar rather than failing the parse.
const JsTag = new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  construct: (data) => `<<js:${data}>>`,
})
const SCHEMA = yaml.DEFAULT_SCHEMA.extend([JsTag])

function parseRows(text, label) {
  const doc = yaml.load(text, { schema: SCHEMA })
  if (!Array.isArray(doc)) throw new Error(`${label}: top level is not a list`)
  return doc
}

// Flatten group rows so nested `config:` lists are checked too.
function flatten(rows, out = [], path = []) {
  for (const row of rows) {
    if (row && typeof row === 'object' && !Array.isArray(row)) {
      out.push({ row, path: [...path, row.id ?? '<no id>'] })
      if (Array.isArray(row.config)) flatten(row.config, out, [...path, row.id])
    }
  }
  return out
}

const pkgOf = (name) => {
  const parts = String(name).split('/')
  return name.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

function resolves(name) {
  if (name === 'cordis:group') return true
  try {
    require.resolve(`${pkgOf(name)}/package.json`, {
      paths: ['C:/Users/常绚/.dsh/profiles/desktop'],
    })
    return true
  } catch {
    return false
  }
}

// Flattened row ids, so the `delegation` GROUP id counts as removed alongside its
// children. Missing this entry was this script's own first bug: the real file was
// correct and the checker reported a false problem. That is the failure mode the
// injection section below exists to surface.
const INTENDED_REMOVED = [
  'delegation',
  'tool-subagent-control',
  'tool-subagent-list-agents',
  'tool-subagent',
  'tool-subagent-fork',
  'tool-subagent-codex',
  'tool-subagent-claude-code',
  'workflow-worker-thread',
  'tool-workflow',
  'tool-ralph',
]
const INTENDED_ISOLATE = ['planMode', 'compaction', 'toolResultPruner']
// Services the removed delegation group provided. Nothing may still consume them.
const DEAD_SERVICES = ['workflowEngine', 'workflows']

function check(verifyRows, standardRows) {
  const errors = []
  const v = flatten(verifyRows)
  const s = flatten(standardRows)

  // C1
  for (const { row, path } of v) {
    if (typeof row.id !== 'string' || !row.id) errors.push(`C1 ${path.join('/')}: missing id`)
    if (typeof row.name !== 'string' || !row.name) errors.push(`C1 ${path.join('/')}: missing name`)
  }

  // C2
  for (const { row, path } of v) {
    if (typeof row.name === 'string' && !resolves(row.name)) {
      errors.push(`C2 ${path.join('/')}: package does not resolve: ${row.name}`)
    }
  }

  // C3
  const vid = new Set(v.map((x) => x.row.id))
  const sid = new Set(s.map((x) => x.row.id))
  for (const id of INTENDED_REMOVED) {
    if (vid.has(id)) errors.push(`C3 row meant to be removed is still present: ${id}`)
    if (!sid.has(id)) errors.push(`C3 row meant to exist in standard is absent there: ${id}`)
  }
  for (const id of vid) if (!sid.has(id)) errors.push(`C3 row is not in standard (unexpected): ${id}`)
  for (const id of sid) {
    if (!vid.has(id) && !INTENDED_REMOVED.includes(id)) {
      errors.push(`C3 row was dropped but not intended: ${id}`)
    }
  }

  // C4
  for (const { row, path } of v) {
    const iso = row.isolate && typeof row.isolate === 'object' ? Object.keys(row.isolate) : []
    for (const key of iso) {
      if (DEAD_SERVICES.includes(key)) errors.push(`C4 ${path.join('/')}: consumes dead service ${key}`)
    }
  }

  // C5
  const seen = new Map()
  for (const { row } of v) seen.set(row.id, (seen.get(row.id) ?? 0) + 1)
  for (const [id, n] of seen) if (n > 1) errors.push(`C5 duplicate row id (x${n}): ${id}`)

  // C6
  const isolateKeys = new Set()
  for (const { row } of v) {
    if (row.isolate && typeof row.isolate === 'object') for (const k of Object.keys(row.isolate)) isolateKeys.add(k)
  }
  for (const k of isolateKeys) if (!INTENDED_ISOLATE.includes(k)) errors.push(`C6 unexpected isolate realm: ${k}`)
  for (const k of INTENDED_ISOLATE) if (!isolateKeys.has(k)) errors.push(`C6 expected isolate realm missing: ${k}`)

  return { errors, v, s, isolateKeys: [...isolateKeys] }
}

// ── run against the real file ───────────────────────────────────────────────
const verifyText = readFileSync(VERIFY, 'utf8')
const standardText = readFileSync(STANDARD, 'utf8')
const { errors, v, s } = check(parseRows(verifyText, 'verify'), parseRows(standardText, 'standard'))

console.log('── facts ───────────────────────────────────────────')
console.log(`verify  rows (flattened) = ${v.length}`)
console.log(`standard rows (flattened) = ${s.length}`)
console.log(`rows removed              = ${s.length - v.length}`)
console.log(`packages resolved         = ${v.filter((x) => resolves(x.row.name)).length}/${v.length}`)
console.log(`isolate realms            = ${[...new Set(v.flatMap((x) => (x.row.isolate ? Object.keys(x.row.isolate) : [])))].join(', ')}`)
console.log('')
if (errors.length) {
  console.log(`REAL FILE: FAIL (${errors.length})`)
  for (const e of errors) console.log('  ' + e)
} else {
  console.log('REAL FILE: PASS (0 problems)  [but see the caveat: this is NOT mount validation]')
}

// ── fault injection: prove the checks above can fail ────────────────────────
// Each injection must be OBSERVED to be caught by the named check. An injection
// that produces no new error means the injection did not take effect OR the
// check is dead — both are failures of this script, not passes.
const injections = [
  {
    name: 'C2 package typo',
    check: 'C2',
    text: verifyText.replace("'@deepseek-ai/dsh-tool-pwsh'", "'@deepseek-ai/dsh-tool-pwsh-DOES-NOT-EXIST'"),
    expect: 'package does not resolve',
  },
  {
    name: 'C3 extra removal',
    check: 'C3',
    // Remove a WHOLE row. An earlier version of this injection deleted only the
    // `- id:` line, which left a duplicated `name:` key: the YAML parser threw
    // before C3 ever ran, so the injection looked "caught" while proving nothing
    // about C3.
    text: verifyText.replace("- id: tool-skill\n  name: '@deepseek-ai/dsh-tool-skill'\n\n", ''),
    expect: 'not intended',
  },
  {
    name: 'C3 row resurrected',
    check: 'C3',
    text: verifyText.replace(
      '- id: tool-ask-user',
      "- id: tool-workflow\n  name: '@deepseek-ai/dsh-tool-workflow'\n\n- id: tool-ask-user",
    ),
    expect: 'meant to be removed is still present',
  },
  {
    name: 'C4 dead service realm',
    check: 'C4',
    text: verifyText.replace('  isolate:\n    planMode: true', '  isolate:\n    workflowEngine: true'),
    expect: 'consumes dead service',
  },
  {
    name: 'C5 duplicate id',
    check: 'C5',
    text: verifyText.replace('- id: present\n', '- id: tool-todo\n'),
    expect: 'duplicate row id',
  },
  {
    name: 'C6 stray isolate realm',
    check: 'C6',
    text: verifyText.replace('  isolate:\n    planMode: true', '  isolate:\n    planMode: true\n    bogusRealm: true'),
    expect: 'unexpected isolate realm',
  },
]

console.log('')
console.log('── fault injection (the checker must FAIL on each) ──')
let injected = 0
for (const inj of injections) {
  if (inj.text === verifyText) {
    console.log(`  ${inj.check} ${inj.name}: INJECTION DID NOT APPLY  <-- script bug`)
    continue
  }
  let verdict = 'MISSED'
  let detail = ''
  try {
    const res = check(parseRows(inj.text, inj.name), parseRows(standardText, 'standard'))
    const hit = res.errors.filter((e) => e.startsWith(inj.check) && e.includes(inj.expect))
    if (hit.length > 0) {
      verdict = 'CAUGHT'
      detail = hit[0]
    } else {
      detail = res.errors[0] ?? 'no error at all'
    }
  } catch (error) {
    // A parse throw is a detection, but NOT evidence that the named check works.
    // Counting it as a catch is exactly how "all green" hides a dead assertion.
    verdict = 'PARSE-ERROR'
    detail = `threw: ${String(error.message).split('\n')[0]}`
  }
  console.log(`  ${inj.check} ${inj.name}: ${verdict}  ${verdict === 'CAUGHT' ? '' : '<-- '}${detail}`)
  if (verdict === 'CAUGHT') injected++
}
console.log('')
console.log(`injections caught = ${injected}/${injections.length}`)
const ok = errors.length === 0 && injected === injections.length
console.log(ok ? 'RESULT: PASS' : 'RESULT: FAIL')
process.exit(ok ? 0 : 1)
