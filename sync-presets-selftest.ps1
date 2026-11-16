<#
    sync-presets-selftest.ps1 -- sync-presets.ps1 的故障注入自检

    为什么：「它跑起来没抱怨」不是检查器有效的证据，单独一个非零退出码也不能说明
    工具是发现了差异还是自己崩了。本测试构造一对临时源/目标（绝不动真实运行时
    副本），注入故意的故障，并同时断言退出码和磁盘上的实际字节。

    这里的哈希用 certutil 计算，与 sync-presets.ps1 内部用的 Get-FileHash 是不同
    引擎，所以测试不会继承被测对象的 bug。

    运行：
        pwsh -NoProfile -ExecutionPolicy Bypass -File sync-presets-selftest.ps1

    退出码：0 = 全部断言通过，1 = 至少一条失败。

    本文件是 UTF-8（无 BOM）且含中文注释 —— 只能由 pwsh 7 执行。
    （5.1 会把无 BOM UTF-8 当 ANSI 读，注释会乱码；中文只出现在注释里，
      代码与输出字符串仍保持 ASCII。）
#>

[CmdletBinding()]
param(
    [string]$Target,
    [string]$WorkDir
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$script:Pass = 0
$script:Fail = 0
$script:Notes = @()

function Write-Line {
    param([string]$Text = '')
    Write-Host $Text
}

function Assert-That {
    param([string]$Name, [bool]$Ok, [string]$Detail = '')
    if ($Ok) {
        $script:Pass++
        Write-Line ('  PASS  ' + $Name)
        if ($Detail -and $Detail.Length -lt 90) { Write-Line ('        ' + $Detail) }
    } else {
        $script:Fail++
        Write-Line ('  FAIL  ' + $Name)
        Write-Line ('        ' + $Detail)
    }
}

function Invoke-Target {
    param([string[]]$Arguments)
    $out = & pwsh -NoProfile -ExecutionPolicy Bypass -File $Target @Arguments 2>&1 | Out-String
    return [pscustomobject]@{ ExitCode = $LASTEXITCODE; Output = $out }
}

# Independent hash engine (certutil), not Get-FileHash.
function Get-CertHash {
    param([string]$FilePath)
    $o = (& certutil -hashfile $FilePath SHA256 2>&1 | Out-String)
    $m = [regex]::Match($o, '\b[0-9a-fA-F]{64}\b')
    if ($m.Success) { return $m.Value.ToLower() }
    return 'PARSE-FAIL'
}

# Byte-level snapshot: every file's hash and mtime, plus the directory mtime.
# Two snapshots being equal proves nothing was written, touched or deleted.
function Get-Signature {
    param([string]$Root)
    if (-not (Test-Path -LiteralPath $Root -PathType Container)) { return 'MISSING' }
    $files = @(Get-ChildItem -LiteralPath $Root -Recurse -File -Force | Sort-Object FullName)
    $parts = @()
    foreach ($f in $files) {
        $parts += ($f.FullName.Substring($Root.Length + 1) + '=' + (Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash + '@' + $f.LastWriteTime.Ticks)
    }
    return (($parts -join ';') + '#dir=' + (Get-Item -LiteralPath $Root -Force).LastWriteTime.Ticks)
}

# Directory-style presets only: a non-preset directory in the source is skipped by
# sync-presets.ps1 on purpose, so it must not count as a difference here either.
function Get-PresetIds {
    param([string]$SrcRoot)
    $ids = @()
    foreach ($d in @(Get-ChildItem -LiteralPath $SrcRoot -Directory -Force | Sort-Object Name)) {
        foreach ($m in @('preset.yml', 'agent.cordis.yml')) {
            if (Test-Path -LiteralPath (Join-Path $d.FullName $m) -PathType Leaf) { $ids += $d.Name; break }
        }
    }
    return $ids
}

# Full two-sided comparison with certutil: missing, differing and dest-only files.
function Compare-WithCertutil {
    param([string]$SrcRoot, [string]$DstRoot)
    $bad = @()
    $count = 0
    foreach ($id in @(Get-PresetIds $SrcRoot)) {
        $sDir = Join-Path $SrcRoot $id
        $dDir = Join-Path $DstRoot $id
        foreach ($f in @(Get-ChildItem -LiteralPath $sDir -Recurse -File -Force | Sort-Object FullName)) {
            $rel = $f.FullName.Substring($SrcRoot.Length + 1)
            $count++
            $d = Join-Path $DstRoot $rel
            if (-not (Test-Path -LiteralPath $d -PathType Leaf)) { $bad += ($rel + ' (missing in dest)'); continue }
            if ((Get-CertHash $f.FullName) -ne (Get-CertHash $d)) { $bad += ($rel + ' (hash differs)') }
        }
        if (Test-Path -LiteralPath $dDir -PathType Container) {
            foreach ($f in @(Get-ChildItem -LiteralPath $dDir -Recurse -File -Force | Sort-Object FullName)) {
                $rel = $f.FullName.Substring($DstRoot.Length + 1)
                if (-not (Test-Path -LiteralPath (Join-Path $SrcRoot $rel) -PathType Leaf)) { $bad += ($rel + ' (dest-only)') }
            }
        }
    }
    return [pscustomobject]@{ RelCount = $count; Bad = @($bad); AllEqual = (@($bad).Count -eq 0) }
}

function Get-StaleReport {
    param([string]$Text)
    $lines = @(($Text -split "`r?`n") | Where-Object { $_ -match '^\s*(DIFF|SRC-ONLY|DST-ONLY|COPIED|REMOVED|COPY-FAIL|REMOVE-FAIL|READ failed|!!|RESULT)' })
    return ($lines -join ' ;; ')
}

# ---------------------------------------------------------------------------
# setup
# ---------------------------------------------------------------------------

if (-not $Target) { $Target = Join-Path $PSScriptRoot 'sync-presets.ps1' }
if (-not $WorkDir) {
    # workspace scratch convention: regenerable test output goes to _quarantine
    $WorkDir = Join-Path (Split-Path -Parent $PSScriptRoot) '_quarantine\sync-presets-selftest'
}
if (-not (Test-Path -LiteralPath $Target -PathType Leaf)) {
    Write-Line ('ERROR: target script not found: ' + $Target)
    exit 1
}
if ($WorkDir.ToLowerInvariant().Contains('\.dsh\')) {
    Write-Line ('ERROR: refusing to run a destructive self test inside ' + $WorkDir)
    exit 1
}

Write-Line '===================================================================='
Write-Line 'sync-presets.ps1  --  fault-injection self test'
Write-Line '===================================================================='
Write-Line ('TARGET   : ' + $Target)
Write-Line ('WORKDIR  : ' + $WorkDir)

if (Test-Path -LiteralPath $WorkDir) { Remove-Item -LiteralPath $WorkDir -Recurse -Force }
$src = Join-Path $WorkDir 'src'
$dst = Join-Path $WorkDir 'dst'
New-Item -ItemType Directory -Force (Join-Path $src 'presetA\skills\sub'), (Join-Path $src 'presetB\tools'), (Join-Path $src 'not-a-preset'), (Join-Path $dst 'presetB') | Out-Null
Set-Content -Path (Join-Path $src 'presetA\preset.yml') -Value @('id: presetA', 'name: Alpha Preset', 'version: 1') -Encoding ASCII
Set-Content -Path (Join-Path $src 'presetA\agent.cordis.yml') -Value @('# presetA composition', 'plugins:', '  - id: agent-instructions', '    config:', '      maxBytes: 65536') -Encoding ASCII
Set-Content -Path (Join-Path $src 'presetA\skills\sub\deep.md') -Value @('nested file proves recursive copy') -Encoding ASCII
Set-Content -Path (Join-Path $src 'presetB\preset.yml') -Value @('id: presetB', 'name: Beta Preset') -Encoding ASCII
Set-Content -Path (Join-Path $src 'presetB\tools\leaf.txt') -Value @('leaf') -Encoding ASCII
Set-Content -Path (Join-Path $src 'not-a-preset\random.txt') -Value @('no marker file here') -Encoding ASCII
Set-Content -Path (Join-Path $dst 'presetB\preset.yml') -Value @('id: presetB', 'name: STALE-RUNTIME-COPY') -Encoding ASCII
Set-Content -Path (Join-Path $dst 'presetB\stale.txt') -Value @('stale runtime leftover') -Encoding ASCII

$rels = @('presetA\agent.cordis.yml', 'presetA\preset.yml', 'presetA\skills\sub\deep.md', 'presetB\preset.yml', 'presetB\tools\leaf.txt')

# ---------------------------------------------------------------------------
# T1 - dry run on a dirty pair: reports drift, exit 1, writes nothing
# ---------------------------------------------------------------------------

Write-Line ''
Write-Line 'T1  -DryRun on a dirty pair (stale dest file + extra dest file + missing files)'
$sigBefore = Get-Signature $dst
$r = Invoke-Target @('-Source', $src, '-Dest', $dst, '-DryRun')
$sigAfter = Get-Signature $dst
Assert-That 'T1a exit code is 1 (drift reported)' ($r.ExitCode -eq 1) ('exit=' + $r.ExitCode)
Assert-That 'T1b -DryRun wrote nothing (dst signature identical)' ($sigBefore -eq $sigAfter) 'count/hash/mtime snapshot changed'
Assert-That 'T1c report names the differing file' ($r.Output -match 'DIFF\s+preset\.yml') (Get-StaleReport $r.Output)
Assert-That 'T1d report names dest-only file' ($r.Output -match 'DST-ONLY\s+stale\.txt') ''
Assert-That 'T1e non-preset directory is skipped, not copied' ($r.Output -match 'SKIPPED\s+: not-a-preset') ''

# ---------------------------------------------------------------------------
# T2 - real sync: exit 0 and every byte equal on both sides
# ---------------------------------------------------------------------------

Write-Line ''
Write-Line 'T2  real sync -Mirror, then independent certutil comparison of both sides'
$r = Invoke-Target @('-Source', $src, '-Dest', $dst, '-Mirror')
$cmp = Compare-WithCertutil $src $dst
Assert-That 'T2a exit code is 0' ($r.ExitCode -eq 0) ('exit=' + $r.ExitCode)
Assert-That 'T2b all 5 files byte-identical (certutil)' $cmp.AllEqual ('files=' + $cmp.RelCount + ' bad=' + ($cmp.Bad -join ','))
Assert-That 'T2c dest-only stale.txt was removed by -Mirror' (-not (Test-Path -LiteralPath (Join-Path $dst 'presetB\stale.txt'))) ''
Assert-That 'T2d nested directory was created and copied' (Test-Path -LiteralPath (Join-Path $dst 'presetA\skills\sub\deep.md') -PathType Leaf) ''
Assert-That 'T2e summary reports copied = 5' ($r.Output -match 'copied\s+:\s+5') ''

# ---------------------------------------------------------------------------
# T3 - second run is a no-op: exit 0 and not a single file touched
# ---------------------------------------------------------------------------

Write-Line ''
Write-Line 'T3  second real sync (idempotence)'
$sigBefore = Get-Signature $dst
$r = Invoke-Target @('-Source', $src, '-Dest', $dst)
$sigAfter = Get-Signature $dst
Assert-That 'T3a exit code is 0' ($r.ExitCode -eq 0) ('exit=' + $r.ExitCode)
Assert-That 'T3b nothing was rewritten (identical files are skipped)' ($sigBefore -eq $sigAfter) 'mtime/hash snapshot changed'
Assert-That 'T3c summary reports copied = 0' ($r.Output -match 'copied\s+:\s+0') ''

# ---------------------------------------------------------------------------
# T4 - one-byte change in the source, same file length
# ---------------------------------------------------------------------------

Write-Line ''
Write-Line 'T4  inject one byte into src\presetA\agent.cordis.yml (65536 -> 65537, length unchanged)'
$changed = Join-Path $src 'presetA\agent.cordis.yml'
$bytes = [System.IO.File]::ReadAllBytes($changed)
$lenBefore = $bytes.Length
$idx = [Array]::LastIndexOf($bytes, [byte][char]'6')
$bytes[$idx] = [byte][char]'7'
[System.IO.File]::WriteAllBytes($changed, $bytes)
$lenAfter = ([System.IO.File]::ReadAllBytes($changed)).Length
$drift = @()
foreach ($rel in $rels) {
    if ((Get-CertHash (Join-Path $src $rel)) -ne (Get-CertHash (Join-Path $dst $rel))) { $drift += $rel }
}
Assert-That 'T4a file length is unchanged (only hashing can catch this)' ($lenBefore -eq $lenAfter) ('bytes=' + $lenAfter)
Assert-That 'T4b certutil finds exactly 1 differing file' (@($drift).Count -eq 1) ('differing=' + (@($drift) -join ','))
Assert-That 'T4c the differing file is agent.cordis.yml' ((@($drift).Count -eq 1) -and ($drift[0] -eq 'presetA\agent.cordis.yml')) (@($drift) -join ',')
$sigBefore = Get-Signature $dst
$r = Invoke-Target @('-Source', $src, '-Dest', $dst, '-DryRun')
$sigAfter = Get-Signature $dst
Assert-That 'T4d drift gate exits 1' ($r.ExitCode -eq 1) ('exit=' + $r.ExitCode)
Assert-That 'T4e drift gate printed both hashes' (($r.Output -match 'src sha256 =') -and ($r.Output -match 'dst sha256 =')) ''
Assert-That 'T4f drift gate wrote nothing' ($sigBefore -eq $sigAfter) 'snapshot changed'
Assert-That 'T4g summary counts exactly one differing file' ($r.Output -match 'differing\s*:\s*1') ''

# ---------------------------------------------------------------------------
# T5 - repair, then verify with the independent engine
# ---------------------------------------------------------------------------

Write-Line ''
Write-Line 'T5  real sync repairs the injected byte'
$r = Invoke-Target @('-Source', $src, '-Dest', $dst)
$cmp = Compare-WithCertutil $src $dst
Assert-That 'T5a exit code is 0' ($r.ExitCode -eq 0) ('exit=' + $r.ExitCode)
Assert-That 'T5b all files equal again (certutil)' $cmp.AllEqual ('bad=' + ($cmp.Bad -join ','))
Assert-That 'T5c report says copied=1 landed=1' ($r.Output -match 'copied=1 landed=1') (Get-StaleReport $r.Output)

# ---------------------------------------------------------------------------
# T6 - copy refused by the OS must not look like "differences found"
# ---------------------------------------------------------------------------

Write-Line ''
Write-Line 'T6  destination file held open (FileShare.Read) while the source changed'
Add-Content -Path (Join-Path $src 'presetB\preset.yml') -Value 'name: changed-while-destination-is-locked' -Encoding ASCII
$locked = Join-Path $dst 'presetB\preset.yml'
$sigBefore = Get-Signature $dst
$stream = [System.IO.File]::Open($locked, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::Read)
try {
    $r = Invoke-Target @('-Source', $src, '-Dest', $dst)
} finally {
    $stream.Dispose()
}
$sigAfter = Get-Signature $dst
Assert-That 'T6a exit code is 2, not 1 (hard failure, not a diff verdict)' ($r.ExitCode -eq 2) ('exit=' + $r.ExitCode)
Assert-That 'T6b the locked file was not modified' (($sigBefore -eq $sigAfter)) 'snapshot changed'
Assert-That 'T6c failure is stated explicitly in the report' (($r.Output -match 'READ failed') -or ($r.Output -match 'COPY-FAIL') -or ($r.Output -match 'SCRIPT ERROR')) (Get-StaleReport $r.Output)

# ---------------------------------------------------------------------------
# T7 - after the lock is released the drift is repaired
# ---------------------------------------------------------------------------

Write-Line ''
Write-Line 'T7  same sync with the lock released'
$r = Invoke-Target @('-Source', $src, '-Dest', $dst)
$cmp = Compare-WithCertutil $src $dst
Assert-That 'T7a exit code is 0' ($r.ExitCode -eq 0) ('exit=' + $r.ExitCode)
Assert-That 'T7b all files equal (certutil)' $cmp.AllEqual ('bad=' + ($cmp.Bad -join ','))

# ---------------------------------------------------------------------------
# T8 - parameter and path errors all exit 2
# ---------------------------------------------------------------------------

Write-Line ''
Write-Line 'T8  parameter / path errors'
New-Item -ItemType Directory -Force (Join-Path $WorkDir 'nopresets\just-a-folder') | Out-Null
Set-Content -Path (Join-Path $WorkDir 'nopresets\just-a-folder\x.txt') -Value 'no marker' -Encoding ASCII
$errorCases = @(
    @{ Name = 'T8a -Source does not exist';      Args = @('-Source', (Join-Path $WorkDir 'NOPE'), '-Dest', $dst, '-DryRun') },
    @{ Name = 'T8b -Source equals -Dest';        Args = @('-Source', $src, '-Dest', $src, '-DryRun') },
    @{ Name = 'T8c -Dest inside -Source';        Args = @('-Source', $src, '-Dest', (Join-Path $src 'inner'), '-DryRun') },
    @{ Name = 'T8d no preset dirs under -Source'; Args = @('-Source', (Join-Path $WorkDir 'nopresets'), '-Dest', $dst, '-DryRun') },
    @{ Name = 'T8e -Source is a file';           Args = @('-Source', (Join-Path $src 'presetB\preset.yml'), '-Dest', $dst, '-DryRun') }
)
foreach ($c in $errorCases) {
    $r = Invoke-Target $c.Args
    $msg = @(($r.Output -split "`r?`n") | Where-Object { $_ -match '^ERROR:' } | Select-Object -First 1)
    Assert-That $c.Name ($r.ExitCode -eq 2) ('exit=' + $r.ExitCode + '  ' + ($msg -join ''))
}

# ---------------------------------------------------------------------------
# T9 - static guards for the 7-side rule: UTF-8 without BOM, parses, and has
#      no process-table / fixed-port judges (the target is no longer 5.1-run).
# ---------------------------------------------------------------------------

Write-Line ''
Write-Line 'T9  static guards'
$bytes = [System.IO.File]::ReadAllBytes($Target)
$hasBom = ($bytes.Length -ge 3) -and ($bytes[0] -eq 0xEF) -and ($bytes[1] -eq 0xBB) -and ($bytes[2] -eq 0xBF)
$parseErrors = $null
$tokens = $null
$null = [System.Management.Automation.Language.Parser]::ParseFile($Target, [ref]$tokens, [ref]$parseErrors)
Assert-That 'T9a target has no UTF-8 BOM' (-not $hasBom) ''
Assert-That 'T9b target parses with zero syntax errors' (@($parseErrors).Count -eq 0) ('errors=' + @($parseErrors).Count)
Assert-That 'T9c target has no Get-Process / Get-NetTCPConnection' (-not (($bytes.Length -gt 0) -and ((Get-Content -Raw $Target) -match 'Get-Process|Get-NetTCPConnection'))) ''

# ---------------------------------------------------------------------------
# result
# ---------------------------------------------------------------------------

Write-Line ''
Write-Line '===================================================================='
Write-Line ('RESULT: ' + $script:Pass + ' passed, ' + $script:Fail + ' failed')
Write-Line ('scratch left at: ' + $WorkDir + '  (regenerable, safe to delete)')
if ($script:Fail -gt 0) {
    Write-Line 'SELFTEST FAILED'
    exit 1
}
Write-Line 'SELFTEST PASSED'
exit 0
