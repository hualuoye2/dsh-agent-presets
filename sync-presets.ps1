<#
    sync-presets.ps1

    把目录式 agent preset 从 git 跟踪的源树同步到真正生效的运行时副本，并用逐文件
    SHA256 对账证明结果：

        源（已跟踪）    : <workspace>\.agent-presets\<id>\
        运行时（未跟踪）: %USERPROFILE%\.dsh\.agent-presets\<id>\

    为什么：真正的源在仓库里，但 DSH 实际挂载的副本在工作区外、没有版本控制。
    「仓库里改了、运行时没变」是真实且静默的失败模式，所以本脚本从不相信「复制
    成功」——它会重新从磁盘读目标并比对哈希。

    用法（执行策略禁止进程内调用，所以用 -File）：

        pwsh -NoProfile -ExecutionPolicy Bypass -File sync-presets.ps1
        pwsh -NoProfile -ExecutionPolicy Bypass -File sync-presets.ps1 -DryRun
        pwsh -NoProfile -ExecutionPolicy Bypass -File sync-presets.ps1 -Verbose
        pwsh -NoProfile -ExecutionPolicy Bypass -File sync-presets.ps1 -Mirror
        pwsh -NoProfile -ExecutionPolicy Bypass -File sync-presets.ps1 -Source X -Dest Y

    参数
        -Source <path>  preset 源根目录。默认：本脚本所在目录（$PSScriptRoot），
                        即 <workspace>\.agent-presets。
        -Dest   <path>  运行时副本根目录。默认：%USERPROFILE%\.dsh\.agent-presets。
        -DryRun         什么都不写；只报告当前差异，以及真实运行会做什么。
        -Mirror         删除只存在于目标、不存在于源的文件（仅限 <Dest>\<id>\ 内）。
                        默认关闭，因为删除是这里唯一不可逆的动作。
        -Verbose        对每个已一致的文件也打印一行。

    退出码
        0  本次运行后两侧每个文件都一致
        1  仍有差异（-DryRun 下：有差异且什么都没写）。
           注意：写模式修复漂移后，两侧一致时合法地退出 0。把 -DryRun 当作只读
           漂移闸门——它回答「源变了而运行时副本没变吗？」。
        2  参数/路径错误、找不到目录式 preset、mkdir/复制/删除/重读某步失败，
           或运行没有完成。本脚本的非零退出码从不静默：读 RESULT 行。

    范围：只写 <Dest>\<preset-id>\ 内。绝不碰运行时 DSH home 下的其他东西
    （不动 profiles\、不动 skills\）。

    本文件是 UTF-8（无 BOM）且含中文注释 —— 只能由 pwsh 7 执行。
#>

[CmdletBinding()]
param(
    [string]$Source,
    [string]$Dest,
    [switch]$DryRun,
    [switch]$Mirror
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$PresetMarkers = @('preset.yml', 'agent.cordis.yml')
$script:hardErrors = @()

# Backstop. A process-level failure (unreadable file, denied write, IO error) must
# never be reported as "differences found" -- both would exit non-zero and the two
# causes have to stay distinguishable, so anything unhandled exits 2 and says so.
trap {
    Write-Report ''
    Write-Report ('SCRIPT ERROR (unhandled): ' + $_.Exception.Message)
    Write-Report ('  at ' + $_.InvocationInfo.PositionMessage)
    Write-Report 'RESULT: ABORTED - the run did not complete, so no verdict was reached (exit 2)'
    exit 2
}

# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

function Write-Report {
    param([string]$Text = '')
    Write-Host $Text
}

function Fail-Parameter {
    param([string]$Message)
    Write-Report ''
    Write-Report ('ERROR: ' + $Message)
    Write-Report 'RESULT: ABORTED on a parameter / path problem (exit 2)'
    exit 2
}

function Get-AbsolutePath {
    param([string]$Path)
    if ([System.IO.Path]::IsPathRooted($Path)) {
        return [System.IO.Path]::GetFullPath($Path)
    }
    return [System.IO.Path]::GetFullPath((Join-Path (Get-Location).Path $Path))
}

# Returns a hashtable: relative file path -> lowercase SHA256 hex.
# Returns an empty map when the root does not exist (that is a difference, not an error).
function Get-FileHashMap {
    param([string]$Root)
    $map = @{}
    if (-not (Test-Path -LiteralPath $Root -PathType Container)) { return $map }
    foreach ($item in @(Get-ChildItem -LiteralPath $Root -File -Recurse -Force -ErrorAction Stop)) {
        $rel = $item.FullName.Substring($Root.Length + 1)
        try {
            $map[$rel] = (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256 -ErrorAction Stop).Hash.ToLowerInvariant()
        } catch {
            # An unreadable file must not abort the whole report; record it and let
            # the hard-error tally drive the exit code to 2.
            $script:hardErrors += ('READ failed: ' + $item.FullName + ' :: ' + $_.Exception.Message)
        }
    }
    return $map
}

function Compare-FileMaps {
    param([hashtable]$SrcMap, [hashtable]$DstMap)
    $rels = @()
    $rels += @($SrcMap.Keys)
    $rels += @($DstMap.Keys)
    $rels = @($rels | Sort-Object -Unique)
    $match = @(); $diff = @(); $srcOnly = @(); $dstOnly = @()
    foreach ($rel in $rels) {
        $inSrc = $SrcMap.ContainsKey($rel)
        $inDst = $DstMap.ContainsKey($rel)
        if ($inSrc -and $inDst) {
            if ($SrcMap[$rel] -eq $DstMap[$rel]) { $match += $rel } else { $diff += $rel }
        } elseif ($inSrc) {
            $srcOnly += $rel
        } else {
            $dstOnly += $rel
        }
    }
    return [pscustomobject]@{
        Rels    = $rels
        Match   = $match
        Diff    = $diff
        SrcOnly = $srcOnly
        DstOnly = $dstOnly
    }
}

# ---------------------------------------------------------------------------
# preconditions
# ---------------------------------------------------------------------------

if ($ExecutionContext.SessionState.LanguageMode -ne 'FullLanguage') {
    Write-Report ('ERROR: LanguageMode is ' + $ExecutionContext.SessionState.LanguageMode +
                  '; this script needs FullLanguage (it reads and writes outside the workspace).')
    Write-Report 'RESULT: ABORTED (exit 2)'
    exit 2
}

if (-not $Source) {
    if ($PSScriptRoot) { $Source = $PSScriptRoot } else { $Source = (Get-Location).Path }
}
if (-not $Dest) {
    if (-not $env:USERPROFILE) { Fail-Parameter 'USERPROFILE is not set and -Dest was not given.' }
    $Dest = Join-Path $env:USERPROFILE '.dsh\.agent-presets'
}

$SourceFull = (Get-AbsolutePath $Source) -replace '[\\/]+$', ''
if (-not (Test-Path -LiteralPath $SourceFull -PathType Container)) {
    Fail-Parameter ('-Source is not an existing directory: ' + $SourceFull)
}
$SourceFull = ((Get-Item -LiteralPath $SourceFull -Force).FullName) -replace '[\\/]+$', ''
if ($SourceFull -match '^[A-Za-z]:$') { Fail-Parameter ('refusing to use a drive root as -Source: ' + $SourceFull) }

$DestFull = (Get-AbsolutePath $Dest) -replace '[\\/]+$', ''
if (Test-Path -LiteralPath $DestFull) {
    if (-not (Test-Path -LiteralPath $DestFull -PathType Container)) {
        Fail-Parameter ('-Dest exists but is not a directory: ' + $DestFull)
    }
    $DestFull = ((Get-Item -LiteralPath $DestFull -Force).FullName) -replace '[\\/]+$', ''
}
if ($DestFull -match '^[A-Za-z]:$') { Fail-Parameter ('refusing to use a drive root as -Dest: ' + $DestFull) }

$srcLow = $SourceFull.ToLowerInvariant()
$dstLow = $DestFull.ToLowerInvariant()
if ($srcLow -eq $dstLow) { Fail-Parameter '-Source and -Dest resolve to the same directory.' }
if ($dstLow.StartsWith($srcLow + '\')) { Fail-Parameter '-Dest is inside -Source; refusing to recurse into itself.' }
if ($srcLow.StartsWith($dstLow + '\')) { Fail-Parameter '-Source is inside -Dest; refusing to recurse into itself.' }

# ---------------------------------------------------------------------------
# discover directory-style presets (a directory containing a marker file)
# ---------------------------------------------------------------------------

$presets = @()
$skipped = @()
foreach ($dir in @(Get-ChildItem -LiteralPath $SourceFull -Directory -Force -ErrorAction Stop | Sort-Object Name)) {
    $isPreset = $false
    foreach ($marker in $PresetMarkers) {
        if (Test-Path -LiteralPath (Join-Path $dir.FullName $marker) -PathType Leaf) { $isPreset = $true }
    }
    if ($isPreset) { $presets += $dir } else { $skipped += $dir.Name }
}
if (@($presets).Count -eq 0) {
    Fail-Parameter ('no directory-style preset found under ' + $SourceFull +
                    ' (a preset directory must contain preset.yml or agent.cordis.yml)')
}

# ---------------------------------------------------------------------------
# header
# ---------------------------------------------------------------------------

Write-Report '===================================================================='
Write-Report 'sync-presets.ps1  :  preset source -> runtime copy, with SHA256 proof'
Write-Report '===================================================================='
Write-Report ('SOURCE   : ' + $SourceFull)
Write-Report ('DEST     : ' + $DestFull)
if ($DryRun) {
    Write-Report 'MODE     : DRY-RUN (nothing will be created, modified or deleted)'
} else {
    Write-Report 'MODE     : SYNC (writes into <DEST>\<id>\ only)'
}
Write-Report ('MIRROR   : ' + $(if ($Mirror) { 'ON (dest-only files inside a preset dir are deleted)' } else { 'off (dest-only files are reported, never deleted)' }))
Write-Report ('PRESETS  : ' + ((@($presets) | ForEach-Object { $_.Name }) -join ', '))
if (@($skipped).Count -gt 0) {
    Write-Report ('SKIPPED  : ' + ($skipped -join ', ') + '   (no preset.yml / agent.cordis.yml)')
}

if (-not (Test-Path -LiteralPath $DestFull -PathType Container)) {
    if ($DryRun) {
        Write-Report ('PLAN     : create dest root ' + $DestFull)
    } else {
        New-Item -ItemType Directory -Path $DestFull -Force -ErrorAction Stop | Out-Null
        Write-Report ('CREATED  : dest root ' + $DestFull)
    }
}

# ---------------------------------------------------------------------------
# per-preset work
# ---------------------------------------------------------------------------

$results = @()
$script:hardErrors = @()
$copiedTotal = 0
$removedTotal = 0

foreach ($preset in @($presets)) {
    $id = $preset.Name
    $srcRoot = $preset.FullName
    $dstRoot = Join-Path $DestFull $id

    Write-Report ''
    Write-Report '--------------------------------------------------------------------'
    Write-Report ('PRESET ' + $id)
    Write-Report ('  src : ' + $srcRoot)
    Write-Report ('  dst : ' + $dstRoot)

    $srcMap = Get-FileHashMap -Root $srcRoot
    $dstMap = Get-FileHashMap -Root $dstRoot
    $pre = Compare-FileMaps -SrcMap $srcMap -DstMap $dstMap

    Write-Report ('  source files    : ' + $srcMap.Count)
    Write-Report ('  dest files      : ' + $dstMap.Count)
    if ((@($pre.Diff).Count + @($pre.SrcOnly).Count + @($pre.DstOnly).Count) -eq 0) {
        Write-Report ('  current state   : ALL IDENTICAL (' + @($pre.Match).Count + ' file(s) with equal SHA256)')
    } else {
        Write-Report '  current state   : DIFFERENCES PRESENT'
    }

    foreach ($rel in @($pre.Diff)) {
        Write-Report ('  DIFF      ' + $rel)
        Write-Report ('              src sha256 = ' + $srcMap[$rel])
        Write-Report ('              dst sha256 = ' + $dstMap[$rel])
    }
    foreach ($rel in @($pre.SrcOnly)) {
        Write-Report ('  SRC-ONLY  ' + $rel + '   sha256=' + $srcMap[$rel])
    }
    foreach ($rel in @($pre.DstOnly)) {
        Write-Report ('  DST-ONLY  ' + $rel + '   sha256=' + $dstMap[$rel])
    }
    foreach ($rel in @($pre.Match)) {
        Write-Verbose ('  MATCH     ' + $rel + '   sha256=' + $srcMap[$rel])
    }

    $needCopy = @($pre.Diff) + @($pre.SrcOnly)
    $didCopy = @()
    $didRemove = @()

    if ($DryRun) {
        if (@($needCopy).Count -gt 0 -and -not (Test-Path -LiteralPath $dstRoot -PathType Container)) {
            Write-Report ('  PLAN      MKDIR  ' + $dstRoot)
        }
        foreach ($rel in @($needCopy)) {
            Write-Report ('  PLAN      COPY   ' + (Join-Path $dstRoot $rel))
        }
        if ($Mirror) {
            foreach ($rel in @($pre.DstOnly)) {
                Write-Report ('  PLAN      REMOVE ' + (Join-Path $dstRoot $rel))
            }
        }
        if ((@($needCopy).Count + @($pre.DstOnly).Count) -eq 0) {
            Write-Report '  PLAN      nothing to do'
        }
        Write-Report '  NOTE      DRY-RUN: no file was created, modified or deleted.'
        $finSrcMap = $srcMap
        $finDstMap = $dstMap
        $fin = $pre
    } else {
        if (@($needCopy).Count -gt 0 -and -not (Test-Path -LiteralPath $dstRoot -PathType Container)) {
            try {
                New-Item -ItemType Directory -Path $dstRoot -Force -ErrorAction Stop | Out-Null
                Write-Report ('  MKDIR     ' + $dstRoot)
            } catch {
                $script:hardErrors += ('MKDIR failed: ' + $dstRoot + ' :: ' + $_.Exception.Message)
                Write-Report ('  MKDIR-FAIL ' + $_.Exception.Message)
            }
        }
        foreach ($rel in @($needCopy)) {
            $srcFile = Join-Path $srcRoot $rel
            $dstFile = Join-Path $dstRoot $rel
            $dstParent = Split-Path -Parent $dstFile
            try {
                if (-not (Test-Path -LiteralPath $dstParent -PathType Container)) {
                    New-Item -ItemType Directory -Path $dstParent -Force -ErrorAction Stop | Out-Null
                }
                Copy-Item -LiteralPath $srcFile -Destination $dstFile -Force -ErrorAction Stop
                $didCopy += $rel
                Write-Report ('  COPIED    ' + $rel)
            } catch {
                $script:hardErrors += ('COPY failed: ' + $id + '\' + $rel + ' :: ' + $_.Exception.Message)
                Write-Report ('  COPY-FAIL ' + $rel + ' :: ' + $_.Exception.Message)
            }
        }
        if ($Mirror) {
            foreach ($rel in @($pre.DstOnly)) {
                $dstFile = Join-Path $dstRoot $rel
                try {
                    Remove-Item -LiteralPath $dstFile -Force -ErrorAction Stop
                    $didRemove += $rel
                    Write-Report ('  REMOVED   ' + $rel)
                } catch {
                    $script:hardErrors += ('REMOVE failed: ' + $id + '\' + $rel + ' :: ' + $_.Exception.Message)
                    Write-Report ('  REMOVE-FAIL ' + $rel + ' :: ' + $_.Exception.Message)
                }
            }
        } elseif (@($pre.DstOnly).Count -gt 0) {
            Write-Report '  NOTE      dest-only file(s) left in place; pass -Mirror to delete them.'
        }

        # re-read BOTH sides from disk: never trust that the copy landed.
        try {
            $finSrcMap = Get-FileHashMap -Root $srcRoot
            $finDstMap = Get-FileHashMap -Root $dstRoot
            $fin = Compare-FileMaps -SrcMap $finSrcMap -DstMap $finDstMap
        } catch {
            $script:hardErrors += ('re-read failed for preset ' + $id + ' :: ' + $_.Exception.Message)
            Write-Report ('  READ-FAIL ' + $_.Exception.Message)
            $finSrcMap = @{}
            $finDstMap = @{}
            $fin = Compare-FileMaps -SrcMap $finSrcMap -DstMap $finDstMap
        }

        $landed = @()
        $notLanded = @()
        foreach ($rel in @($didCopy)) {
            if ($finSrcMap.ContainsKey($rel) -and $finDstMap.ContainsKey($rel) -and $finSrcMap[$rel] -eq $finDstMap[$rel]) {
                $landed += $rel
            } else {
                $notLanded += $rel
            }
        }
        if ((@($didCopy).Count + @($didRemove).Count) -gt 0) {
            Write-Report ('  WROTE     copied=' + @($didCopy).Count +
                          ' landed=' + @($landed).Count +
                          ' removed=' + @($didRemove).Count)
        }
        if (@($notLanded).Count -gt 0) {
            Write-Report ('  !! COPY DID NOT LAND (' + @($notLanded).Count + ' file(s)): ' + ($notLanded -join ', '))
            Write-Report '     a copy reported no error but the bytes on disk did not change'
        }
        Write-Report ('  VERIFY    re-read both sides: identical=' + @($fin.Match).Count +
                      ' differing=' + @($fin.Diff).Count +
                      ' source-only=' + @($fin.SrcOnly).Count +
                      ' dest-only=' + @($fin.DstOnly).Count)
        foreach ($rel in @($fin.Diff)) {
            Write-Report ('  VERIFY-DIFF ' + $rel)
            Write-Report ('              src sha256 = ' + $finSrcMap[$rel])
            Write-Report ('              dst sha256 = ' + $finDstMap[$rel])
        }
        foreach ($rel in @($fin.SrcOnly)) { Write-Report ('  VERIFY-SRC-ONLY ' + $rel) }
        foreach ($rel in @($fin.DstOnly)) { Write-Report ('  VERIFY-DST-ONLY ' + $rel) }
    }

    $results += [pscustomobject]@{
        Id       = $id
        SrcFiles = $finSrcMap.Count
        Match    = @($fin.Match).Count
        Diff     = @($fin.Diff)
        SrcOnly  = @($fin.SrcOnly)
        DstOnly  = @($fin.DstOnly)
        Copied   = @($didCopy).Count
        Removed  = @($didRemove).Count
        SrcMap   = $finSrcMap
        DstMap   = $finDstMap
    }
    $copiedTotal += @($didCopy).Count
    $removedTotal += @($didRemove).Count
}

# ---------------------------------------------------------------------------
# summary
# ---------------------------------------------------------------------------

$sumSrc = 0; $sumMatch = 0; $sumDiff = 0; $sumSrcOnly = 0; $sumDstOnly = 0
Write-Report ''
Write-Report '===================================================================='
Write-Report 'SUMMARY'
foreach ($r in @($results)) {
    $sumSrc += $r.SrcFiles
    $sumMatch += $r.Match
    $sumDiff += @($r.Diff).Count
    $sumSrcOnly += @($r.SrcOnly).Count
    $sumDstOnly += @($r.DstOnly).Count
    Write-Report ('  ' + $r.Id.PadRight(18) +
                  ' src=' + $r.SrcFiles +
                  ' identical=' + $r.Match +
                  ' differing=' + @($r.Diff).Count +
                  ' src-only=' + @($r.SrcOnly).Count +
                  ' dst-only=' + @($r.DstOnly).Count +
                  ' copied=' + $r.Copied +
                  ' removed=' + $r.Removed)
}
Write-Report ''
Write-Report ('  presets scanned : ' + @($results).Count)
Write-Report ('  source files    : ' + $sumSrc)
Write-Report ('  identical       : ' + $sumMatch)
Write-Report ('  differing       : ' + $sumDiff)
Write-Report ('  source-only     : ' + $sumSrcOnly)
Write-Report ('  dest-only       : ' + $sumDstOnly)
Write-Report ('  copied          : ' + $copiedTotal)
Write-Report ('  removed         : ' + $removedTotal)
Write-Report ('  hard errors     : ' + @($script:hardErrors).Count)

$totalProblems = $sumDiff + $sumSrcOnly + $sumDstOnly

if ($totalProblems -gt 0) {
    if ($sumDiff -gt 0) {
        Write-Report ''
        Write-Report 'FILES THAT DIFFER (source vs dest):'
        foreach ($r in @($results)) {
            foreach ($rel in @($r.Diff)) {
                Write-Report ('  DIFF      ' + $r.Id + '\' + $rel)
                Write-Report ('              src sha256 = ' + $r.SrcMap[$rel])
                Write-Report ('              dst sha256 = ' + $r.DstMap[$rel])
            }
        }
    }
    if ($sumSrcOnly -gt 0) {
        Write-Report ''
        Write-Report 'FILES ONLY IN SOURCE (missing from the runtime copy):'
        foreach ($r in @($results)) {
            foreach ($rel in @($r.SrcOnly)) {
                Write-Report ('  SRC-ONLY  ' + $r.Id + '\' + $rel + '   sha256=' + $r.SrcMap[$rel])
            }
        }
    }
    if ($sumDstOnly -gt 0) {
        Write-Report ''
        Write-Report 'FILES ONLY IN DEST (stale entries in the runtime copy):'
        foreach ($r in @($results)) {
            foreach ($rel in @($r.DstOnly)) {
                Write-Report ('  DST-ONLY  ' + $r.Id + '\' + $rel + '   sha256=' + $r.DstMap[$rel])
            }
        }
    }
}

if (@($script:hardErrors).Count -gt 0) {
    Write-Report ''
    Write-Report 'HARD ERRORS:'
    foreach ($e in @($script:hardErrors)) { Write-Report ('  ' + $e) }
    Write-Report ''
    Write-Report ('RESULT: ABORTED - ' + @($script:hardErrors).Count + ' read/write/copy error(s) (exit 2)')
    exit 2
}

if ($totalProblems -gt 0) {
    Write-Report ''
    if ($DryRun) {
        Write-Report ('RESULT: ' + $totalProblems + ' DIFFERENCE(S) - DRY-RUN, nothing was written (exit 1)')
    } else {
        Write-Report ('RESULT: ' + $totalProblems + ' DIFFERENCE(S) REMAIN after sync (exit 1)')
        if ($sumDstOnly -gt 0 -and -not $Mirror) {
            Write-Report '        dest-only file(s) are not removed unless -Mirror is given.'
        }
    }
    exit 1
}

Write-Report ''
if ($DryRun) {
    Write-Report 'RESULT: ALL IDENTICAL - source and runtime copy already agree byte-for-byte (exit 0)'
} else {
    Write-Report 'RESULT: ALL IDENTICAL - source and runtime copy agree byte-for-byte (exit 0)'
}
exit 0
