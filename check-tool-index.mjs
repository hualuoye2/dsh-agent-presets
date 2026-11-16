// Guard for the full tool index in README.md.
//
// What it catches: a new (or renamed) *.mjs / *.ps1 / *.py dropped into this directory
// that nobody documented. Without this, the next session cannot tell a live tool from a
// one-off forensic script — which is exactly how `session-*.mjs`, `asar-*.mjs`,
// `struct-check.mjs` … ended up undocumented while README covered only the preset row.
//
// Direction of the check:
//   disk -> README : MUST be covered. A file on disk that README never names is a FAIL
//                    (printed one per line, exit 1).
//   README -> disk : REPORT ONLY, never a FAIL. Historical names (`headless-*.overlay.yml`
//                    era, deleted probes) are records worth keeping; treating them as
//                    "missing files" would push people to delete history to get a green.
//
// Output is deliberately pure ASCII: this runs under Windows PowerShell 5.1, whose console
// mangles UTF-8, and a mojibake reading must never be mistaken for a data problem.
//
// Usage: node check-tool-index.mjs
// Exit:  0 = every on-disk script is named in README.md (prints RESULT: PASS)
//        1 = at least one on-disk script is unnamed (prints the names)
//        2 = the directory or README.md could not be read (instrument failure, NOT a
//            content verdict — the distinction matters, see AGENTS.md `exitcode-vs-reason`)

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const DIR = 'D:/deepseek/.agent-presets'
const README = join(DIR, 'README.md')
const EXTS = ['.mjs', '.ps1', '.py']

// ---- read the two inputs -------------------------------------------------------------
let entries
try {
  entries = readdirSync(DIR, { withFileTypes: true })
} catch (err) {
  console.error(`GUARD-ERROR cannot list ${DIR}: ${err.message}`)
  process.exit(2)
}

let readme
try {
  readme = readFileSync(README, 'utf8').replace(/^\uFEFF/, '')
} catch (err) {
  console.error(`GUARD-ERROR cannot read ${README}: ${err.message}`)
  process.exit(2)
}

// ---- name set on disk (top level only; subdirectories are excluded on purpose) --------
const onDisk = entries
  .filter((e) => e.isFile() && EXTS.includes(e.name.slice(e.name.lastIndexOf('.'))))
  .map((e) => e.name)
  .sort()

// sanity: a stray directory matching an extension must not be silently skipped
const dirsWithExt = entries
  .filter((e) => e.isDirectory() && EXTS.includes(e.name.slice(e.name.lastIndexOf('.'))))
  .map((e) => e.name)

console.log(`DIR    = ${DIR}`)
console.log(`README = ${README}`)
console.log(`SCAN   = top-level *${EXTS.join(' / *')}  (subdirectories excluded)`)
console.log(`DISK   = ${onDisk.length} script file(s)`)
if (dirsWithExt.length) console.log(`NOTE   = directories with a script-like extension (NOT counted): ${dirsWithExt.join(', ')}`)
console.log('')

// ---- direction 1: disk -> README (this is the gate) ----------------------------------
const missing = onDisk.filter((name) => !readme.includes(name))

// ---- direction 2: README -> disk (report only) ---------------------------------------
const mentioned = new Set()
const re = /[A-Za-z0-9_.\u4e00-\u9fff-]+\.(?:mjs|ps1|py)\b/g
for (const m of readme.match(re) ?? []) {
  const base = m.split(/[/\\]/).pop()
  mentioned.add(base)
}
const historical = [...mentioned].filter((n) => !onDisk.includes(n)).sort()

// Guard against a false PASS: every file must be a regular file we can actually see.
for (const name of onDisk) {
  const st = statSync(join(DIR, name))
  if (!st.isFile()) {
    console.error(`GUARD-ERROR ${name} is not a regular file`)
    process.exit(2)
  }
}

console.log(`README covers ${onDisk.length - missing.length} / ${onDisk.length} on-disk script(s)`)

if (historical.length) {
  console.log('')
  console.log(`NOTE   = named in README but absent from disk (historical, NOT a failure): ${historical.length}`)
  for (const n of historical) console.log(`         ${n}`)
}

if (missing.length) {
  console.log('')
  console.log(`MISSING from README.md (${missing.length}):`)
  for (const n of missing) console.log(`  ${n}`)
  console.log('')
  console.log(`RESULT: FAIL - ${missing.length} script file(s) on disk have no entry in README.md`)
  process.exitCode = 1
} else {
  console.log('')
  console.log(`RESULT: PASS - all ${onDisk.length} script file(s) on disk are named in README.md`)
  process.exitCode = 0
}
