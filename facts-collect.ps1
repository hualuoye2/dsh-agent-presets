# 把 AGENTS.md 断言的「可测事实」收集到 facts-actual.json。
#
# 两个平台事实决定了这种拆分（2026-10-06 复核）：
#   1. 本沙箱里 Node 捕获不到子进程 stdout：
#      execFileSync(git, ['--version']) -> EPERM。所以测量放在这里。
#   2. 中文报告放在 facts-check.mjs 里；路径从 $env:USERPROFILE 拼，
#      避免写死中文用户名。本文件是 UTF-8（无 BOM）且含中文注释 —— 只能由 pwsh 7 执行。
#
# 这里只放便宜且确定的事实。任何依赖网络、端口、时序或 GUI 的东西都刻意不接
# （见 facts-check.mjs）。


$ErrorActionPreference = 'Stop'

$root   = 'D:\deepseek'
$git    = 'D:\deepseek\.tools\MinGit\cmd\git.exe'
# output goes to _quarantine\ : it is a run product, and the workspace rule is
# "test products go to _quarantine\..." (regenerable by definition).
$out    = Join-Path $root '_quarantine\facts-actual.json'

# --- tracked files, total and per top-level entry ---------------------------
$files = & $git -C $root ls-files
$byTop = @{}
foreach ($f in $files) {
    $top = ($f -split '/')[0]
    if ($byTop.ContainsKey($top)) { $byTop[$top] = $byTop[$top] + 1 }
    else { $byTop[$top] = 1 }
}

# --- ledger -----------------------------------------------------------------
$ledgerLines = Get-Content (Join-Path $root 'assumption-ledger.jsonl') -Encoding UTF8 |
    Where-Object { $_.Trim() -ne '' }
$ledger = $ledgerLines | ForEach-Object { $_ | ConvertFrom-Json }

# --- skills / check scripts -------------------------------------------------
$skillDirs = Get-ChildItem (Join-Path $root '.dsh\skills') -Directory
$skillCount = ($skillDirs | Where-Object { Test-Path (Join-Path $_.FullName 'SKILL.md') }).Count
$checkCount = (Get-ChildItem (Join-Path $root 'tools') -Filter 'check_*.py' -File).Count
# tools\ holds 88 loose .py files: 36 check_* + 21 diag_* + the rest. Both
# numbers are asserted in AGENTS.md section 7.2, and both change only when a
# tool is added or removed -- which is exactly the "relevant change" bar this
# registry uses for admission (volatile per-commit counts stay out).
$toolsPy = (Get-ChildItem (Join-Path $root 'tools') -Filter '*.py' -File).Count
$diagPy  = (Get-ChildItem (Join-Path $root 'tools') -Filter 'diag_*.py' -File).Count

# --- DSH profile packages (path built without non-ASCII literals) ------------
$pkgDir = Join-Path $env:USERPROFILE '.dsh\profiles\node_modules\@deepseek-ai'
$pkgs = @()
if (Test-Path $pkgDir) { $pkgs = Get-ChildItem $pkgDir -Force }
$pkgsDsh   = @($pkgs | Where-Object { $_.Name -like 'dsh-*' })
$pkgsOther = (@($pkgs).Count - @($pkgsDsh).Count)

# --- dead junction targets ---------------------------------------------------
# AGENTS.md asserts that exactly N of these borrowed packages point at a target
# that no longer exists. That is the same "configured but missing" class this
# whole script exists for, so it is asserted rather than merely noted.
# Sanity requirement: the entries must actually EXPOSE a Target. If the probe
# read nothing, the count would be a silent 0 -- a broken instrument wearing the
# costume of a stale doc, and the doc would get "corrected" for no reason.
$junctionTotal = 0
$deadJunctions = 0
foreach ($jp in $pkgs) {
    $jt = $null
    try { $jt = $jp.Target } catch { }
    if ($jt) {
        $junctionTotal++
        if (-not (Test-Path -LiteralPath (@($jt)[0]))) { $deadJunctions++ }
    }
}

# --- desktop profile: TWO different lists, both asserted in AGENTS.md --------
# cordis.yml states the tree is composed from package.json's dsh.profile.bundles.
# `dependencies` is a SEPARATE list -- and that is the one capmap's [PROFILES]
# section prints. Reading one and checking it against the other produces a false
# "the doc is missing a plugin" verdict, which is exactly what happened.
# 2026-10-07: dsh-better-sidebar was added to both lists and AGENTS.md still
# claimed the old counts in two different sections, so both are asserted now.
# If the manifest is missing/unreadable the keys are omitted on purpose, so
# facts-check prints SKIP instead of blaming the doc.
$desktopPj      = Join-Path $env:USERPROFILE '.dsh\profiles\desktop\package.json'
$desktopDeps    = -1
$desktopBundles = -1
if (Test-Path $desktopPj) {
    try {
        $dj = Get-Content $desktopPj -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($dj.dependencies)        { $desktopDeps    = @($dj.dependencies.PSObject.Properties).Count }
        if ($dj.dsh.profile.bundles) { $desktopBundles = @($dj.dsh.profile.bundles).Count }
    } catch { }
}

# --- doc size ---------------------------------------------------------------
# AGENTS.md is injected as instructions, and the harness TRUNCATES FROM THE TAIL
# once the preset's byte budget is exceeded. Measured 2026-10-06: the file hit
# 65895 bytes and the harness reported "truncated AGENTS.md from 65895 to 65244"
# -- section 9 silently vanished from the loaded instructions while the file on
# disk still contained it. So the size itself is worth an assertion.
$docBytes = (Get-Item (Join-Path $root 'AGENTS.md')).Length

# --- assemble ---------------------------------------------------------------
$facts = [ordered]@{
    total_files      = @($files).Count
    doc_bytes        = $docBytes
    skills           = $skillCount
    check_py         = $checkCount
    ledger_entries   = @($ledgerLines).Count
    ledger_desktop   = @($ledger | Where-Object { $_.author -eq 'desktop' }).Count
    pkgs_total       = @($pkgs).Count
    pkgs_dsh         = @($pkgsDsh).Count
    pkgs_other       = $pkgsOther
    junction_total   = $junctionTotal
    dead_junctions   = $deadJunctions
    tools_py         = $toolsPy
    tools_diag       = $diagPy
}
if ($desktopDeps    -ge 0) { $facts['desktop_plugins'] = $desktopDeps }
if ($desktopBundles -ge 0) { $facts['desktop_bundles'] = $desktopBundles }
foreach ($k in $byTop.Keys) {
    $facts["dir:$k"] = $byTop[$k]
}

$json = $facts | ConvertTo-Json -Depth 4
[IO.File]::WriteAllText($out, $json + "`r`n", [System.Text.UTF8Encoding]::new($false))

Write-Output ("measured {0} facts -> {1}" -f $facts.Count, $out)
