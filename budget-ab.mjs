// Decisive A/B for the instruction byte budget.
//
// Claim under test: a preset whose `agent-instructions` row sets
// `maxBytes: 131072` delivers more of a large AGENTS.md than the shipped
// `maxBytes: 65536` does.
//
// Design (markers, not byte-counting, so the verdict is binary):
//   the probe dir has its own `.git`, so it is its OWN project root and the
//   instruction chain holds exactly one file: the 90,000-byte AGENTS.md.
//   90,000 sits between the two ceilings (~65,243 vs ~130,779 usable bytes).
//
//   PROBE-HEAD-MARKER-START  must be present in BOTH sessions
//                            -> control: the file really is in the chain, so an
//                               absent tail cannot be blamed on "file not loaded".
//   PROBE-TAIL-MARKER-END    must be ABSENT under `standard` (truncated)
//                            and PRESENT under `standard-128k` (whole).
//
// Both sessions are created on the SAME instance with the SAME cwd; the ONLY
// difference is the `agentPreset` argument, so nothing else can explain a delta.
//
// Wire shape taken from the program's own types, not guessed:
//   dsh-api-session-controller/lib/types/types.d.ts
//     SessionPageRequest = { address: SessionAddress; throughSeq: number; ... }
//       -> `address` AND `throughSeq` are both REQUIRED
//     SessionAddress (ordinary) = { kind: 'session'; sessionId }
//   `throughSeq` is an "inclusive log cut"; we do not hold a follow opening
//   frame, so we ask for a huge cut and let the "past cursor N" error hand us
//   the real one.

const BASE = 'http://127.0.0.1:19399'
const TOKEN = process.argv[2]
const PROBE_CWD = 'D:\\deepseek\\.agent-presets\\_budget-probe'
const HEAD = 'PROBE-HEAD-MARKER-START'
const TAIL = 'PROBE-TAIL-MARKER-END'

if (!TOKEN) {
  console.error('usage: node budget-ab.mjs <token>')
  process.exit(2)
}

let cookie = ''
let rpcId = 0

async function rpc(method, args) {
  const res = await fetch(`${BASE}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ type: 'client-request', rpcId: `ab-${++rpcId}`, method, payload: { args } }),
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
  // Unwrap the RPC envelope. Observed shapes, deepest last:
  //   { result: { ok: true, value: {...} } }   and   { ok: true, value: {...} }
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

// 1) token -> cookie
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

async function probe(preset) {
  const created = await rpc('session/create', { request: { agentPreset: preset, cwd: PROBE_CWD } })
  const sessionId = created?.sessionId
  if (!sessionId) throw new Error(`no sessionId: ${JSON.stringify(created).slice(0, 300)}`)

  await rpc('session/prompt', {
    request: {
      requestId: `req-${preset}-${Date.now()}`,
      sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: 'Reply with the single word OK.' }],
    },
  })

  // The instruction baseline rides the first request, so poll until it appears.
  let blob = ''
  const deadline = Date.now() + 75_000
  while (Date.now() < deadline) {
    await sleep(2000)
    blob = JSON.stringify(await fetchPage(sessionId))
    if (blob.includes(HEAD)) break
  }

  const budget = /Workspace instruction budget (\d+) bytes([^"\\]*)/.exec(blob)
  return {
    preset,
    sessionId,
    head: blob.includes(HEAD),
    tail: blob.includes(TAIL),
    headCount: blob.split(HEAD).length - 1,
    budgetMarker: budget ? `通知: budget ${budget[1]} bytes${budget[2]}` : '(无截断通知)',
    blobBytes: Buffer.byteLength(blob),
  }
}

const rows = []
for (const preset of ['standard', 'standard-128k']) {
  try {
    rows.push(await probe(preset))
  } catch (e) {
    rows.push({ preset, error: e.message })
  }
}

console.log('════════ 预算 A/B（同实例、同 cwd、只差 preset） ════════')
for (const r of rows) {
  if (r.error) {
    console.log(`  ${r.preset.padEnd(14)} ERROR: ${r.error}`)
    continue
  }
  console.log(`  ${r.preset.padEnd(14)} 头标记=${r.head ? 'YES' : 'NO '}  尾标记=${r.tail ? 'YES' : 'NO '}  头出现${r.headCount}次  ${r.budgetMarker}`)
}

console.log('')
console.log('════════ 判定 ════════')
const std = rows.find((r) => r.preset === 'standard')
const big = rows.find((r) => r.preset === 'standard-128k')
const checks = [
  ['对照：standard 收到了探测文件（头标记在）', std?.head === true],
  ['对照：standard-128k 收到了探测文件（头标记在）', big?.head === true],
  ['standard 装不下 90 KB（尾标记被截掉）', std?.tail === false],
  ['standard-128k 装得下 90 KB（尾标记完整）', big?.tail === true],
]
let bad = 0
for (const [label, ok] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) bad++
}
console.log('')
console.log(`RESULT: ${bad === 0 ? 'PASS' : `FAIL (${bad})`}`)
process.exit(bad === 0 ? 0 : 1)
