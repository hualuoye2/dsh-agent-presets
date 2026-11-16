// Measure what workspace instructions a session actually received.
//
// The session log records the injected workspace-instructions text verbatim as a
// `user/message`, so the delivered byte count — and any truncation notice — is readable
// from disk. That is the end-to-end proof of the instruction BUDGET: a preset's
// `maxBytes` either fits the file or the tail is silently dropped with a notice.
//
// This is the check that distinguishes "the preset is named 128k" from "128 KB actually
// reached the model".
//
// TWO INSTRUMENTS, ON PURPOSE (2026-10-07). The first version flagged truncation with
// `/instruction budget|truncated/i` on the whole blob — and it reported a truncation for a
// session that had received the file WHOLE, because AGENTS.md documents the notice text
// verbatim (`` `truncated AGENTS.md from 67766 to 65244` ``). The instrument matched the
// documentation. So now:
//   1. the notice is matched by its ANCHORED shape at line start, and
//   2. the verdict is corroborated ARITHMETICALLY against the file on disk,
//      which the session header's `cwd` lets us find. Untruncated ⇒ delivered > file,
//      by exactly the harness wrapper (~304 bytes, measured three times).
// A keyword is not a conclusion; a number that could not come out any other way is.
//
// Usage: node session-instructions.mjs <session.v*.jsonl.zstd>

import { readFileSync, existsSync, statSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'
import { join } from 'node:path'

const file = process.argv[2]
if (!file) throw new Error('usage: node session-instructions.mjs <session.v*.jsonl.zstd>')

const buf = readFileSync(file)
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
const lines = all.split(/\r?\n/).filter((l) => l.trim())
console.log(`  帧=${starts.length}  行=${lines.length}  解出=${all.length} 字符`)

// The harness's own notice, anchored at line start. Prose ABOUT the notice does not match.
const NOTICE = /^Workspace instruction budget (\d+) bytes: truncated AGENTS\.md from (\d+) to (\d+) bytes/m

let cwd = null
let preset = null
const blobs = []
for (const l of lines) {
  let o
  try { o = JSON.parse(l) } catch { continue }
  if (o.type === 'session') {
    cwd = o.cwd ?? o.data?.cwd ?? cwd
    preset = o.agentPreset ?? o.data?.agentPreset ?? preset
    continue
  }
  const msg = o?.data?.message ?? o.data
  const content = msg?.content
  if (!Array.isArray(content)) continue
  for (const c of content) {
    if (typeof c?.text === 'string' && /workspace instructions|<system-reminder>/i.test(c.text)) {
      blobs.push({ type: o.type, text: c.text })
    }
  }
}
console.log(`  会话 preset = ${preset ?? '(未记录)'}   cwd = ${cwd ?? '(未记录)'}`)

const docBytes = cwd && existsSync(join(cwd, 'AGENTS.md')) ? statSync(join(cwd, 'AGENTS.md')).size : null
if (docBytes !== null) console.log(`  磁盘上的 AGENTS.md = ${docBytes} 字节`)

console.log(`  命中"工作区指令类"消息 = ${blobs.length}`)
// The payload has TWO head shapes, and only recognising one of them is how the truncated
// blobs got misclassified as "其它" (2026-10-07):
//   untruncated: <system-reminder>\nThe following workspace instructions are relevant…
//   truncated:   <system-reminder>\nWorkspace instruction budget 65536 bytes: truncated…
// so accept either, but still require the tag at position 0 — which is what keeps a tool
// result that merely PRINTS such a header from being counted as an injection.
const lastWorkspace = blobs.reduce((acc, b, i) => (/^\s*<system-reminder>[\s>]/.test(b.text.slice(0, 30)) && /(workspace instructions|Workspace instruction budget)/i.test(b.text.slice(0, 200)) ? i : acc), -1)
for (let i = 0; i < blobs.length; i++) {
  const b = blobs[i]
  const bytes = Buffer.byteLength(b.text, 'utf8')
  const m = b.text.match(NOTICE)
  const head = b.text.slice(0, 200)
  const isWorkspace = /^\s*<system-reminder>[\s>]/.test(b.text.slice(0, 30)) && /(workspace instructions|Workspace instruction budget)/i.test(head)
  const kind = isWorkspace ? (i === lastWorkspace ? '工作区指令·最近一次' : '工作区指令·历史') : /skills are available/i.test(head) ? '技能目录（不做算术互证）' : '其它 reminder / 引用'
  console.log(`    type=${b.type}  ${bytes} 字节  (${b.text.length} 字符)  真截断通知=${m !== null}  [${kind}]`)
  console.log(`      开头: ${b.text.replace(/\s+/g, ' ').slice(0, 110)}`)
  if (m) console.log(`      ⚠ 通知原文: budget=${m[1]}  from=${m[2]} to=${m[3]}  （尾部丢了 ${Number(m[2]) - Number(m[3])} 字节）`)
  // Arithmetic cross-check ONLY for the most recent injection. Comparing an older injection
  // against TODAY's file on disk is instrument-baseline drift, not evidence — AGENTS.md grew
  // between them, which manufactured six phantom "异常" lines on 2026-10-07.
  if (docBytes !== null && isWorkspace && i === lastWorkspace) {
    const delta = bytes - docBytes
    const verdict = m ? '截断（见上方通知）' : delta >= 0 ? `完整（超出文件 ${delta} 字节 = 框架开销）` : `异常：比磁盘上的文件少 ${-delta} 字节，却没有通知`
    console.log(`      📐 算术互证（仅对最近一次注入有效）: 实收 − 磁盘 = ${delta >= 0 ? '+' : ''}${delta}  →  ${verdict}`)
  } else if (isWorkspace && docBytes !== null) {
    console.log(`      （历史注入：磁盘上的文件此后又改过，放弃算术互证）`)
  }
}
if (!blobs.length) {
  console.log('  (这条会话里没有工作区指令消息 —— 可能还没发过消息)')
  const types = {}
  for (const l of lines) { try { const t = JSON.parse(l).type ?? '?'; types[t] = (types[t] ?? 0) + 1 } catch {} }
  console.log('  记录类型分布: ' + Object.entries(types).map(([k, v]) => `${k}=${v}`).join('  '))
}
