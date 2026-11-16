// Does the REAL D:\deepseek\AGENTS.md still fit the 64 KB preset arm?
//
// Why this exists: the entire point of compacting AGENTS.md below ~65,200 bytes is that OLD
// sessions (preset `standard`, maxBytes 65536) stop silently truncating it. Byte arithmetic
// says yes; only a REAL mounted session says so for sure. This script creates that session
// against a temporary instance, so the user's live GUI (ephemeral port since DSH 0.2.1-rc.2,
// formerly 19387) is never touched.
//
// 🚨 Run the control FIRST: `.agent-presets/budget-ab.mjs` points a 90,000-byte probe
// AGENTS.md at the same instance and asserts that `standard` DOES truncate it (tail marker
// absent) while `standard-128k` does not. A prober that cannot detect truncation proves
// nothing about the absence of truncation. That is the fault injection for this measurement.
//
// The probe fixture lives at `.agent-presets/_budget-probe/` (an 88,046-byte AGENTS.md plus its
// own `.git`, so it is its own project root). It is .gitignore'd on purpose: it is a regenerable
// measuring fixture, not material. MEASURED 2026-10-07 with it: `standard` ->
// "truncated AGENTS.md from 88046 to 65143 bytes" and the tail marker absent;
// `standard-128k` -> tail marker present, no notice. Recreate it with:
//   $p='D:\deepseek\.agent-presets\_budget-probe'; New-Item -ItemType Directory -Force $p|Out-Null
//   & 'D:\deepseek\.tools\MinGit\cmd\git.exe' -C $p init -q
//   $line=('x'*199)+"`n"; [IO.File]::WriteAllText("$p\AGENTS.md","PROBE-HEAD-MARKER-START`n"+($line*440)+"PROBE-TAIL-MARKER-END`n",(New-Object Text.UTF8Encoding($false)))
//
// Usage: node check-64k-arm.mjs <token> [--port 19399] [--preset standard] [--cwd D:\deepseek]
import { readFileSync, statSync } from 'node:fs'

const argv = process.argv.slice(2)
const TOKEN = argv.find((a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1]?.startsWith('--') !== true)
const opt = (name, dflt) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt
}
const PORT = opt('port', '19399')
const PRESET = opt('preset', 'standard')
const CWD = opt('cwd', 'D:\\deepseek')
const BASE = `http://127.0.0.1:${PORT}`

if (!TOKEN) {
  console.error('usage: node check-64k-arm.mjs <token> [--port 19399] [--preset standard] [--cwd D:\\deepseek]')
  process.exit(2)
}

// ASCII needles only. The skill warns that CJK through some HTTP clients gets double-decoded,
// so the verdict must not depend on Chinese text surviving the round trip.
//   HEAD: lives in §〇, comfortably before any conceivable cut point.
//   TAIL: lives in §九 (the LAST section) -- present only if the whole file was delivered.
const HEAD_NEEDLE = 'capmap.ps1 -ProbeSelfTest'
const TAIL_NEEDLE = 'RIFT_SCALE'
// The truncation notice is line-anchored and does NOT appear in the document's own prose
// (AGENTS.md quotes `truncated AGENTS.md from ... to ...`, but never this line-start form).
const NOTICE = 'Workspace instruction budget'

let cookie = ''
let rpcId = 0
async function rpc(method, args) {
  const res = await fetch(`${BASE}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ type: 'client-request', rpcId: `c64-${++rpcId}`, method, payload: { args } }),
  })
  const setCookie = res.headers.getSetCookie?.() ?? []
  if (setCookie.length > 0) cookie = setCookie.map((c) => c.split(';')[0]).join('; ')
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`${method} -> HTTP ${res.status}, non-JSON: ${text.slice(0, 300)}`)
  }
  let node = json
  for (let i = 0; i < 5; i++) {
    if (node === null || typeof node !== 'object') break
    if ('error' in node) throw new Error(`${method} -> ${JSON.stringify(node.error).slice(0, 400)}`)
    if ('ok' in node) {
      if (node.ok === false) throw new Error(`${method} -> ${JSON.stringify(node).slice(0, 400)}`)
      node = 'value' in node ? node.value : node
      break
    }
    if ('result' in node) { node = node.result; continue }
    break
  }
  return node
}

// token -> cookie
{
  const res = await fetch(`${BASE}/?token=${encodeURIComponent(TOKEN)}`, { redirect: 'manual' })
  cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
  if (!cookie) throw new Error('no auth cookie from token exchange')
  await res.text()
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function fetchPage(sessionId) {
  const at = (n) => rpc('session/page', { request: { address: { kind: 'session', sessionId }, throughSeq: n } })
  try {
    return await at(1_000_000_000)
  } catch (e) {
    const m = /past cursor (\d+)/.exec(String(e.message))
    if (!m) throw e
    return await at(Number(m[1]))
  }
}

const filePath = `${CWD}\\AGENTS.md`
const st = statSync(filePath)
const diskBytes = st.size
const mtime = st.mtime.toISOString()

const created = await rpc('session/create', { request: { agentPreset: PRESET, cwd: CWD } })
const sessionId = created?.sessionId
if (!sessionId) throw new Error(`no sessionId: ${JSON.stringify(created).slice(0, 300)}`)

await rpc('session/prompt', {
  request: {
    requestId: `req-64k-${Date.now()}`,
    sessionId,
    mode: 'queue',
    content: [{ type: 'text', text: 'Reply with the single word OK.' }],
  },
})

let blob = ''
const deadline = Date.now() + 90_000
while (Date.now() < deadline) {
  await sleep(2000)
  blob = JSON.stringify(await fetchPage(sessionId))
  if (blob.includes(HEAD_NEEDLE) || blob.includes(NOTICE)) break
}

const headHits = blob.split(HEAD_NEEDLE).length - 1
const tailHits = blob.split(TAIL_NEEDLE).length - 1
const noticeHits = blob.split(NOTICE).length - 1
const noticeText = /Workspace instruction budget[^"\\]{0,140}/.exec(blob)?.[0] ?? '(无)'

console.log('════════ 真实 AGENTS.md × 64 KB 臂（临时实例，用户 GUI 未参与） ════════')
console.log(`  磁盘文件        = ${filePath}  ${diskBytes} 字节  mtime=${mtime}`)
console.log(`  预算上限(算术)  = 65536 − 304 框架开销 = 65232 字节`)
console.log(`  会话 preset(头) = ${PRESET}`)
console.log(`  会话 id         = ${sessionId}`)
console.log(`  头针 ${HEAD_NEEDLE} 出现 ${headHits} 次`)
console.log(`  尾针 ${TAIL_NEEDLE}（§九，最后一节）出现 ${tailHits} 次`)
console.log(`  截断通知        = ${noticeHits} 次   ${noticeText}`)
console.log('')

const checks = [
  ['会话真的载入了这份指令（头针在）', diskBytes <= 65232 ? headHits > 0 : true],
  ['没有截断通知（line-anchored）', noticeHits === 0],
  ['尾部最后一节也送达了（尾针在）⇒ 全文完整', tailHits > 0],
]
let bad = 0
for (const [label, ok] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) bad++
}
console.log('')
console.log(`RESULT: ${bad === 0 ? 'PASS（64 KB 臂现在能收到完整 AGENTS.md）' : `FAIL (${bad})`}`)
console.log('提示：字节级复核用 skill 指定的唯一可信量具：')
console.log(`  node .agent-presets/session-instructions.mjs "C:\\Users\\常绚\\.dsh\\sessions\\--D-deepseek--\\${sessionId}\\session.v4.jsonl.zstd"`)
process.exit(bad === 0 ? 0 : 1)
