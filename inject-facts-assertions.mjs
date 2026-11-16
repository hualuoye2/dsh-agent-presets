// 故障注入：把 AGENTS.md 里**每一条** facts-check 断言的声称值改坏一次，
// 验证它真的会 DRIFT 且 exit 1。用法：
//   node inject-facts-assertions.mjs           # 生成注入副本 + 打印比对命令
//   node inject-facts-assertions.mjs --check   # 跑 facts-check 并判定每例是否按预期失败
//
// 为什么要有这个文件：工作区 HANDOFF P2-1 的判据是"每新增一条断言，先把文档里那个数字
// 改掉 → 必须 DRIFT + exit 1；改回 → PASS"。只有"跑绿"不算验证。
//
// 两条设计上的必要性：
//   1. 注入走**副本**（facts-check --doc <copy>），真文件永不被改坏。
//   2. 每条注入都**断言自己真的改动了**（目标串恰好出现 1 次）。没落地的注入会让检查器
//      "看起来通过了测试"——正是台账 `auditor-trust` 的失败模式。
//
// 注意：node 在本沙箱**无法捕获子进程 stdout**（execFileSync → EPERM），
// 所以比对必须由调用方（PowerShell）跑，或者用 --check 让本脚本自己 spawn？
// 不行——所以 --check 用 **process.argv 递归调用自己** 的方式不可行；
// 实际做法：本脚本只负责**生成副本并自证注入落地**，facts-check 由外层逐个调用。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const DOC = 'D:/deepseek/AGENTS.md'
const OUT = 'D:/deepseek/_quarantine/facts-inject'
const src = readFileSync(DOC, 'utf8')

// [文件名, 说明, 原文, 改坏后]
const CASES = [
  ['bundles.md',   'desktop_bundles 6 -> 5',  '`desktop` profile 只挂了 **6 个 bundle**', '`desktop` profile 只挂了 **5 个 bundle**'],
  ['plugins.md',   'desktop_plugins 4 -> 5',  '`package.json` 依赖 **共 4 个**', '`package.json` 依赖 **共 5 个**'],
  ['toolspy.md',   'tools_py 88 -> 87',       '`tools\\` 下 88 个 `.py`', '`tools\\` 下 87 个 `.py`'],
  ['diagpy.md',    'tools_diag 21 -> 20',     '21 个 `diag_*`', '20 个 `diag_*`'],
  ['pkgsother.md', 'pkgs_other 11 -> 12',     '另 11 个是', '另 12 个是'],
  ['deadjunc.md',  'dead_junctions 4 -> 5',   '其中 **4 个的目标已经不存在**', '其中 **5 个的目标已经不存在**'],
  ['skills.md',    'skills 7 -> 6',           '8(=7 个 skill 的 `SKILL.md`', '8(=6 个 skill 的 `SKILL.md`'],
  ['ledger.md',    'ledger_desktop 31 -> 30', '名下的 **31 条**已按此登记', '名下的 **30 条**已按此登记'],
]

mkdirSync(OUT, { recursive: true })
let bad = 0
for (const [file, label, from, to] of CASES) {
  const n = src.split(from).length - 1          // node 的计数，避开 PS Split 按单字符切的坑
  if (n !== 1) {
    console.log(`INJECT-FAIL ${label} —— 目标串出现 ${n} 次（应为 1），注入未落地`)
    bad++
    continue
  }
  writeFileSync(`${OUT}/${file}`, src.split(from).join(to))
  console.log(`INJECT-OK   ${label} -> _quarantine/facts-inject/${file}`)
}
console.log(`\n注入副本 ${CASES.length - bad}/${CASES.length} 个已生成于 ${OUT}`)
console.log('逐个跑：node .agent-presets/facts-check.mjs --doc _quarantine/facts-inject/<file>')
console.log('每一例都必须打印 DRIFT（或 NO-DOC）并 exit 1。')
process.exit(bad ? 1 : 0)
