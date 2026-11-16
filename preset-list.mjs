// List the agent-preset roster from a running instance, marking the default.
//
// Why this exists: `dsh --profile desktop --dump-config` is REFUSED
// ("managed exclusively by the Electron application"), so the desktop profile's
// effective composition cannot be read from the CLI at all. Booting a throwaway
// WEB instance with `--patch <the desktop patch>` and asking the roster is the
// closest observable proxy — and it is the same loader, so the patch semantics
// under test are the real ones.
//
// Usage: node preset-list.mjs <token>

const BASE = 'http://127.0.0.1:19399'
const TOKEN = process.argv[2]
if (!TOKEN) {
  console.error('usage: node preset-list.mjs <token>')
  process.exit(2)
}

let cookie = ''
let rpcId = 0

async function rpc(method, args = {}) {
  const res = await fetch(`${BASE}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ type: 'client-request', rpcId: `pl-${++rpcId}`, method, payload: { args } }),
  })
  const sc = res.headers.getSetCookie?.() ?? []
  if (sc.length > 0) cookie = sc.map((c) => c.split(';')[0]).join('; ')
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
    if ('error' in node) throw new Error(`${method} -> ${JSON.stringify(node.error).slice(0, 300)}`)
    if ('ok' in node) {
      if (node.ok === false) throw new Error(`${method} -> ${JSON.stringify(node).slice(0, 300)}`)
      node = 'value' in node ? node.value : node
      break
    }
    if ('result' in node) { node = node.result; continue }
    break
  }
  return node
}

{
  const res = await fetch(`${BASE}/?token=${encodeURIComponent(TOKEN)}`, { redirect: 'manual' })
  cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
  if (!cookie) throw new Error('no auth cookie')
  await res.text()
}

const listed = await rpc('agentPresets/list')
const presets = Array.isArray(listed) ? listed : (listed?.presets ?? [])
const rows = presets.map((p) => ({
  id: p.id ?? p.preset?.id,
  default: p.isDefault === true || p.default === true,
  trust: p.trust,
  broken: p.broken,
  name: p.metadata?.name ?? p.name,
}))

console.log('════════ 实例上的 preset roster ════════')
for (const r of rows) {
  console.log(
    `  ${String(r.id).padEnd(16)} trust=${String(r.trust).padEnd(7)} default=${r.default ? 'YES' : 'no '} ${r.broken ? `BROKEN: ${r.broken}` : 'OK'}  ${r.name ?? ''}`,
  )
}
const d = rows.filter((r) => r.default).map((r) => r.id)
console.log('')
console.log(`默认 preset = ${d.length ? d.join(', ') : '(无)'}`)
const want = process.argv[3]
if (want) {
  const ok = d.length === 1 && d[0] === want
  console.log(`判定：默认应为 "${want}" -> ${ok ? 'PASS' : 'FAIL'}`)
  process.exit(ok ? 0 : 1)
}
