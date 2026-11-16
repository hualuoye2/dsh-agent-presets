// Build the desktop `preset-verify` ROW from the desktop build's own `preset-standard` row.
//
// Same reasoning as make-128k-row.mjs: a desktop preset is an inserted row of
// `@deepseek-ai/dsh-agent-preset` whose `config.plugins` is the FULL child list, and patch
// `config` is replaced wholesale. So the only safe edit is: copy the authoritative list,
// then apply exactly three surgical changes.
//
//   1. rename   row id -> preset-verify, config.id -> verify, order -> 3
//   2. persona  prefix  -> the verifier's standing orders, lifted VERBATIM from
//                          `.agent-presets/verify/agent.cordis.yml` (never retyped —
//                          the workspace has a recorded incident where retyping quotes
//                          broke a file and silently half-registered an entry)
//   3. delete   the whole `delegation` group (subagent / subagent_fork / workflow / ralph)
//               because `subagent_fork` is seeded with the parent conversation, including
//               the parent's wrong criterion — the exact failure this preset prevents
//   and the instruction budget goes to 131072, matching `preset-standard-128k`.
//
// Reads:  <standard.patch.yml> <verify/agent.cordis.yml>
// Writes: <out.yml>
// Asserts: one delegation block found and removed; zero delegation tool ids left;
//          persona text transplanted byte-for-byte; budget set; final line-diff enumerated.

import { readFileSync, writeFileSync } from 'node:fs'

const [src, verifyPreset, out] = process.argv.slice(2)
if (!src || !verifyPreset || !out) throw new Error('usage: node make-verify-row.mjs <standard.patch.yml> <verify/agent.cordis.yml> <out.yml>')

const srcText = readFileSync(src, 'utf8')
const orig = srcText.split(/\r?\n/)
const lines = [...orig]
const indentOf = (l) => l.length - l.trimStart().length

// ── lift the verifier persona verbatim ────────────────────────────────────────
const vLines = readFileSync(verifyPreset, 'utf8').split(/\r?\n/)
const pAt = vLines.findIndex((l) => /^\s*prefix: >-\s*$/.test(l))
if (pAt < 0) throw new Error('verify preset: `prefix: >-` not found')
const pIndent = indentOf(vLines[pAt])
const bodyIndent = pIndent + 2
let pEnd = pAt + 1
while (pEnd < vLines.length) {
  const l = vLines[pEnd]
  if (l.trim() !== '' && indentOf(l) < bodyIndent) break
  pEnd++
}
const personaBody = vLines.slice(pAt + 1, pEnd).map((l) => (l.trim() === '' ? '' : l.slice(bodyIndent)))
while (personaBody.length && personaBody[personaBody.length - 1].trim() === '') personaBody.pop()
if (personaBody.length < 5) throw new Error(`verify persona looks too short (${personaBody.length} lines)`)
console.log(`  persona 取自 ${verifyPreset} 第 ${pAt + 2}–${pEnd} 行，共 ${personaBody.length} 行`)
console.log(`    首行: ${personaBody[0].slice(0, 70)}`)

// ── locate the row and its plugin list ────────────────────────────────────────
const rowAt = lines.findIndex((l) => /^\s*- id: preset-standard\s*$/.test(l))
if (rowAt < 0) throw new Error('row `- id: preset-standard` not found')
const rowIndent = indentOf(lines[rowAt])
let rowEnd = lines.length
for (let i = rowAt + 1; i < lines.length; i++) {
  if (lines[i].trim() !== '' && indentOf(lines[i]) <= rowIndent) { rowEnd = i; break }
}

// plugin entries sit two levels in from the row id
const pluginIndent = rowIndent + 6
const delAt = lines.findIndex((l, i) => i > rowAt && i < rowEnd && new RegExp(`^\\s{${pluginIndent}}- id: delegation\\s*$`).test(l))
if (delAt < 0) throw new Error(`no \`- id: delegation\` at indent ${pluginIndent} — refusing to guess`)
let delEnd = rowEnd
for (let i = delAt + 1; i < rowEnd; i++) {
  if (lines[i].trim() !== '' && indentOf(lines[i]) <= pluginIndent) { delEnd = i; break }
}
const removedLines = delEnd - delAt
console.log(`  delegation 块 @ ${delAt + 1} 行，删 ${removedLines} 行（含嵌套子项）`)

// ── the three edits, each count-asserted ─────────────────────────────────────
const edits = [
  ['row id', /^(\s*- id: )preset-standard(\s*)$/, 'preset-verify', rowAt, rowAt + 1],
  ['config.id', /^(\s*id: )standard(\s*)$/, 'verify', rowAt + 1, delAt],
  ['order', /^(\s*order: )1(\s*)$/, '3', rowAt + 1, delAt],
  ['maxBytes', /^(\s*maxBytes: )65536(\s*)$/, '131072', 0, lines.length],
]
for (const [label, re, mid, from, to] of edits) {
  const hits = []
  for (let i = from; i < to; i++) if (re.test(lines[i])) hits.push(i)
  if (hits.length !== 1) throw new Error(`expected exactly 1 ${label}, found ${hits.length}`)
  const m = re.exec(lines[hits[0]])
  const before = lines[hits[0]]
  lines[hits[0]] = `${m[1]}${mid}${m[2] ?? ''}`
  // shape guard: the key text must survive the value swap
  const lead = before.match(/^\s*(?:- )?[A-Za-z]+: /)
  if (!lead || !lines[hits[0]].startsWith(lead[0])) throw new Error(`${label}: key/indent destroyed by the edit`)
  console.log(`  ok  ${label.padEnd(10)} -> ${lines[hits[0]].trim()}`)
}

// ── persona transplant ───────────────────────────────────────────────────────
const pfAt = lines.findIndex((l, i) => i > rowAt && i < rowEnd && /^\s*prefix: /.test(l))
if (pfAt < 0) throw new Error('no `prefix:` inside the row')
const pfIndent = indentOf(lines[pfAt])
const newBlock = [`${' '.repeat(pfIndent)}prefix: >-`, ...personaBody.map((b) => (b === '' ? '' : `${' '.repeat(pfIndent + 2)}${b}`))]
lines.splice(pfAt, 1, ...newBlock)
console.log(`  ok  persona    -> ${personaBody.length} 行块标量（原 1 行）`)

// ── remove the delegation block (after the other edits, so indices stay valid) ─
const delAt2 = lines.findIndex((l, i) => i > rowAt && new RegExp(`^\\s{${pluginIndent}}- id: delegation\\s*$`).test(l))
if (delAt2 < 0) throw new Error('delegation block lost during edits')
let delEnd2 = lines.length
for (let i = delAt2 + 1; i < lines.length; i++) {
  if (lines[i].trim() !== '' && indentOf(lines[i]) <= pluginIndent) { delEnd2 = i; break }
}
lines.splice(delAt2, delEnd2 - delAt2)
console.log(`  ok  delegation 已删除（${delEnd2 - delAt2} 行）`)

const text = lines.join('\n')
// ── gates ────────────────────────────────────────────────────────────────────
for (const r of ['- id: preset-verify', 'id: verify', 'order: 3', 'maxBytes: 131072', 'independent verification agent'])
  if (!text.includes(r)) throw new Error(`required content missing: ${JSON.stringify(r)}`)
for (const bad of ['tool-subagent', 'tool-workflow', 'tool-ralph', 'workflow-ptc', 'id: delegation'])
  if (text.includes(bad)) throw new Error(`delegation residue survived: ${JSON.stringify(bad)}`)
if (text.includes('You are a coding agent powered')) throw new Error('the coding-agent persona survived')
for (const mustKeep of ['- id: tool-fs', '- id: tool-pwsh', '- id: planning', '- id: compaction', '- id: tool-goal'])
  if (!text.includes(mustKeep)) throw new Error(`an unrelated plugin was lost: ${mustKeep}`)

console.log(`  行数 ${orig.length} -> ${lines.length}`)
writeFileSync(out, text, 'utf8')
console.log(`  ✅ 已写出 ${out} (${Buffer.byteLength(text, 'utf8')} 字节)`)
