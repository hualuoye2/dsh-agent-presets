// 让 AGENTS.md 里的断言「可执行」：每条可测的断言都绑定到一次现场测量。
//
// 设计（三根支柱）
//   1. registry 只知道「怎么测」，不知道「应该是多少」——绝不在检查器里写死期望值，
//      否则检查器自己会随时间变陈旧，变成第二个需要被检查的东西。
//   2. 文档提供「声称值」：用锚点正则从 AGENTS.md 里把数字抠出来。
//   3. 比对并 FAIL：MATCH / DRIFT / NO-DOC，任一 DRIFT 即 exit 1。
//
// 为什么测量不在这个文件里做：本沙箱里 node 无法捕获子进程 stdout
// （execFileSync(git) -> EPERM，2026-10-06 复核）。所以：facts-collect.ps1 测量 →
// facts-actual.json → 这里比对与出报告（中文）。
//
// 边界：只有登记进 FACTS 的数字才"可执行"。刻意不登记的（被测一次、依赖网络/端口/
// 时间/GUI）在 NOT_WIRED 里点名，免得把 exit 0 读成「文档全对」。
//
// Usage:
//   powershell -NoProfile -ExecutionPolicy Bypass -File .agent-presets/facts-collect.ps1
//   node .agent-presets/facts-check.mjs [--doc <file>] [--list]

import { readFileSync } from 'node:fs'

const argOf = (name, dflt) => {
  const i = process.argv.indexOf(name)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt
}
const DOC = argOf('--doc', 'D:/deepseek/AGENTS.md')
const ACTUAL = 'D:/deepseek/_quarantine/facts-actual.json'
const read = (p) => readFileSync(p, 'utf8').replace(/^\uFEFF/, '')

// 选定规则（2026-10-06 实测后定）：只接「想断言、且只在相关变更时才变」的数字。
// 反例（本次实测）：入库总数与各目录文件数**任何提交都会连带改变**——把总数修成 487
// 之后，紧接着提交这个检查器自己就让它变成 489、`.agent-presets` 22 -> 24，
// 于是文档在几分钟内又陈旧了。这类计数只配当**带日期的快照 + 复核命令**，不配当断言，
// 否则只会训练人忽略 WARN。它们在下文 VOLATILE 里点名。
//
// fact = 键名（对应 facts-actual.json）；anchor 的第 1 个捕获组 = 文档声称的值
const FACTS = [
  { fact: 'skills',             note: '第五节：N 个 skill 的 SKILL.md', anchor: /(\d+)\s*个 skill 的/ },
  { fact: 'check_py',           note: '第六节：tools\\check_*.py（**共 N 个**）', anchor: /`tools\\check_\*\.py`（\*\*共\s*(\d+)\s*个\*\*）/ },
  { fact: 'check_py',           note: '第三节表格：需要 GUI（**N 个**渲染/界面回归）', anchor: /（\*\*(\d+)\s*个\*\*渲染\/界面回归/ },
  { fact: 'check_py',           note: '第六节表格：一键跑全部 N 个 check_*.py', anchor: /一键跑全部\s*(\d+)\s*个/ },
  { fact: 'ledger_desktop',     note: '第七节：我名下已登记 N 条', anchor: /名下的\s*\*\*(\d+)\s*条\*\*/ },
  { fact: 'pkgs_total',         note: '一点六节：下有 N 个包', anchor: /下有\s*\*\*(\d+)\s*个包\*\*/ },
  { fact: 'pkgs_dsh',           note: '一点六节：其中 N 个是 dsh-*', anchor: /其中\s*\*\*(\d+)\s*个是/ },
  { fact: 'desktop_plugins',    note: '一点五节：desktop 的 package.json 依赖 **共 N 个**', anchor: /`package\.json` 依赖\s*\*\*共\s*(\d+)\s*个\*\*/ },
  { fact: 'desktop_bundles',    note: '一点六节：desktop profile 只挂了 **N 个 bundle**', anchor: /`desktop` profile 只挂了\s*\*\*(\d+)\s*个 bundle\*\*/ },
  { fact: 'tools_py',           note: '第七节：`tools\\` 下 N 个 .py', anchor: /`tools\\` 下\s*(\d+)\s*个/ },
  { fact: 'tools_diag',         note: '第七节：N 个 diag_*', anchor: /(\d+)\s*个 `diag_\*`/ },
  { fact: 'pkgs_other',         note: '一点六节：另 N 个是 cordis*/cosmokit/...', anchor: /另\s*(\d+)\s*个是/ },
  { fact: 'dead_junctions',     note: '一点六节：其中 N 个的目标已经不存在', anchor: /其中\s*\*\*(\d+)\s*个的目标已经不存在/ },
]

// 刻意不接的**易变计数**（实测：修好后几分钟内又漂）。测量函数仍在 facts-collect.ps1
// 里，所以想复核随时能拿；只是文档不再被当成在"断言"它们。
const VOLATILE = [
  'total_files（入库文件总数）',
  'dir:*（各顶层目录的入库文件数，含 .agent-presets / tools / pgr-extraction …）',
]

// 刻意不接的（写在这里，是为了让 exit 0 不被读成「文档全对」）
const NOT_WIRED = [
  '端口/代理/HTTPS 读数（随会话状态变，须现场探针）',
  '一次性耗时与字节数（如 pip 3.4s / 11,050 字节）',
  'GUI 回归通过数（PASS 34 / FAIL 2 / TOTAL 36，需 PySide6 且数分钟）',
  '渲染/性能指标（如 76~86 ms）与环境相关的失败率',
  '「约 1/6」这类已被证伪、留作反面记录的旧读数',
]

if (process.argv.includes('--list')) {
  console.log(`registry: ${FACTS.length} 条可执行断言（测量由 facts-collect.ps1 提供）`)
  for (const f of FACTS) console.log(`  ${f.fact.padEnd(22)} <- ${f.note}`)
  console.log(`\n刻意不接的易变计数: ${VOLATILE.length} 类（测量仍在，只是不当断言）`)
  for (const n of VOLATILE) console.log(`  ~ ${n}`)
  console.log(`\n刻意不接的其他: ${NOT_WIRED.length} 类`)
  for (const n of NOT_WIRED) console.log(`  - ${n}`)
  process.exit(0)
}

let actual
try {
  actual = JSON.parse(read(ACTUAL))
} catch (e) {
  console.error(`读不到测量结果 ${ACTUAL} —— 先跑：`)
  console.error('  powershell -NoProfile -ExecutionPolicy Bypass -File .agent-presets/facts-collect.ps1')
  process.exit(2)
}

const doc = read(DOC)
console.log(`文档 = ${DOC}`)
console.log(`测量 = ${ACTUAL}（${Object.keys(actual).length} 项）\n`)

let drift = 0
let nodoc = 0
let match = 0
for (const { fact, note, anchor } of FACTS) {
  const m = anchor.exec(doc)
  const want = actual[fact]
  if (want === undefined) {
    console.log(`SKIP    ${fact.padEnd(22)} 测量里没有这一项`)
    continue
  }
  if (!m) {
    nodoc++
    console.log(`NO-DOC  ${fact.padEnd(22)} 锚点没匹配到（断言被改写或删除？） ${note}`)
    continue
  }
  const claimed = m[1] ?? m[2]
  if (String(want) === String(claimed)) {
    match++
    console.log(`MATCH   ${fact.padEnd(22)} ${want}`)
  } else {
    drift++
    console.log(`DRIFT   ${fact.padEnd(22)} 文档 ${claimed}  ≠  实测 ${want}    ${note}`)
    console.log(`        ${JSON.stringify(m[0].slice(0, 70))}`)
  }
}

console.log(`\nMATCH ${match} · DRIFT ${drift} · NO-DOC ${nodoc}`)

// Doc byte budget. Exceeding it makes the harness truncate the file's TAIL from the
// injected instructions -- silently, with only a one-line notice.
//
// 2026-10-07: the desktop default preset became `standard-128k` (maxBytes 131072), so the
// binding ceiling moved. MEASURED end-to-end, same 67,766-byte doc, same app, two presets:
//   standard      (65536)  -> delivered 65,244, notice "truncated AGENTS.md from 67766 to 65244"
//   standard-128k (131072) -> delivered 68,070, no notice
// Both arms reconcile against the same file, which fixes the harness wrapper at 304 bytes
// (earlier readings ranged 293-393). 131072 - 304 = 130,768; 130700 keeps a small margin.
//
// LEGACY: a preset is fixed in the session header at creation and is NOT re-resolved on
// resume, so sessions started before the switch still truncate at ~65,200. That is expected,
// not a defect -- reported, but it does not fail this check.
const BUDGET = 130700
const BUDGET_LEGACY = 65200
const bytes = actual.doc_bytes
let over = 0
if (typeof bytes === 'number') {
  over = bytes > BUDGET ? bytes - BUDGET : 0
  console.log(`预算    AGENTS.md ${bytes} / ${BUDGET} bytes` + (over ? `   ← 超 ${over}，会被静默截尾` : `   （剩 ${BUDGET - bytes}）`))
  if (bytes > BUDGET_LEGACY) console.log(`        另：仍超老会话(64 KB)的 ${BUDGET_LEGACY} —— 那些会话会截尾，属预期，不计 FAIL`)
  if (over) drift++   // an over-budget doc IS a defect: the reader stops seeing the tail
} else {
  console.log('预算    （测量里没有 doc_bytes，跳过）')
}

console.log(`注意：只有这 ${FACTS.length} 条是「可执行」的；另 ${VOLATILE.length} 类易变计数与 ${NOT_WIRED.length} 类其他数字刻意不接（--list 看清单）。`)
// NO-DOC GATES. A registered assertion that can no longer find its claim is either a
// rewritten doc or a broken anchor -- and both must be looked at. Letting NO-DOC pass
// is exactly "a green light over an unchecked set", which this workspace has already
// named as its most expensive recurring defect (measured 2026-10-06: an unescaped `*`
// silently took one assertion out of the checked set while the run still said PASS).
const failed = drift > 0 || nodoc > 0
const why = [drift ? `${drift} 项与实测不一致` : '', nodoc ? `${nodoc} 条断言找不到声称值（文档改写了？还是锚点写错了？）` : '']
  .filter(Boolean).join('；')
console.log(failed
  ? `RESULT: FAIL（${why}）`
  : 'RESULT: PASS（登记在案的可测断言全部与实测一致，且未超字节预算）')
process.exit(failed ? 1 : 0)
