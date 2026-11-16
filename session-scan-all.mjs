// List every session on disk (BOTH v3 and v4 files) with the preset it recorded.
//
// Supersedes session-preset-scan.mjs, which filtered on `session.v4.jsonl.zstd` and
// therefore MISSED v3-format sessions — that blind spot cost a round trip. Session
// files are named `session.v<N>.jsonl.zstd`; glob the version, do not hardcode it.
//
// Read-only. Usage: node session-scan-all.mjs [--after <ISO>]

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
import { homedir } from 'node:os'

const root = join(homedir(), '.dsh', 'sessions')
const idx = process.argv.indexOf('--after')
const cutoff = idx >= 0 ? new Date(process.argv[idx + 1]).getTime() : null

const FILE_RE = /^session\.v(\d+)\.jsonl\.zstd$/
const rows = []
let unreadable = 0

function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) { walk(p); continue }
    const m = FILE_RE.exec(e.name)
    if (!m) continue
    try {
      const raw = zstdDecompressSync(readFileSync(p)).toString('utf8')
      const h = JSON.parse(raw.split(/\r?\n/)[0])
      rows.push({
        version: Number(m[1]),
        id: h.id ?? e.name,
        created: h.createdAt,
        preset: h.agentPreset,
        cwd: h.cwd,
        mtime: statSync(p).mtimeMs,
        bytes: statSync(p).size,
      })
    } catch { unreadable++ }
  }
}
walk(root)
rows.sort((a, b) => b.created - a.created)

const local = (ms) => new Date(ms).toLocaleString('sv-SE')
console.log(`会话文件 ${rows.length}（v3 与 v4 都算）  无法解析 ${unreadable}`)
const dist = {}
for (const r of rows) dist[r.preset] = (dist[r.preset] ?? 0) + 1
console.log('按创建时的 preset 分布：')
for (const [k, v] of Object.entries(dist).sort((a, b) => b[1] - a[1])) console.log(`  ${String(k).padEnd(18)} ${v}`)
console.log('')

if (cutoff !== null && !Number.isNaN(cutoff)) {
  const after = rows.filter((r) => r.created > cutoff)
  console.log(`分界线 ${local(cutoff)} 之后创建 = ${after.length}`)
  for (const r of after) {
    console.log(`  ⭐ v${r.version}  ${local(r.created)}  preset=${String(r.preset).padEnd(16)} ${r.id}`)
  }
  if (after.length === 0) console.log('  （仍然没有观测样本）')
  console.log('')
}

console.log('按创建时间最新的 6 个：')
for (const r of rows.slice(0, 6)) {
  console.log(`  v${r.version}  created=${local(r.created)}  preset=${String(r.preset).padEnd(16)} ${String(r.bytes).padStart(9)}B  ${r.id}`)
}
