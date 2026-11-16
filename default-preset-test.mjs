// Does the composed `agent-presets` config `default:` actually decide the preset of a
// session created WITHOUT an explicit agentPreset?
//
// The previous A/B always passed `agentPreset` explicitly, so it only ever proved that
// the preset itself works — never that `default` is honoured. This closes that hole.
//
// Usage: node default-preset-test.mjs <token> [port]

const PORT = Number(process.argv[3] ?? 19399)
const TOKEN = process.argv[2]
if (!TOKEN) throw new Error('usage: node default-preset-test.mjs <token> [port]')
const BASE = `http://127.0.0.1:${PORT}`
const CWD = 'D:\\deepseek'

let rpcId = 0
let cookie = ''

async function rpc(method, args) {
  const res = await fetch(`${BASE}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ type: 'client-request', rpcId: `dp-${++rpcId}`, method, payload: { args } }),
  })
  const text = await res.text()
  let node
  try { node = JSON.parse(text) } catch { throw new Error(`${method} -> HTTP ${res.status}: ${text.slice(0, 200)}`) }
  for (let i = 0; i < 6; i++) {
    if (node && typeof node === 'object' && 'ok' in node && 'value' in node) { node = node.value; continue }
    if (node && typeof node === 'object' && 'result' in node) { node = node.result; continue }
    break
  }
  if (node && typeof node === 'object' && node.ok === false) throw new Error(`${method} -> ${JSON.stringify(node).slice(0, 300)}`)
  return node
}

const auth = await fetch(`${BASE}/?token=${encodeURIComponent(TOKEN)}`, { redirect: 'manual' })
cookie = (auth.headers.getSetCookie?.() ?? [auth.headers.get('set-cookie')]).filter(Boolean).map((c) => c.split(';')[0]).join('; ')
console.log(`  认证 HTTP ${auth.status}  cookie=${cookie ? 'OK' : '❌ 无'}`)

// 1) What does the live roster say is the default?
try {
  const list = await rpc('agentPresets/list', {})
  const items = list?.presets ?? list?.items ?? list
  if (Array.isArray(items)) {
    console.log('  live roster:')
    for (const p of items) {
      const id = p.id ?? p.preset ?? p.name
      const def = p.isDefault === true || p.default === true ? '  <-- DEFAULT' : ''
      console.log(`    ${String(id).padEnd(22)} trust=${p.trust ?? '?'}${def}`)
    }
  } else {
    console.log('  agentPresets/list -> ' + JSON.stringify(list).slice(0, 300))
  }
} catch (e) {
  console.log('  agentPresets/list 失败: ' + e.message)
}

// 2) Session with NO agentPreset -> the server default decides.
const bare = await rpc('session/create', { request: { cwd: CWD } })
console.log(`\n  ① 不传 agentPreset  ->  preset = ${bare.agentPreset}`)

// 3) Control: explicit preset, proves the read-out is sensitive.
const ctrl = await rpc('session/create', { request: { agentPreset: 'standard-128k', cwd: CWD } })
console.log(`  ② 显式 standard-128k  ->  preset = ${ctrl.agentPreset}   (对照)`)

console.log('')
console.log('========== 结论 ==========')
if (bare.agentPreset === 'standard-128k') {
  console.log('  ✅ 合成后的 default 会被采用 ⇒ 故障在客户端（GUI 自己传了 preset）')
} else {
  console.log(`  ❌ default 未被采用（拿到 "${bare.agentPreset}"，对照 "${ctrl.agentPreset}" 说明读数有效）`)
  console.log('     ⇒ 故障在服务端：`agent-presets` 行的 config.default 不是决定项')
}
