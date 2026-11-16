// Restore one line into AGENTS.md that the audit's `commands` extractor had captured.
//
// ONE-OFF, kept as a worked example (2026-10-07, round-2 compaction of AGENTS.md): the
// BACKUP/TARGET constants below point at that round's files. The reusable lesson is the
// METHOD -- take the byte-exact line from the pre-splice backup instead of retyping it, and
// assert both that the source line is unique and that the anchor matches exactly once.
//
// Why a script and not an edit: the audit compares the trimmed line VERBATIM
// (`^\s*(?:&\s|\$\w+\s*=|cmd \/c|node |powershell |pip |dsh )\S.*$`, then `.trim()`
// and strip `\s+#.*$`), so the padding between `NO` and the `←` comment is part of the
// identity. Retyping it by hand is a guess; reading it back from the pre-splice backup
// is byte-exact. (Note the extractor is also a false positive here: `dsh root WRITE = NO`
// is probe OUTPUT, not a command -- but the gate is the gate, so we keep the line.)
//
// Both anchors are quote-free on purpose: this file's full-width vs ASCII quotes are
// not reliably introspectable, so an anchor containing a quote cannot be trusted.
import { readFileSync, writeFileSync } from 'node:fs'

const BACKUP = 'D:/deepseek/_quarantine/agmd-before-round2.md'
const TARGET = 'D:/deepseek/AGENTS.md'

const probe = readFileSync(BACKUP, 'utf8')
  .split('\n')
  .filter((l) => l.startsWith('dsh root WRITE = NO'))
if (probe.length !== 1) throw new Error(`probe line occurrences = ${probe.length} (want 1)`)
const line = probe[0].replace(/\r$/, '')

let text = readFileSync(TARGET, 'utf8')
const before = Buffer.byteLength(text, 'utf8')

// 1) put the two-policy evidence back under the 四·补二 heading
const head = '### 四·补二：以上规则**只覆盖 `D:\\deepseek\\`**；DSH home 在工作区外\n\n'
if (text.split(head).length - 1 !== 1) throw new Error('heading anchor is not unique')
text = text.replace(
  head,
  head + '两态实测（`workspace-write` 下连 PowerShell 都被拒；`danger-full-access` 下可写）：\n\n```\n' + line + '\n```\n\n',
)

// 2) drop the now-redundant pointer to that same reading
const ptr = '（`workspace-write` 下连 PowerShell 都被拒，两态原始输出\n见 companion §8）'
if (text.split(ptr).length - 1 !== 1) throw new Error('pointer anchor is not unique')
text = text.replace(ptr, '')

writeFileSync(TARGET, text)
console.log('probe line = ' + JSON.stringify(line))
console.log(`bytes ${before} -> ${Buffer.byteLength(text, 'utf8')}`)
