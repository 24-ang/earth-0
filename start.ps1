<#
.SYNOPSIS
  earth-0 启动脚本 — 新会话模式（每次都是干净的）
  传 -continue 可继续上次会话
#>
param([switch]$Continue)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " earth-0" -ForegroundColor Yellow -NoNewline
if ($Continue) { Write-Host " (继续上次会话)" -ForegroundColor Green }
else { Write-Host " (新会话)" -ForegroundColor Green }
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# ── 新会话：清 sessions / state ──
if (-not $Continue) {
  if (Test-Path sessions) { Remove-Item -Recurse -Force sessions -ErrorAction SilentlyContinue }
  $null = New-Item -ItemType Directory sessions -Force
  if (Test-Path state) { Remove-Item -Recurse -Force state -ErrorAction SilentlyContinue }
} else {
  if (-not (Test-Path sessions)) { $null = New-Item -ItemType Directory sessions -Force }
  if (Test-Path state) { Remove-Item -Recurse -Force state -ErrorAction SilentlyContinue }
}

# ── .pi/agent 本地配置 ──
$piAgentDir = ".pi/agent"
if (-not (Test-Path $piAgentDir)) { $null = New-Item -ItemType Directory $piAgentDir -Force }
if ((-not (Test-Path "$piAgentDir/auth.json")) -and (Test-Path "$env:USERPROFILE\.pi\agent\auth.json")) {
  Copy-Item "$env:USERPROFILE\.pi\agent\auth.json" "$piAgentDir/auth.json"
}
if (-not (Test-Path "$piAgentDir/settings.json")) {
  Set-Content "$piAgentDir/settings.json" -Value '{ "theme": "dark" }' -Encoding utf8
}

# ── env ──
$env:PI_CODING_AGENT_DIR = ".pi/agent"
if ((-not $env:DEEPSEEK_API_KEY) -and $env:ANTHROPIC_AUTH_TOKEN) {
  $env:DEEPSEEK_API_KEY = $env:ANTHROPIC_AUTH_TOKEN
}

# ── 启动 ──
$nodeArgs = @(
  ".\pi\pi-agent\dist\cli.js",
  "--no-skills",
  "--skill", "./skills/",
  "-e", "./extension.ts",
  "--session-dir", "./sessions",
  "--no-context-files"
) + $args

& node @nodeArgs
$piExit = $LASTEXITCODE

Write-Host ""
Write-Host "================================================" -ForegroundColor DarkGray
Write-Host "tips: delete .pi/agent/auth.json, sessions/, state/ before sharing this project." -ForegroundColor DarkGray
Write-Host "================================================" -ForegroundColor DarkGray

exit $piExit
