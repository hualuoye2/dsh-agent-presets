// Write a VERIFICATION HANDOFF: the claim + how to reproduce + the standing orders, as one
// file, so an author agent can hand a claim to a `verify` session in one step.
//
// Why a generator and not just a convention: the highest-cost failure in this workspace is
// "treating my own wrong criterion as a defect in the artifact" (11 recorded instances).
// The handoff is exactly where a wrong criterion leaks into an otherwise independent check —
// if the author hands over "the command I used", a verifier may RE-RUN that wrong instrument
// and stamp the result as independent confirmation, which is worse than no verification.
//
// So the format forces two things the author would otherwise skip:
//   1. the claim must be a single falsifiable sentence, and
//   2. the author must state whether they TRUST their instrument. `--uncertain` omits the
//      command on purpose: "I do not trust my instrument yet" is the moment you most need
//      independent eyes, and it has to be a legal thing to hand over.
//
// Output goes to `_quarantine/verify-handoffs/`, which is inside the workspace (so any agent
// can read it) and outside version control (a handoff is a run product, not a deliverable).
//
// Usage:
//   node make-verify-handoff.mjs --claim "一句话可证伪的声明" [--artifact <路径>]... \
//        [--command "我跑过的命令"] [--numbers "我得到的原始数字"] [--uncertain] [--from <谁>]

import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const argv = process.argv.slice(2)
if (!argv.length) throw new Error('usage: node make-verify-handoff.mjs --claim "..." [--artifact <路径>]... [--command "..."] [--numbers "..."] [--uncertain] [--from <谁>]')

const opts = { artifacts: [], claims: [] }
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  const next = () => {
    const v = argv[++i]
    if (v === undefined) throw new Error(`${a} needs a value`)
    return v
  }
  if (a === '--claim') opts.claims.push(next())
  else if (a === '--artifact') opts.artifacts.push(next())
  else if (a === '--command') opts.command = next()
  else if (a === '--numbers') opts.numbers = next()
  else if (a === '--from') opts.from = next()
  else if (a === '--uncertain') opts.uncertain = true
  else throw new Error(`unknown option ${a}`)
}

if (!opts.claims.length) throw new Error('--claim is required at least once: the claim IS the handoff')
if (!opts.artifacts.length) throw new Error('--artifact is required at least once (what is the artifact under test?)')
if (opts.uncertain && (opts.command || opts.numbers)) throw new Error('--uncertain means "do not trust my instrument" — drop --command/--numbers, keep only the paths')
if (!opts.uncertain && !opts.command) throw new Error('give --command, or say --uncertain if you do not trust your instrument')

// Repeatable on purpose: an A/B control pair (one claim you believe true, one you know is
// false) is the only way to tell a verifier from a parrot — the workspace's own discipline.
const claims = opts.claims.map((c) => c.trim().replace(/\s+/g, ' '))
for (const c of claims) if (c.length < 8) throw new Error(`claim too short to be falsifiable: ${JSON.stringify(c)}`)
const claim = claims[0]

const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
const slug = claim.replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 40).replace(/^-|-$/g, '') || 'claim'
const dir = 'D:\\deepseek\\_quarantine\\verify-handoffs'
mkdirSync(dir, { recursive: true })
const out = join(dir, `${stamp}-${slug}.md`)

const repro = opts.uncertain
  ? [
      '- 产物路径：',
      ...opts.artifacts.map((p) => `  - ${p}`),
      '',
      '- ⚠️ **我故意不给命令、也不给读数。** 两种原因都可能：**我不确定我的量具**；',
      '  或者**我不想用我的数字锚住你**（知道预期答案会让人去"确认"而不是去"验证"）。',
      '  请不要问我"你是怎么测的" —— **自己从头造量具、自己去读原始产物**。',
      '  你需要的唯一输入就是上面的产物路径。',
    ].join('\n')
  : [
      '- 产物路径：',
      ...opts.artifacts.map((p) => `  - ${p}`),
      '',
      `- 我用的命令：\`${opts.command}\``,
      opts.numbers ? `- 我得到的原始读数：${opts.numbers}` : '- 我得到的原始读数：（未给）',
      '',
      '  （以上**仅供对照，不要复用我的命令** —— 我的量具可能本身就是错的。）',
    ].join('\n')

const body = `# 验证交接包

> 这是**作者**写给**验证者**的交接。你现在在验证者席位上：你没有写这个产物，也不要假设它对。
> 你的任务是判定下面的**声明**是真是假（**可能不止一条，彼此独立**）—— 不是让它成真，也不是把它改好。
> **发现缺陷并报告 = 成功；拿不出命令和原始数字的"通过" = 你自己的失败。**
> 本工作区最贵的病是"把自己的判据错误当成被测对象的问题"（已记 11 次），所以：
> **先怀疑你的量具，再怀疑产物。**

来自：${opts.from ?? '(未注明)'}   生成时间：${stamp}

## 要判定的声明

${claims.length === 1 ? `> ${claims[0]}` : claims.map((c, i) => `- **声明 ${i + 1}**：${c}`).join('\n')}

## 怎么复现

${repro}

## 要求

1. **自己跑一遍，用你自己的命令**，不要复用上面的（若有）。
2. 每条判断都要带：**命令原文 + 它打印的原始数字/行/路径**。
3. **在信任何一个检查器之前，先给它注入一个它必须抓到的故障，并确认注入真的生效。**
   注入没生效会让坏检查器显示为绿色 —— 这在本工作区真实发生过。
4. 读**结论行**，不要数 FAIL/ERROR 关键词：通过的运行里也可能出现这些词。
5. 性能/计时断言**串行**跑（本机并发负载下实测延迟翻倍，制造过假失败）。
6. **不要委派**给别人：你是最后一站。（在 \`verify\` 会话里你根本没有那些工具 —— 这是设计。）
7. **不要修产物**，只在临时位置写；把它原样留在你找到它的状态。
8. 用中文回答，最后**按序号逐条**给明确结论：**声明 N = 真 / 假 / 无法判定（缺什么）**。

## 本工作区已知的量具陷阱（先逐条自问，见 skill \`verify-by-subagent\` 的清单）

关键词不是结论 · 检查器要对着**行/子树**而不是全文 · 历史记录不与当前磁盘比 ·
计数用两个能互相印证的引擎 · 自相矛盾的读数当场作废 · 别信"配置在 = 生效"。

---

*作者：把这份文件路径发给用户，让他在**空白会话**里把预设切成 \`verify\`，然后把下面这行粘进去：*

\`\`\`
读 ${out} 并执行（你是验证者，不要委派）
\`\`\`
`

writeFileSync(out, body, 'utf8')
console.log(`HANDOFF = ${out}`)
console.log(`字节    = ${Buffer.byteLength(body, 'utf8')}`)
console.log('')
console.log('把它交给用户，粘进一个 verify 会话：')
console.log(`  读 ${out} 并执行（你是验证者，不要委派）`)
