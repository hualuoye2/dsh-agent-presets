// Build the `standard-128k` preset ROW from the desktop build's own `standard` row.
//
// Why generate instead of hand-write: the desktop declares presets as inserted rows of
// `@deepseek-ai/dsh-agent-preset` whose `config.plugins` is the FULL child list. Patch
// `config` is replaced wholesale (source: `target[key] = value`), so a partial override
// would leave the preset with one plugin and break it. Copying the authoritative list
// and changing exactly one number is the only safe edit.
//
// Three bugs this script already survived:
//   - hardcoded indentation (real file uses 4/8, not 6/10) -> now measured from the file
//   - `lines.slice()` copies the array, so edits to the slice were silently discarded
//     -> now every edit addresses an absolute index in `lines`
//   - THE EXPENSIVE ONE: the replacement was written `(m) => `${m[1]}…${m[2]}``, but
//     `String.replace(re, fn)` passes the WHOLE MATCH STRING as the first argument —
//     the capture array only exists for `str.match(re)`. So `m[1]`/`m[2]` indexed
//     *characters* of the matched line (two spaces here), and every edited line came
//     back as ` preset-standard-128k ` instead of `    - id: preset-standard-128k`:
//     the key AND the indentation were replaced by a single space.
//     The 4-diff self-check below PASSED the whole time — it counted changed lines and
//     never checked that a changed line is still valid. The real loader caught it:
//     `YAMLException: bad indentation of a sequence entry (5:2)`.
//     -> signature is now `(match, p1, p2)`, plus a shape assertion after each edit.
// Kept as a cautionary shape: assert counts, assert SHAPE, then diff the result.
//
// Reads:  the extracted `dsh-web-app/presets/standard.patch.yml`
// Writes: `_preset-standard-128k.yml` (an `- insert:` block ready for the profile patch)
//
// ⚠️ 2026-11-07（0.2.2-rc.1 实测）：桌面**宿主层**已由 `dsh-web-app` bundle 插入
//    `tool-subagent-list-agents`（= `@deepseek-ai/dsh-tool-subagent-control/list-agents`）。
//    预设里再声明同一行会停在 “never started”，registry 把整个 preset 判成 broken，
//    于是 `standard-128k` 加载失败、会话回退到 64 KB 的 `standard`（AGENTS.md 被截尾）。
//    本脚本的模板来自 CLI 的 `presets/standard.patch.yml`，那份**仍带**这一行 ⇒
//    生成(或从别处复制)后必须删掉；最稳的是改从「桌面 live standard 的 config.plugins」取模板。
//    已同步的产物：`_preset-standard-128k.yml`（该行已剔除）。

import { readFileSync, writeFileSync } from 'node:fs'

const src = process.argv[2]
const out = process.argv[3]
if (!src || !out) throw new Error('usage: node make-128k-row.mjs <standard.patch.yml> <out.yml>')

const original = readFileSync(src, 'utf8')
const lines = original.split(/\r?\n/)
const indentOf = (l) => l.length - l.trimStart().length

const rowAt = lines.findIndex((l) => /^\s*- id: preset-standard\s*$/.test(l))
if (rowAt < 0) throw new Error('row `- id: preset-standard` not found — refusing to guess')
const rowIndent = indentOf(lines[rowAt])
let endAt = lines.length
for (let i = rowAt + 1; i < lines.length; i++) {
  if (lines[i].trim() !== '' && indentOf(lines[i]) <= rowIndent) { endAt = i; break }
}
console.log(`  row @ ${rowAt + 1} 行，缩进=${rowIndent}，覆盖第 ${rowAt + 2}–${endAt} 行`)

// [label, regex, replacement, from, to] — replacement uses a FUNCTION so `$1` cannot
// collide with a literal digit suffix (the `order: order: 2` bug). The function MUST
// take `(match, p1, p2)`; naming only the first parameter and indexing it is the bug
// described in the header — `replace` hands over the match string, not the match array.
const edits = [
  ['row id', /^(\s*- id: )preset-standard(\s*)$/, (m, p1, p2) => `${p1}preset-standard-128k${p2}`, rowAt, rowAt + 1],
  ['config.id', /^(\s*id: )standard(\s*)$/, (m, p1, p2) => `${p1}standard-128k${p2}`, rowAt + 1, endAt],
  ['order', /^(\s*order: )1(\s*)$/, (m, p1, p2) => `${p1}2${p2}`, rowAt + 1, endAt],
  ['maxBytes', /^(\s*maxBytes: )65536(\s*)$/, (m, p1, p2) => `${p1}131072${p2}`, 0, lines.length],
]
for (const [label, re, fn, from, to] of edits) {
  const hits = []
  for (let i = from; i < to; i++) if (re.test(lines[i])) hits.push(i)
  if (hits.length !== 1) throw new Error(`expected exactly 1 ${label}, found ${hits.length} — refusing to guess`)
  const before = lines[hits[0]]
  lines[hits[0]] = lines[hits[0]].replace(re, fn)
  // Shape assertion: the edit may only touch the VALUE. The key and the leading
  // indentation of `before` must still be there verbatim. This is the check whose
  // absence let the corrupted row ship for a whole round.
  const lead = before.match(/^\s*(?:- )?[A-Za-z]+: /)
  if (!lead || !lines[hits[0]].startsWith(lead[0])) {
    throw new Error(
      `${label}: edit destroyed the key/indentation\n    before = ${JSON.stringify(before)}\n    after  = ${JSON.stringify(lines[hits[0]])}\n` +
        `  (hint: String.replace(re, fn) passes the MATCH STRING as arg 0 — use (match, p1, p2))`,
    )
  }
  console.log(`  ok  ${label.padEnd(10)} -> ${lines[hits[0]].trim()}`)
}

const text = lines.join('\n')
for (const bad of ['65536', 'preset-standard\n', 'id: standard\n', 'order: 1\n']) {
  if (text.includes(bad)) throw new Error(`stale value survived: ${JSON.stringify(bad)}`)
}

// Diff against the original — the check that caught both earlier bugs.
const after = text.split(/\r?\n/)
let diffs = 0
for (let i = 0; i < Math.max(lines.length, after.length); i++) {
  if (original.split(/\r?\n/)[i] !== after[i]) { diffs++; console.log(`  差异 第${i + 1}行: - ${String(original.split(/\r?\n/)[i]).trim()}  + ${String(after[i]).trim()}`) }
}
if (diffs !== 4) throw new Error(`expected exactly 4 changed lines, got ${diffs}`)

writeFileSync(out, text, 'utf8')
console.log(`  ✅ 恰好 4 处差异，已写出 ${out} (${Buffer.byteLength(text, 'utf8')} 字节)`)
