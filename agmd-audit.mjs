// Audit AGENTS.md for a compaction: per-section byte cost + a canonical fact list.
//
// Why: "compress" and "silently drop a rule" look identical in a diff summary.
// This snapshots what the file ASSERTS — ledger markers, measured numbers, paths,
// commands, skill names, headings, warning markers — so that after compacting we
// can print exactly which facts disappeared and justify each one.
//
// THREE LAYERS (2026-10-06). The first is the original design; the other two were
// added after MEASURING that the first one cannot do what people assumed:
//   L1  literal presence  — every baseline token must still appear SOMEWHERE.
//       Blind to a fact changing its referent: swapping `check_four_features`
//       28/31 with `check_three_features` 20/23, and rewriting the suite summary
//       to `PASS 36 / FAIL 0`, still reports 84/84 PASS (measured, exit 0).
//       Its verdict also depends on INCIDENTAL REPETITION: 23 -> 24 passed
//       (23 occurs 7 other times) while 24 -> 25 FAILED (`- 24`; 24 occurred once).
//   L2  section binding   — a token must still appear in one of its original `##`
//       sections. Catches cross-section migration; robust to rewording.
//   L3  line binding      — the digit-masked LINE that carried the numbers must still
//       exist and still carry them. Catches swap / inversion inside a line. Split by
//       reason, because precision differs sharply (measured): "line still there but its
//       numbers moved" is a strong hint; "line was reworded" is usually just an edit,
//       so it is counted but not listed. Still line-scoped: moving a number to another
//       line IN THE SAME SECTION is invisible to every layer.
//
// FOURTH LAYER — L4 anchor binding (2026-10-08), fixing the L3 blind area:
//   REPRODUCED (measured, before the fix): moving a number from one line to another
//   line IN THE SAME SECTION (both lines kept, file-wide digit set unchanged) gave
//   `L1 113/113 保留`, `L2 token 迁出原小节: 0`, `L3 强信号: 0` and `RESULT: PASS`
//   even under `--strict` (exit 0). L1/L2/L3 are all LINE-scoped, so any move that
//   keeps both lines alive is structurally invisible to them.
//   L4  anchor binding   — bind each number to the INLINE ANCHOR nearest to it
//       (`code span`, **bold label**, 【…】, 「…」, a bare path ending in an
//       extension) instead of to the whole line. A token that was next to anchor A
//       and is now only next to anchor B is reported, even though A and B are on
//       different lines of the same `##` section.
//       Segmentation keeps the anchor as the key, so pure rewording elsewhere on the
//       line does not create a hit. Measured false-positive rate on legal rewrites:
//       see the L4_GATE comment below — the layer ships DISABLED as a gate unless
//       that measurement is 0.
//       A baseline without `detectorVersion` (i.e. shot by the pre-L4 tool) makes
//       L4 SKIP loudly instead of reporting hits: "the instrument changed" and
//       "the content changed" are indistinguishable, so a stale baseline must not
//       be compared with the new layer (docMarker audit-instrument-version).
//
// So: PASS means "no literal fact disappeared, and (unless the baseline is old)
// nothing moved out of its section". It does NOT mean the assertions are true.
// See AGENTS.md section 7 item 0, docMarker audit-pass-not-fact-truth.
//
// Usage:
//   node agmd-audit.mjs sections [file]
//   node agmd-audit.mjs facts    [file]        # human-readable
//   node agmd-audit.mjs snapshot [file] <out>  # JSON baseline for later compare
//   node agmd-audit.mjs compare  <baseline.json> [file] [--strict] [--verbose] [--l4-strict]
//       --strict     turns the L2/L3 strong advisories into a gate (default: report-only)
//       --l4-strict  also gates on L4 (default: L4 is report-only — see L4_GATE)
//       --verbose    also lists the L3/L4 weak (reworded-segment) signals

import { readFileSync, writeFileSync } from 'node:fs'

const DEFAULT_FILE = 'D:/deepseek/AGENTS.md'
// Bump when the SET OF DETECTED FACTS changes. compare() refuses to run L4 against a
// baseline shot by a different version: "the instrument changed" and "the content
// changed" are indistinguishable, and treating the former as the latter is exactly
// how the two measured false positives (3 + 6 items) happened
// (docMarker audit-instrument-version).
const DETECTOR_VERSION = 4
// ── L4 gate decision (evidence, not taste) ────────────────────────────────────
// MEASURED 2026-10-08 against 9 deterministic legal rewrites of the real AGENTS.md
// (same facts, only wording / line breaks / punctuation / list markers / trailing
// whitespace changed; each variant asserted to leave the file's digit set identical):
//     L4 strong signals on legal rewrites = 0 / 9     ->  gate enabled
//     (for contrast, the two earlier drafts of this layer scored 129/9 and 58/9 —
//      they were reporting "this paragraph was reformatted" as "this number moved")
// and the layer does fire on the real thing: moving **510** from one bold label to a
// bold label on another line of the same section gives L1 113/113 + L2 0 + L3 0 +
// L4 1..2, exit 1. Fixtures and the measurement harness: _quarantine/agmd-l3/.
// If a future measurement shows a legal rewrite being flagged, flip this to false and
// record the number HERE instead of loosening the rule.
const L4_GATE = true
const mode = process.argv[2]
const file = process.argv[3] ?? DEFAULT_FILE

const read = (p) => readFileSync(p, 'utf8').replace(/^\uFEFF/, '')
const bytes = (s) => Buffer.byteLength(s, 'utf8')

// ── L4: inline anchors ────────────────────────────────────────────────────────
// The unit of binding is (anchor, its contiguous neighbourhood), not the line.
// `\b\d[\d,_]*\b` is the same token regex L1 uses, so the two layers agree on what
// a "number" is; only the CONTAINER differs (line vs anchor neighbourhood).
const TOKEN_RE = /\b\d[\d,_]*\b/g
const PLAIN_ANCHOR = '(整行)'
const maskDigits = (s) => s.replace(TOKEN_RE, '#')
const norm = (s) => s.replace(/\s+/g, ' ').trim()
const trimPunct = (s) => norm(s.replace(/^[\s>*\-—|:：,，。;；、)+）】」』"']+/, '')
  .replace(/[\s>*\-—|:：,，。;；、(+（【「『"']+$/, ''))

// An anchor is whatever a fact can be "attached to" inside one line. Order only
// matters for the fallback when two anchors overlap: the leftmost wins (it is the
// one a reader sees first, and therefore the one a number binds to).
// `kind` is carried through because only some anchor kinds are trustworthy enough to
// gate on — see L4_LABEL_KINDS.
const ANCHOR_RES = [
  [/`([^`\n]+)`/g, 'code'],              // `code span` — the file's dominant anchor
  [/\*\*([^*\n]+)\*\*/g, 'bold'],        // **bold label** — the one L4 gates on
  [/【([^】\n]+)】/g, 'cjk-bracket'],     // 【Chinese bracket】
  [/「([^」\n]+)」/g, 'cjk-quote'],       // 「Chinese quote」
  [/(?:[A-Za-z]:\\|\.{0,2}\\)[^\s`|)\]】，。;；、]*\.[A-Za-z0-9]{1,5}\b/g, 'path'], // bare path
]

// Which anchor kinds count as a STABLE LABEL for L4. Bold is the one that survives
// every legal rewrite in the fixture set, and it is the kind this file actually uses
// to label a number (`**PASS 34 / FAIL 2 / TOTAL 36**`). Code spans are deliberately
// NOT used here: pairing backticks by regex mis-pairs them whenever a line contains an
// escaped backtick (`\`netstat\``) or an odd number of them, which manufactures
// phantom labels with garbage names — measured, that alone produced false positives on
// the spacing and synonym rewrites (`10_000` unter a label built out of half of the
// next code span). Code spans still take part in SEGMENTATION and in the L1/L2/L3
// layers; this filter only governs what may act as a gate.
const L4_LABEL_KINDS = new Set(['bold'])

function lineAnchors(line) {
  const spans = []
  for (const [re, kind] of ANCHOR_RES) {
    re.lastIndex = 0
    for (const m of line.matchAll(re)) {
      const text = m[1] ?? m[0]
      spans.push({ start: m.index, end: m.index + m[0].length, text, kind })
    }
  }
  // Drop spans fully contained in an earlier (leftmost, longer) span, then sort and
  // drop overlaps so each character belongs to at most one anchor.
  spans.sort((a, b) => a.start - b.start || b.end - a.end)
  const kept = []
  for (const s of spans) {
    if (kept.some((k) => s.start < k.end)) continue
    if (!norm(s.text)) continue
    kept.push(s)
  }
  return kept
}

// Split one line into anchor-keyed segments. A labelled line yields alternating
// pieces starting at each anchor and running to the next one; an unlabelled line
// yields ONE segment covering the whole line, which is exactly L3's own granularity
// and therefore a deliberate no-regression floor.
//
// Every segment carries an index that is counted PER KIND (`a0`, `a1`, … for anchors,
// `p0`, `p1`, … for the label-less stretches). Keying by index instead of by text is
// what makes the layer work at all: an earlier version keyed a label-less stretch by
// the numbers inside it, so the stretch that carried `… 478；复核 …` was literally
// named `510` — and when that number left, the checker announced that "the two
// neighbouring numbers had left anchor 510" and then, once the naming was tightened,
// announced nothing. Position keys survive both the number leaving and the prose
// being reworded, which is why the rule can be stated once and hold.
function anchorSegments(line, lineNo) {
  const kept = lineAnchors(line)
  const digitsOnLine = (line.match(TOKEN_RE) ?? []).length
  if (!kept.length) {
    if (!digitsOnLine) return []
    return [{
      idx: 'whole',
      kind: 'line',
      name: PLAIN_ANCHOR,
      seg: trimPunct(maskDigits(line)).slice(0, 96),
      tokens: [...new Set(line.match(TOKEN_RE) ?? [])].sort(),
      strongEligible: true,
    }]
  }
  const segs = kept.map((a, i) => {
    const stop = i + 1 < kept.length ? kept[i + 1].start : line.length
    const raw = line.slice(a.start, stop)
    return {
      idx: `a${i}`,
      kind: a.kind,
      // 128, not the 48 an earlier draft used: a label truncated mid-word makes two
      // labels that differ only by a reformatting compare UNEQUAL, which is itself a
      // false-positive generator (measured: `10_000` left a label whose shape ended
      // `…staleGraceMs` and arrived at one ending `…staleGraceM`).
      name: trimPunct(a.text).slice(0, 128),
      seg: trimPunct(maskDigits(raw)).slice(0, 96),
      tokens: [...new Set(raw.match(TOKEN_RE) ?? [])].sort(),
      // If a segment's only digits are inside its own anchor name (`v1.2`,
      // `check_four_features 28/31`, `10 个`), there is no number standing next to
      // the label, so "the number left this label" is not a meaningful claim.
      strongEligible: digitsOnLine > (a.text.match(TOKEN_RE) ?? []).length,
    }
  })
  // Label-less stretches, in order, keyed p0/p1/… — these hold the digits that sit
  // in plain prose. They gate only when their digit set actually changes, which by
  // construction means the sentence around those digits was edited.
  labelFreeStretches(line, kept).forEach((st, i) => {
    segs.push({
      idx: `p${i}`,
      kind: 'prose',
      name: `L${lineNo} 第${i + 1}段无标签`,
      seg: trimPunct(maskDigits(st)).slice(0, 96),
      tokens: [...new Set(st.match(TOKEN_RE) ?? [])].sort(),
      strongEligible: true,
    })
  })
  return segs.filter((s) => s.tokens.length)
}

// The stretches of a labelled line that no anchor covers, in order.
function labelFreeStretches(line, kept) {
  const out = []
  let pos = 0
  for (const a of kept) {
    if (a.start > pos) out.push(line.slice(pos, a.start))
    pos = a.end
  }
  if (pos < line.length) out.push(line.slice(pos))
  return out.filter((s) => norm(s))
}

function sections(text) {
  const lines = text.split('\n')
  const out = []
  let cur = { title: '(前言)', lines: [] }
  for (const line of lines) {
    if (/^##\s+/.test(line)) {
      out.push(cur)
      cur = { title: line.trim(), lines: [] }
    }
    cur.lines.push(line)
  }
  out.push(cur)
  return out.map((s) => ({
    title: s.title,
    bytes: bytes(s.lines.join('\n')),
    lines: s.lines.length,
  }))
}

function facts(text) {
  const uniq = (arr) => [...new Set(arr)].filter(Boolean).sort()
  // `#` inside a fenced code block is a shell comment, NOT a heading. Tracking the
  // fence state is what keeps this check from reporting false "lost headings"
  // (first run flagged 3 command comments as removed headings).
  const headings = (() => {
    const out = []
    let fence = false
    for (const line of text.split('\n')) {
      if (/^\s*```/.test(line)) {
        fence = !fence
        continue
      }
      if (fence) continue
      const m = /^#{1,4}\s+(.+)$/.exec(line)
      if (m) out.push(m[1].trim())
    }
    return uniq(out)
  })()
  // Context binding: WHERE each number lives, not just whether it survives.
  // Sections are keyed by ORDINAL (`##` order), not by title: a measured test
  // (2026-10-06) showed title-keying reports 9 bogus L2 hits when a heading is
  // merely renamed while no digit changes. Ordinals survive renames and still
  // catch a real move from one section to another.
  // bySection maps token -> the section ordinals it occurred in (as strings).
  // byLine records the digit-masked line plus the tokens on that line.
  // byAnchor (L4) does the same one level finer: token -> the inline anchor it sits
  // next to, so that a move WITHIN one line or BETWEEN two lines of one section is
  // still visible. See the L4 header comment for the reproduction of the blind area.
  const sectionTitles = {}
  const secOfLine = []
  {
    let ord = 0
    for (const line of text.split('\n')) {
      if (/^##\s+/.test(line)) {
        ord++
        sectionTitles[String(ord)] = line.trim()
      }
      secOfLine.push(String(ord))
    }
  }
  const bySection = {}
  const byLine = []
  text.split('\n').forEach((line, i) => {
    const toks = line.match(/\b\d[\d,_]*\b/g) ?? []
    if (!toks.length) return
    for (const t of new Set(toks)) (bySection[t] ??= new Set()).add(secOfLine[i])
    byLine.push({
      key: line.replace(/\b\d[\d,_]*\b/g, '#').replace(/\s+/g, ' ').trim(),
      tokens: [...new Set(toks)].sort(),
    })
  })

  return {
    detectorVersion: DETECTOR_VERSION,
    ledgerMarkers: uniq([...text.matchAll(/<!--\s*ledger:([a-z0-9-]+)\s*-->/g)].map((m) => m[1])),
    headings,
    bySectionKey: 'ordinal',
    sectionTitles,
    bySection: Object.fromEntries(Object.entries(bySection).map(([k, v]) => [k, [...v].sort()])),
    byLine,
    // L4 payload: one entry per PARAGRAPH (a maximal run of digit-bearing lines in one
    // `##` section — the same unit L3 masks a line into, but grouped so the identity
    // survives a line break being inserted or removed).
    // L4 payload: one entry per LINE, listing the containers a number can be bound to.
    //   line             -- 1-based, for the human report
    //   sec              -- `##` ordinal (used to scope anchors, so a label that also
    //                       occurs in another section is not confused with this one)
    //   anchors[].name   -- the inline label: `code span`, **bold**, 【…】, 「…」, a bare
    //                       path. This is the identity the layer keys on, and the whole
    //                       point is that it is STABLE UNDER REWORDING: "give the
    //                       TOTAL line a new wording" keeps the label, "take 36 out of
    //                       the TOTAL line" loses it.
    //   anchors[].strong -- false when the ONLY digits on the line are inside anchor
    //                       names themselves (`v1.2`), because then no number is
    //                       standing next to a label and the rule below cannot apply.
    byAnchor: (() => {
      const out = []
      text.split('\n').forEach((line, i) => {
        const segs = anchorSegments(line, i + 1)
        if (!segs.some((s) => s.tokens.length)) return
        out.push({
          line: i + 1,
          sec: secOfLine[i],
          anchors: segs.map((s) => ({
            idx: s.idx,
            kind: s.kind,
            name: s.name,
            tokens: s.tokens,
            strong: s.strongEligible,
          })),
        })
      })
      return out
    })(),
    // Measured numbers are load-bearing in this file; keep every distinct literal.
    numbers: uniq([...text.matchAll(/\b\d[\d,_]*\b/g)].map((m) => m[0])),
    winPaths: uniq([...text.matchAll(/[A-Z]:\\\\?[^\s`"'|)\]]+/g)].map((m) => m[0].replace(/[.,;:]$/, ''))),
    skills: uniq([...text.matchAll(/`([a-z][a-z0-9]*(?:-[a-z0-9]+){2,})`/g)].map((m) => m[1])),
    // Compare the COMMAND, not its trailing comment: rewording a `# ...` note
    // does not remove the command, and flagging it would train us to ignore this.
    commands: uniq(
      [...text.matchAll(/^\s*(?:&\s|\$\w+\s*=|cmd \/c|node |powershell |pip |dsh )\S.*$/gm)].map((m) =>
        m[0].trim().replace(/\s+#.*$/, ''),
      ),
    ),
    markers: {
      '⚠️': (text.match(/⚠️/g) ?? []).length,
      '🚫': (text.match(/🚫/g) ?? []).length,
      '✅': (text.match(/✅/g) ?? []).length,
      '🚨': (text.match(/🚨/g) ?? []).length,
      '📌': (text.match(/📌/g) ?? []).length,
    },
  }
}

if (mode === 'sections') {
  const text = read(file)
  const rows = sections(text)
  const total = bytes(text)
  rows.sort((a, b) => b.bytes - a.bytes)
  console.log(`文件 = ${file}`)
  console.log(`总字节 = ${total}   总行 = ${text.split('\n').length}`)
  console.log('')
  console.log('  字节    占比   行   小节')
  for (const r of rows) {
    console.log(`  ${String(r.bytes).padStart(6)}  ${((r.bytes / total) * 100).toFixed(1).padStart(5)}%  ${String(r.lines).padStart(4)}   ${r.title.slice(0, 60)}`)
  }
} else if (mode === 'facts') {
  const f = facts(read(file))
  const show = (label, arr) => {
    console.log(`\n── ${label} (${arr.length}) ──`)
    console.log('   ' + arr.join('  '))
  }
  show('ledger markers', f.ledgerMarkers)
  show('headings', f.headings)
  show('skills', f.skills)
  show('numbers', f.numbers)
  show('win paths', f.winPaths)
  console.log('\n── commands (' + f.commands.length + ') ──')
  for (const c of f.commands) console.log('   ' + c)
  console.log('\n── markers ──')
  console.log('   ' + JSON.stringify(f.markers))
} else if (mode === 'snapshot') {
  const out = process.argv[4]
  if (!out) throw new Error('usage: snapshot <file> <out.json>')
  writeFileSync(out, JSON.stringify({ file, bytes: bytes(read(file)), facts: facts(read(file)) }, null, 2), 'utf8')
  console.log(`snapshot -> ${out}  (${bytes(read(file))} bytes)`)
} else if (mode === 'compare') {
  const base = JSON.parse(read(process.argv[3]))
  const rest = process.argv.slice(4).filter((a) => !a.startsWith('--'))
  const target = rest[0] ?? DEFAULT_FILE
  const strict = process.argv.includes('--strict')
  const verbose = process.argv.includes('--verbose')
  const l4Strict = process.argv.includes('--l4-strict')
  const cur = facts(read(target))
  const curBytes = bytes(read(target))
  // Sign convention (fixed 2026-10-07): the number carries the sign of (current - baseline)
  // and the LABEL carries the direction, matching splice-agmd.mjs. The old line mixed the
  // two -- a file that GREW by 1056 printed `(+1056，-1.4% 缩减)`, i.e. a negative
  // "reduction". Measured report of that mislabel: commit 9b378a9's follow-up.
  const delta = curBytes - base.bytes
  const pct = Math.abs(100 - (curBytes / base.bytes) * 100).toFixed(1)
  const trend = delta > 0 ? '增长' : delta < 0 ? '缩减' : '不变'
  console.log(`字节：${base.bytes} -> ${curBytes}   (${delta > 0 ? '+' : ''}${delta}，${pct}% ${trend})`)
  let missing = 0
  for (const key of Object.keys(base.facts)) {
    // The two context layers are objects, not arrays, and get their own report
    // below; letting them fall through would print `undefined` markers noise.
    if (key === 'bySection' || key === 'byLine' || key === 'byAnchor' || key === 'detectorVersion') continue
    const b = base.facts[key]
    if (Array.isArray(b)) {
      const lost = b.filter((x) => !cur[key].includes(x))
      if (lost.length) {
        missing += lost.length
        console.log(`\n!! ${key} 丢失 ${lost.length}/${b.length}：`)
        for (const x of lost) console.log('   - ' + x)
      } else {
        console.log(`ok ${key}: ${b.length}/${b.length} 保留`)
      }
    } else {
      console.log(`\nmarkers: ${Object.entries(b).map(([k, v]) => `${k} ${v}->${cur.markers[k]}`).join('  ')}`)
    }
  }
  // ── L2 / L3: context binding ────────────────────────────────────────────────
  let advisory = 0
  if (!base.facts.byLine || base.facts.bySectionKey !== 'ordinal') {
    console.log('')
    console.log('L2/L3 上下文层：跳过（该基线由旧版工具拍摄，缺少 bySectionKey=ordinal / byLine）')
    console.log('           → 要拿到这两层，请用当前版本重新 snapshot 一次基线。')
  } else {
    // Group by (from-sections -> to-sections) so one structural move reads as ONE
    // line instead of N, which is what makes the noise reviewable at a glance.
    const pairLabel = (secs, titles) =>
      secs.split(',').map((n) => (titles?.[n] ?? `#${n}`).slice(0, 26)).join(' , ')
    const byPair = new Map()
    for (const [tok, secs] of Object.entries(base.facts.bySection)) {
      const now = cur.bySection[tok]
      if (!now) continue                        // already counted as `missing` above
      if (now.some((s) => secs.includes(s))) continue
      const k = `${secs.join(',')} -> ${now.join(',')}`
      if (!byPair.has(k)) byPair.set(k, [])
      byPair.get(k).push(tok)
    }
    let l2 = 0
    for (const [k, toks] of byPair) {
      const [from, to] = k.split(' -> ')
      l2 += toks.length
      console.log(`L2 ${toks.length} 个 token 迁出小节：${pairLabel(from, base.facts.sectionTitles)}  ->  ${pairLabel(to, cur.sectionTitles)}`)
      console.log(`   ${toks.slice(0, 14).join(' ')}${toks.length > 14 ? ' …' : ''}`)
    }
    const curByKey = new Map()
    for (const { key, tokens } of cur.byLine) {
      curByKey.set(key, new Set([...(curByKey.get(key) ?? []), ...tokens]))
    }
    // L3 is split by WHY the line stopped matching, because the two reasons have very
    // different precision (measured 2026-10-06: rewriting one 5-line paragraph produced
    // 5 hits, of which exactly 1 was a real "a number left this line"):
    //   strong -- the masked line still exists, but its numbers are no longer all on it.
    //             The sentence is intact, so a moved/changed number IS suspicious.
    //             This is what catches the 28/31 <-> 20/23 swap.
    //   weak   -- the masked line itself is gone (rewritten or deleted). Usually just an
    //             edit; if a number really vanished from the file, L1 already said so.
    const strong = []
    const weak = []
    for (const { key, tokens } of base.facts.byLine) {
      const now = curByKey.get(key)
      if (!now) { weak.push({ key }); continue }
      const gone = tokens.filter((t) => !now.has(t))
      if (gone.length) strong.push({ key, why: `同一行里这些数字不见了：${gone.join(' ')}` })
    }
    advisory = l2 + strong.length
    console.log('')
    console.log(`L2 token 迁出原小节            : ${l2}`)
    console.log(`L3 强信号（该行仍在、数字不齐）: ${strong.length}   ← 归属可疑；--strict 下计入门槛`)
    for (const h of strong.slice(0, 10)) {
      console.log(`   - ${h.key.slice(0, 88)}`)
      console.log(`     ${h.why}`)
    }
    if (strong.length > 10) console.log(`   ... 另有 ${strong.length - 10} 行`)
    console.log(`L3 弱信号（该行被改写/删除）  : ${weak.length}   ← 默认不列出；数字若真消失 L1 会报`)
    if (verbose) {
      for (const h of weak.slice(0, 20)) console.log(`   ~ ${h.key.slice(0, 88)}`)
      if (weak.length > 20) console.log(`   ... 另有 ${weak.length - 20} 行`)
    }
    if (advisory) {
      console.log('   ⚠️ advisory 不等于出错：把同一行改写成不同措辞也会命中。' +
        (strict ? '当前 --strict，故计入判定。' : '默认不计入退出码。'))
    }
  }
  // ── L4: anchor binding (the layer that sees a move BETWEEN two lines) ───────
  let l4 = 0
  if (base.facts.detectorVersion !== DETECTOR_VERSION) {
    console.log('')
    console.log(`L4 锚点层：跳过（基线 detectorVersion=${base.facts.detectorVersion ?? '(无)'} ≠ 当前 ${DETECTOR_VERSION}）`)
    console.log('           「工具变了」与「内容丢了」不可区分 ⇒ 旧基线不得用新层比对（docMarker audit-instrument-version）。')
    console.log('           → 先用当前版本重新 snapshot 一次基线，再 compare。')
  } else if (!Array.isArray(base.facts.byAnchor)) {
    console.log('')
    console.log('L4 锚点层：跳过（该基线没有 byAnchor 载荷）')
  } else {
    // THE RULE (one sentence): a number that used to sit next to inline label L, and
    // now no longer sits next to L anywhere while still being present in the file, has
    // been re-bound — say so. That is exactly the case L1/L2/L3 cannot see when the
    // number simply moves to another line of the same section: nothing is missing, no
    // section changed, and both lines are still there.
    //
    // Why label identity and not "which line/paragraph": a rewrite changes lines and
    // sentences, so line- or paragraph-keyed rules report reformatting as movement.
    // Both earlier drafts of this layer did that and were measured: 129/9 then 58/9
    // false positives over the 9 legal rewrites in _quarantine/agmd-l3/rewrites
    // (see fp-table.md). A LABEL survives rewording, which is what makes the rule
    // usable as a gate. The per-token identity is `sec|name`.
    // A token that is part of the label NAME itself (`198.18.0.11~14` in
    // `` `198.18.0.11~14` ``，`10_000` in `staleGraceMs = 10_000`) is not a number a
    // label CARRIES, so "did it leave the label" is not a question about it. Without
    // this filter the layer reported `198` as having left the label
    // `198.18.0.11~14` when the only change was （）→ () around it (measured, v3).
    // It applies to code/path anchors only: a label like `**510**` or `**TOTAL 36**`,
    // whose digits stand alone, is precisely where the rule is supposed to apply.
    const isNameToken = (a, t) => {
      if (a.kind !== 'code' && a.kind !== 'path') return false
      const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      return new RegExp(`[A-Za-z0-9_.,~-]${esc}|${esc}[A-Za-z0-9_.,~-]`).test(a.name)
    }
    const labelOf = (a) => a.name !== PLAIN_ANCHOR && L4_LABEL_KINDS.has(a.kind)
    const index = (f) => {
      const tokLabels = new Map()     // token -> Set("sec|label")   (named labels only)
      const tokLines = new Map()      // token -> Set(line)
      const labelLines = new Map()    // "sec|label" -> Set(line)
      const labelTokens = new Map()   // "sec|label" -> Set(token), names stripped
      const labelStrong = new Set()   // labels that have a bare number next to them
      for (const row of f.byAnchor) {
        for (const a of row.anchors) {
          if (!labelOf(a)) continue
          const key = `${row.sec}|${a.name}`
          if (!labelLines.has(key)) labelLines.set(key, new Set())
          labelLines.get(key).add(row.line)
          // Label content with the numbers removed — see the rename guard below.
          const stripped = a.tokens.reduce((acc, t) => acc.split(t).join('#'), a.name)
          if (!labelTokens.has(key)) labelTokens.set(key, { stripped, toks: new Set() })
          for (const t of a.tokens) labelTokens.get(key).toks.add(t)
          if (!a.strong) continue
          labelStrong.add(key)
          for (const t of a.tokens) {
            if (isNameToken(a, t)) continue           // token is part of the label's name
            if (!tokLabels.has(t)) tokLabels.set(t, new Set())
            tokLabels.get(t).add(key)
          }
        }
        for (const a of row.anchors) {
          for (const t of a.tokens) {
            if (isNameToken(a, t)) continue
            if (!tokLines.has(t)) tokLines.set(t, new Set())
            tokLines.get(t).add(row.line)
          }
        }
      }
      return { tokLabels, tokLines, labelLines, labelTokens, labelStrong }
    }
    const b = index(base.facts)
    const c = index(cur)
    const l4strong = []
    // Label SHAPE: the label's text with the numbers blanked and everything except
    // letters and those placeholders dropped. Two labels with the same shape are the
    // same label reworded/reformatted (v1 inserts a space inside one, v3 swaps （） for
    // ()), which must never read as "the number moved". Used by both guards below.
    const shape = (stripped) => stripped.replace(/[^\p{L}#]/gu, '')
    const shapeOf = (bag, key) => {
      const rec = bag.labelTokens.get(key)
      return rec ? shape(rec.stripped) : null
    }
    // Location guard: the number must have actually gone somewhere else. "Same line and
    // section, under a label of the same shape" means the label was reworded in place —
    // an edit, not a re-binding. The first version of this guard compared raw label
    // keys, so a single inserted space turned one label into "two different labels" and
    // leaked `10_000` back out as a false positive (measured, v1-spacing).
    const samePlace = (t) => {
      const before = [...(b.tokLines.get(t) ?? [])]
      if (before.length !== 1) return true
      const bSec = base.facts.byAnchor.find((r) => r.line === before[0])?.sec
      if (bSec === undefined) return true
      const after = [...(c.tokLines.get(t) ?? [])]
      if (!after.length) return true
      const bShapes = new Set(
        [...(b.tokLabels.get(t) ?? [])]
          .filter((l) => l.startsWith(bSec + '|'))
          .map((l) => shapeOf(b, l))
          .filter(Boolean),
      )
      return after.some((l) => {
        const sec = cur.byAnchor.find((r) => r.line === l)?.sec
        if (sec !== bSec) return false
        return [...(c.tokLabels.get(t) ?? [])].some((k) => bShapes.has(shapeOf(c, k)))
      })
    }
    // Label-rename guard: the number now sits under a label that is only a reformatting
    // of the one it left, so the label was renamed rather than the fact re-bound.
    const looksRenamed = (oldKey, candKeys) => {
      const oldShape = shapeOf(b, oldKey)
      if (!oldShape || oldShape.length < 6) return false
      return candKeys.some((k) => shapeOf(c, k) === oldShape)
    }
    for (const [t, labels] of b.tokLabels) {
      // A token that sat under labels in MORE THAN ONE SECTION cannot be attributed:
      // the same literal means different things in different places (this file reuses
      // `36`, `23`, `489`…). Within one section it can legitimately sit under several
      // labels, so the rule is about RETENTION, not count:
      //   · at least one baseline label still carries the number -> nothing moved
      //     (the other label was just reworded);
      //   · no baseline label carries it any more, and some NEW label does -> moved.
      // The earlier `labels.size !== 1` guard got both directions wrong: it skipped a
      // real move when the destination label already shared the number (measured:
      // **510** into "…实测是 510" kept the count at 2 and produced no hit), and a
      // raw `!nowLabels.has(label)` test reported the reworded second label of a
      // legitimate pair as a move.
      const bl = new Set([...labels].filter((l) => b.tokLabels.get(t)?.has(l)))
      const secs = new Set([...bl].map((l) => l.split('|')[0]))
      if (secs.size !== 1) continue
      const nowLabels = c.tokLabels.get(t) ?? new Set()
      if ([...bl].some((l) => nowLabels.has(l))) continue   // retained somewhere: no move
      const gained = [...nowLabels].filter((l) => !bl.has(l))
      // Require a DESTINATION label that is NEW for this number, not merely the absence
      // of the old one. If the number now sits in plain prose, or under exactly the
      // labels it already had elsewhere, the label was renamed / the sentence reworded
      // — an ordinary edit, and reporting it is how the layer earned its first false
      // positives (measured: `10_000` under a label that gained a space, `50` under
      // 「基础连接已经关闭…」 after a synonym swap).
      if (!gained.length) continue
      if (!Object.prototype.hasOwnProperty.call(cur.bySection, t)) continue  // gone: L1's job
      if (samePlace(t)) continue                       // line+section unchanged: an edit
      const label = [...bl][0]
      // The rename guard must compare label CONTENT, not label keys: a reformatting
      // produces a different key with essentially the same text. And it must only
      // excuse the number when its own label really did survive — when it left a
      // label whose digits went to the destination, the test above already cleared
      // that, so a textually similar destination does not cancel a real move.
      if (looksRenamed(label, gained)) continue        // the label was reformatted
      const [sec, ...nameParts] = label.split('|')
      const name = nameParts.join('|')
      const nowNames = gained.map((k) => k.split('|').slice(1).join('|'))
      const at = [...(c.tokLines.get(t) ?? [])]
      l4strong.push({
        tok: t,
        from: `${name}（小节 ${sec}，原 L${[...b.labelLines.get(label)].join('/L')}）`,
        to: nowNames.length ? nowNames.join(' / ') : `无标签容器（现 L${at.join('/L') || '?'}）`,
      })
    }
    // Weak bucket: labels that carried numbers and are no longer present anywhere.
    // Counted for the record, never a gate: renaming a label is an ordinary edit and
    // the numbers under it are then reported (or not) by the strong rule above.
    const l4weak = []
    for (const label of b.labelStrong) {
      if (c.labelLines.has(label)) continue
      const [sec, ...np] = label.split('|')
      l4weak.push({ name: `${np.join('|')}`, why: `小节 ${sec} 里该标签已不存在（原 L${[...b.labelLines.get(label)].join('/L')}）` })
    }
    l4 = l4strong.length
    console.log('')
    console.log(`L4 标签绑定强信号（数字不再挂在原标签下）: ${l4strong.length}${L4_GATE ? '   ← 已收闸，计入门槛' : '   ← advisory，默认不计入退出码'}`)
    for (const h of l4strong.slice(0, 12)) {
      console.log(`   - ${h.tok} 离开了「${h.from}」→ 现在：${h.to}`)
    }
    if (l4strong.length > 12) console.log(`   ... 另有 ${l4strong.length - 12} 条`)
    console.log(`L4 标签消失弱信号（标签被改名/删句）    : ${l4weak.length}   ← 默认不列出；合法改写会命中，故从不当闸门`)
    if (verbose) {
      for (const h of l4weak.slice(0, 20)) console.log(`   ~ 「${h.name}」${h.why}`)
      if (l4weak.length > 20) console.log(`   ... 另有 ${l4weak.length - 20} 条`)
    }
  }

  console.log('')
  const l4Gated = l4Strict && L4_GATE
  const failed = missing > 0 || (strict && advisory > 0) || (l4Gated && l4 > 0)
  const why = []
  if (missing) why.push(`${missing} 项字面消失`)
  if (strict && advisory) why.push(`${advisory} 项上下文不符`)
  if (l4Gated && l4) why.push(`${l4} 项数字离开原锚点`)
  console.log(failed
    ? `RESULT: FAIL（${why.join(' + ')}）——必须逐条给出理由`
    : 'RESULT: PASS（基线里的每个可核对事实都还在）')
  console.log('注意：本工具只做字面与上下文比对。PASS ≠ 断言为真 —— 见 AGENTS.md 第七节第 0 条')
  console.log('      docMarker audit-pass-not-fact-truth（对调两个测试的数字，旧版本仍报 PASS）。')
  process.exit(failed ? 1 : 0)
} else {
  console.error('usage: sections | facts | snapshot <file> <out> | compare <base.json> [file]')
  process.exit(2)
}
