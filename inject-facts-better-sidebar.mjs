// 故障注入：验证 facts-check.mjs 里那两条**新增**断言（desktop_plugins / desktop_bundles）
// 真的会在文档说错时 FAIL。2026-10-07 随 dsh-better-sidebar 登记一并加入。
//
// 为什么要写脚本而不是手改：① PS 5.1 读无 BOM 的 .ps1 会把中文当 ANSI（见 AGENTS.md §3.5），
// 注入用的却全是中文串，所以编辑这一步交给 node；② 副本注入（--doc <copy>）不改动真文件。
//
// ⚠️ 每条注入都**断言自己真的改动了**（目标串必须恰好出现 1 次）。一条没落地的注入会让
// 检查器"看起来通过了测试"——这正是台账里 `auditor-trust` 的失败模式（第一次注入根本没生效，
// 审计却报"逐行相同"）。
import { readFileSync, writeFileSync } from 'node:fs'

const DOC = 'D:/deepseek/AGENTS.md'
const src = readFileSync(DOC, 'utf8')

const CASES = [
  ['_quarantine/inject-bundles.md', 'desktop_bundles 6 -> 5',
    '`desktop` profile 只挂了 **6 个 bundle**', '`desktop` profile 只挂了 **5 个 bundle**'],
  ['_quarantine/inject-plugins.md', 'desktop_plugins 4 -> 5',
    '`package.json` 依赖 **共 4 个**', '`package.json` 依赖 **共 5 个**'],
  ['_quarantine/inject-nodoc.md', 'desktop_bundles 锚点被打断（应报 NO-DOC 而非 MATCH）',
    '`desktop` profile 只挂了', '`desktop` profile 此前只挂了'],
]

let bad = 0
for (const [rel, label, from, to] of CASES) {
  const n = src.split(from).length - 1          // node 的计数，避开 PS Split 按单字符切的坑
  if (n !== 1) {
    console.log(`INJECT-FAIL ${label} —— 目标串出现 ${n} 次（应为 1），注入未落地`)
    bad++
    continue
  }
  const out = src.split(from).join(to)
  writeFileSync(`D:/deepseek/${rel}`, out)
  console.log(`INJECT-OK   ${label} -> ${rel}（长度 ${src.length} -> ${out.length}）`)
}
process.exit(bad ? 1 : 0)
