// Which agent preset did each session actually get, and when was it created?
//
// Why this exists: a preset is persisted per session, and the roster's `default` is only
// consulted at session CREATION. So "I changed the default" and "the change is in effect" are
// different claims — a session created AFTER the change, parsed from disk, is the read-out.
//
// ⚠️ **这个数字不是什么**（2026-10-07 补）：头里的 `agentPreset` 是**创建时的值**。空白会话在
// UI 里切过 preset 后，头不变而这会话**实际跑的是新 preset**（`0cd6755b`：头 `standard-128k`、
// 实际 `verify`）。所以本脚本回答的是"创建时默认值解析成了什么"，
// **不是**"这个会话现在挂的是什么" —— 后者读运行时产物：`session-tools.mjs`
// （`request/header` 的工具清单 + `system/message` 的 persona）。
//
// Read-only. Usage:  node session-preset-scan.mjs [--after <ISO-or-ms>]
//   Prints the preset distribution and every session created after the cutoff.

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
import { homedir } from 'node:os'

const root = join(homedir(), '.dsh', 'sessions')
const idx = process.argv.indexOf('--after')
const cutoff = idx >= 0 ? new Date(process.argv[idx + 1]).getTime() : null

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name === 'session.v4.jsonl.zstd') out.push(p)
  }
  return out
}

const files = walk(root)
const rows = []
let failed = 0
for (const f of files) {
  try {
    // Only the FIRST zstd frame is needed: the session header is its first line.
    const raw = zstdDecompressSync(readFileSync(f)).toString('utf8')
    const h = JSON.parse(raw.split(/\r?\n/)[0])
    rows.push({ t: h.createdAt, preset: h.agentPreset, id: h.id, cwd: h.cwd })
  } catch {
    failed++
  }
}
rows.sort((a, b) => b.t - a.t)

const local = (ms) => new Date(ms).toLocaleString('sv-SE')
console.log(`会话文件 ${files.length}  解析成功 ${rows.length}  失败 ${failed}`)
console.log('')
const dist = {}
for (const r of rows) dist[r.preset] = (dist[r.preset] ?? 0) + 1
console.log('preset 分布（按会话创建时记录）：')
for (const [k, v] of Object.entries(dist).sort((a, b) => b[1] - a[1])) console.log(`  ${String(k).padEnd(20)} ${v}`)

if (cutoff !== null && !Number.isNaN(cutoff)) {
  const after = rows.filter((r) => r.t > cutoff)
  console.log('')
  console.log(`分界线 ${local(cutoff)} 之后创建的会话 = ${after.length}`)
  for (const r of after.slice(0, 20)) console.log(`  ${local(r.t)}  preset=${String(r.preset).padEnd(16)} ${r.id}`)
  if (after.length === 0) {
    console.log('  ⚠️ 没有观测样本：这段时间内一个新会话都没建过，')
    console.log('     所以「新的默认值是否被运行中的实例采用」这件事尚未被验证。')
  }
}
