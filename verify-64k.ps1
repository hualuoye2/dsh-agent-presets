<#
.SYNOPSIS
  端到端证明：64 KB preset 那一臂能收到完整的 AGENTS.md。

.DESCRIPTION
  字节算术（「文件低于 65,200 字节红线」）不是证明；只有真实挂载的会话才是。
  本脚本在自己的端口上启动一个临时 `dsh web` 实例，对它跑两臂，然后自行清理。

    臂 1 - 对照/故障注入：budget-ab.mjs 把一个 88,046 字节的探针 AGENTS.md 指向
            该实例，断言 preset `standard` 确实截断它（尾部标记缺失），而
            `standard-128k` 不截断。一个测不出截断的探针，对「没有截断」零证明力。
    臂 2 - 待验断言：check-64k-arm.mjs 把真实的 D:\deepseek\AGENTS.md 挂到 preset
            `standard` 下，断言：头部针存在、TAIL 针（第 9 段，最后一段）存在、
            截断提示计数为 0。

  退出码：0 = 两臂都 PASS 且清理已验证；1 = 某臂 FAIL（内容判定）；2 = 量具失败
  （端口占用、拿不到 token、夹具缺失、GUI 端口丢了）。刻意区分 1 和 2：
  「运行器坏了」与「内容不对」绝不能长得一样（AGENTS.md docMarker exitcode-vs-reason）。

  本文件是 UTF-8（无 BOM）且含中文注释 —— 只能由 pwsh 7 执行。

.PARAMETER Port
  临时实例的端口。必须是 19399：budget-ab.mjs 硬编码了这个 base URL，所以脚本
  拒绝其他值，而不是稍后以令人困惑的方式失败。

.PARAMETER GuiPort
  本脚本结束时必须仍在监听的端口（用户的 GUI）。默认 0 = 从最新看门狗心跳的
  PID 解析：DSH 0.2.1-rc.2 起桌面 GUI 端口是 ephemeral（host 用 --port 0 启动），
  所以它不能再是字面默认值。

.PARAMETER WaitSeconds
  等待实例打印 token URL 并占用端口的时间。

.EXAMPLE
  pwsh -NoProfile -ExecutionPolicy Bypass -File D:\deepseek\.agent-presets\verify-64k.ps1
#>
[CmdletBinding()]
param(
  [int]$Port = 19399,
  [int]$GuiPort = 0,
  [int]$WaitSeconds = 90,
  [string]$Scratch = 'D:\deepseek\_quarantine\verify-64k'
)

$ErrorActionPreference = 'Stop'
$PresetRoot = 'D:\deepseek\.agent-presets'

# Port ownership via netstat, never the process table: the CIM-based cmdlets give false
# "not running" answers inside this sandbox, and netstat is an external exe whose table is
# complete. Same helper as dsh-watchdog\tools\restart-dsh.ps1.
function Get-PortOwner([int]$p) {
  $rows = @(netstat -ano 2>$null | Select-String -Pattern 'LISTENING' | Select-String -Pattern ":$p\s")
  if ($rows.Count -eq 0) { return 0 }
  $parts = @(($rows[0].Line -split '\s+') | Where-Object { $_ -ne '' })
  return [int]$parts[-1]
}

# The desktop GUI port is ephemeral since DSH 0.2.1-rc.2 (the host starts with
# --port 0), so no literal port can identify it. Resolve it from the newest
# watchdog heartbeat PID and that PID's loopback LISTENING row; 0 = not found.
function Resolve-GuiPort {
  $hbDir = Join-Path $env:USERPROFILE '.dsh\watchdog'
  if (-not (Test-Path -LiteralPath $hbDir)) { return 0 }
  $bestPid = 0
  $bestAt = -1.0
  foreach ($f in @(Get-ChildItem -LiteralPath $hbDir -File -Filter 'heartbeat-*.json' -ErrorAction SilentlyContinue)) {
    try { $h = Get-Content -LiteralPath $f.FullName -Raw -Encoding UTF8 | ConvertFrom-Json } catch { continue }
    if ($null -eq $h -or $null -eq $h.pid -or $null -eq $h.at) { continue }
    if ([double]$h.at -gt $bestAt) { $bestAt = [double]$h.at; $bestPid = [int]$h.pid }
  }
  if ($bestPid -eq 0) { return 0 }
  foreach ($row in @(netstat -ano 2>$null)) {
    $s = ([string]$row).Trim()
    if ($s -notmatch 'LISTENING') { continue }
    $parts = @($s -split '\s+')
    if ($parts.Count -lt 5) { continue }
    if ($parts[-1] -ne [string]$bestPid) { continue }
    if ($parts[1] -match '^127\.0\.0\.1:(\d+)$') { return [int]$Matches[1] }
  }
  return 0
}

# NOTE: the parameter is $procId, not $pid -- $PID is a read-only automatic variable in
# PowerShell, and shadowing it either errors out or silently does the wrong thing.
function Stop-Tree([int]$procId) {
  if ($procId -le 0) { return }
  & taskkill /F /T /PID $procId 2>&1 | Out-Null
}

function Resolve-Node {
  $c = Get-Command node -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  $guess = Join-Path $env:USERPROFILE '.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
  if (Test-Path -LiteralPath $guess) { return $guess }
  return $null
}

Write-Host '======== 64 KB arm, end to end ========'
Write-Host ''

# ---- preconditions: fail as INSTRUMENT (2), not as content (1) ------------------------
if ($Port -ne 19399) {
  Write-Host "INSTRUMENT-FAIL: -Port must be 19399 (budget-ab.mjs hard-codes that base URL)"
  exit 2
}
$node = Resolve-Node
if (-not $node) { Write-Host 'INSTRUMENT-FAIL: node not found'; exit 2 }
Write-Host "  node            = $node"

foreach ($f in @('budget-ab.mjs', 'check-64k-arm.mjs', 'web-verify.overlay.yml')) {
  $p = Join-Path $PresetRoot $f
  if (-not (Test-Path -LiteralPath $p)) { Write-Host "INSTRUMENT-FAIL: missing $p"; exit 2 }
}

$fixture = Join-Path $PresetRoot '_budget-probe\AGENTS.md'
if (-not (Test-Path -LiteralPath $fixture)) {
  Write-Host "INSTRUMENT-FAIL: control fixture missing: $fixture"
  Write-Host '  It is regenerable; the rebuild snippet is in the header of check-64k-arm.mjs.'
  exit 2
}
$fixtureBytes = (Get-Item -LiteralPath $fixture).Length
Write-Host "  control fixture = $fixtureBytes bytes"

$owner = Get-PortOwner $Port
if ($owner -ne 0) {
  Write-Host "INSTRUMENT-FAIL: port $Port is already owned by PID $owner; refusing to reuse it"
  exit 2
}
$guiOwner = 0
if ($GuiPort -eq 0) { $GuiPort = Resolve-GuiPort }
if ($GuiPort -eq 0) {
  Write-Host '  WARN: no live DSH GUI found (GUI port is ephemeral since 0.2.1); the GUI-survival check will be skipped'
} else {
  $guiOwner = Get-PortOwner $GuiPort
  if ($guiOwner -eq 0) { Write-Host "  WARN: GUI port $GuiPort is not listening (not fatal)" }
  else { Write-Host "  GUI port        = $GuiPort owned by PID $guiOwner (must survive)" }
}

New-Item -ItemType Directory -Force -Path $Scratch | Out-Null
$outLog = Join-Path $Scratch 'instance.out.txt'
$errLog = Join-Path $Scratch 'instance.err.txt'
Remove-Item -LiteralPath $outLog, $errLog -Force -ErrorAction SilentlyContinue

$exitCode = 2
$started = $null
try {
  Write-Host ''
  Write-Host "---- starting temporary instance on port $Port ----"
  $cmdLine = "dsh --profile web --patch `"$PresetRoot\web-verify.overlay.yml`" --port $Port --no-open"
  $started = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', $cmdLine) `
    -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru -WindowStyle Hidden

  $token = ''
  $deadline = (Get-Date).AddSeconds($WaitSeconds)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 800
    if (Test-Path -LiteralPath $outLog) {
      $txt = Get-Content -LiteralPath $outLog -Raw -ErrorAction SilentlyContinue
      if ($txt) {
        $m = [regex]::Match($txt, 'token=([A-Za-z0-9_\-]+)')
        if ($m.Success) { $token = $m.Groups[1].Value }
      }
    }
    if ($token -and (Get-PortOwner $Port) -ne 0) { break }
  }

  if (-not $token) {
    Write-Host "INSTRUMENT-FAIL: no token within $WaitSeconds s"
    if (Test-Path -LiteralPath $outLog) { Get-Content -LiteralPath $outLog -Tail 6 | ForEach-Object { "    out| $_" } }
    if (Test-Path -LiteralPath $errLog) { Get-Content -LiteralPath $errLog -Tail 6 | ForEach-Object { "    err| $_" } }
    $exitCode = 2
  }
  else {
    $instOwner = Get-PortOwner $Port
    Write-Host "  token acquired, port $Port owned by PID $instOwner"

    $arms = @(
      @{ label = 'ARM 1 control (88,046-byte probe file MUST truncate under standard)'; file = 'budget-ab.mjs' },
      @{ label = 'ARM 2 claim (real AGENTS.md under standard must arrive whole)';       file = 'check-64k-arm.mjs' }
    )
    $failed = 0
    $results = @()
    foreach ($arm in $arms) {
      Write-Host ''
      Write-Host "---- $($arm.label) ----"
      & $node (Join-Path $PresetRoot $arm.file) $token
      $armRc = $LASTEXITCODE
      # Keep each arm's own exit code: printing one shared variable is how a report ends up
      # showing the same number twice while one arm actually failed.
      $results += [pscustomobject]@{ File = $arm.file; Rc = $armRc }
      Write-Host "  [$($arm.file) exit=$armRc]"
      if ($armRc -ne 0) { $failed++ }
    }

    Write-Host ''
    Write-Host '======== verdict ========'
    foreach ($r in $results) { Write-Host ('  ' + $r.File.PadRight(22) + ' exit=' + $r.Rc) }
    $exitCode = if ($failed -eq 0) { 0 } else { 1 }
  }
}
finally {
  Write-Host ''
  Write-Host '---- cleanup ----'
  $own = Get-PortOwner $Port
  if ($own -ne 0) {
    Stop-Tree $own
    $t = (Get-Date).AddSeconds(15)
    while ((Get-Date) -lt $t -and (Get-PortOwner $Port) -ne 0) { Start-Sleep -Milliseconds 500 }
  }
  $still = Get-PortOwner $Port
  if ($still -ne 0) {
    Write-Host "  CLEANUP-FAIL: port $Port still owned by PID $still"
    $exitCode = 2
  } else {
    Write-Host "  port $Port released"
  }
  if ($GuiPort -ne 0) {
    $gui = Get-PortOwner $GuiPort
    if ($gui -eq 0) {
      Write-Host "  GUI-FAIL: port $GuiPort is no longer listening"
      $exitCode = 2
    } else {
      Write-Host "  GUI port $GuiPort still owned by PID $gui"
    }
  } else {
    Write-Host '  GUI check skipped (no live DSH GUI was found before the run)'
  }
  if ($started -and -not $started.HasExited) {
    Stop-Tree $started.Id
    Write-Host "  launcher PID $($started.Id) stopped"
  }
  Write-Host "  logs: $Scratch"
}

if ($exitCode -eq 0) { Write-Host ''; Write-Host 'RESULT: PASS (both arms PASS, cleanup verified)' }
elseif ($exitCode -eq 1) { Write-Host ''; Write-Host 'RESULT: FAIL (an arm failed - see the arm output above)' }
else { Write-Host ''; Write-Host 'RESULT: INSTRUMENT-FAIL (2) - the runner, not the content' }
exit $exitCode
