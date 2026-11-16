// Did the verification persona actually reach the model on the DESKTOP plane, verbatim?
//
// The gap this closes: `preset-verify` was built by lifting the CLI preset's `prefix` block
// byte-for-byte (make-verify-row.mjs lifts it programmatically) and the install was validated
// by the production loader. But "the row contains the text" is not "the model received the
// text" — the last hop (patch row -> composed preset -> system prompt -> session log) was only
// checked for the PRESENCE of one phrase. This compares them paragraph by paragraph.
//
// Normalisation: the YAML `>-` block scalar folds newlines into spaces and turns blank lines
// into paragraph breaks, so an exact byte compare would fail on framing alone. Comparing the
// ordered list of whitespace-normalised paragraphs catches a lost/edited/reordered paragraph
// while ignoring that framing.
//
// Usage: node check-verify-persona.mjs <session.v*.jsonl.zstd> <verify preset yml>

import { readFileSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'

const [sessionFile, presetFile] = process.argv.slice(2)
if (!sessionFile || !presetFile) throw new Error('usage: node check-verify-persona.mjs <session.v*.jsonl.zstd> <verify preset yml>')

// ---- what the model actually received ----
const buf = readFileSync(sessionFile)
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const starts = []
for (let i = 0; ; ) {
  const k = buf.indexOf(MAGIC, i)
  if (k < 0) break
  starts.push(k)
  i = k + 4
}
let all = ''
for (let n = 0; n < starts.length; n++) {
  const end = n + 1 < starts.length ? starts[n + 1] : buf.length
  try { all += zstdDecompressSync(buf.subarray(starts[n], end)).toString('utf8') } catch { all += '\n' }
}
let persona = null
for (const l of all.split(/\r?\n/)) {
  if (!l.trim()) continue
  let o
  try { o = JSON.parse(l) } catch { continue }
  if (o.type === 'system/message') {
    const c = o.data?.message?.content
    if (Array.isArray(c)) { persona = c.map((x) => x?.text ?? '').join(''); break }
  }
}
if (persona === null) throw new Error('no system/message in that session (has it sent a message yet?)')

// ---- what the preset says ----
const plines = readFileSync(presetFile, 'utf8').split(/\r?\n/)
const pAt = plines.findIndex((l) => /^\s*prefix: >-\s*$/.test(l))
if (pAt < 0) throw new Error('no `prefix: >-` in the preset')
const pIndent = plines[pAt].length - plines[pAt].trimStart().length
const bodyIndent = pIndent + 2
let pEnd = pAt + 1
while (pEnd < plines.length) {
  const l = plines[pEnd]
  if (l.trim() !== '' && l.length - l.trimStart().length < bodyIndent) break
  pEnd++
}
const source = plines.slice(pAt + 1, pEnd).map((l) => (l.trim() === '' ? '' : l.slice(bodyIndent))).join('\n')

const paras = (s) => s.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, ' ').trim()).filter((p) => p.length > 0)
const wantParas = paras(source)
const gotText = persona.replace(/\s+/g, ' ')

console.log(`  会话 persona        = ${persona.length} 字符`)
console.log(`  preset prefix       = ${source.length} 字符，${wantParas.length} 段`)
console.log('')
let missing = 0
let outOfOrder = 0
let cursor = -1
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
for (const [i, p] of wantParas.entries()) {
  // Template variables are substituted at runtime (`{{model}}` -> the model id), so a literal
  // substring match fails on any paragraph carrying one. That is exactly how this checker's
  // FIRST run reported a false mismatch (2026-10-07): paragraph 1 contains `{{model}}`.
  // Same species as the ledger's audit-instrument-version entry — the instrument did not
  // account for a legitimate transformation, so it blamed the artifact.
  const re = new RegExp(escapeRe(p).replace(/\\\{\\\{\w+\\\}\\\}/g, '.+?'))
  const m = gotText.match(re)
  const at = m ? m.index : -1
  const hasVar = /\{\{\w+\}\}/.test(p)
  const head = p.slice(0, 56).replace(/\s+/g, ' ')
  if (at < 0) { missing++; console.log(`  ❌ 第 ${i + 1} 段没出现在会话 persona 里: "${head}…"`) }
  else if (at < cursor) { outOfOrder++; console.log(`  ⚠ 第 ${i + 1} 段出现但顺序不对: "${head}…"`) }
  else { cursor = at; console.log(`  ✅ 第 ${i + 1} 段 (${p.length} 字符${hasVar ? '，含模板变量，按通配匹配' : ''}) @ ${at}`) }
}
console.log('')
console.log(`  段数 ${wantParas.length}  缺 ${missing}  乱序 ${outOfOrder}`)
console.log(`  验证者首句在不在 = ${/You are an independent verification agent/i.test(persona)}`)
console.log(`  编码代理首句在不在 = ${/You are a coding agent/i.test(persona)}   （应为 false）`)
console.log(`CONCLUSION: ${missing === 0 && outOfOrder === 0 && /independent verification agent/i.test(persona) && !/You are a coding agent/i.test(persona) ? 'PERSONA_TRANSPLANT_VERBATIM' : 'PERSONA_MISMATCH'}`)
