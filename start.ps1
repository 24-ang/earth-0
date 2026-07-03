<#
.SYNOPSIS
  earth-0 启动脚本 (PowerShell 5.1 兼容)
#>
param()

$ErrorActionPreference = "Stop"

# ── 检查 pi ──
$piPath = (Get-Command pi -ErrorAction SilentlyContinue).Source
if (-not $piPath) {
  Write-Error "pi not installed. https://github.com/earendil-works/pi-coding-agent"
  exit 1
}

# ── 项目根 ──
Set-Location $PSScriptRoot

# ── sessions/ ──
if (-not (Test-Path sessions)) { New-Item -ItemType Directory sessions -Force | Out-Null }

# ── 清旧存档 ──
if (Test-Path state) {
  Get-ChildItem state -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
}

# ── .pi/agent/ ──
$piAgentDir = ".pi/agent"
if (-not (Test-Path $piAgentDir)) { New-Item -ItemType Directory $piAgentDir -Force | Out-Null }

if ((-not (Test-Path "$piAgentDir/auth.json")) -and (Test-Path "$env:USERPROFILE\.pi\agent\auth.json")) {
  Copy-Item "$env:USERPROFILE\.pi\agent\auth.json" "$piAgentDir/auth.json"
}

if (-not (Test-Path "$piAgentDir/settings.json")) {
  Set-Content "$piAgentDir/settings.json" -Value '{ "theme": "dark" }' -Encoding utf8
}

# ── disable builtins (skip if ConvertFrom-Json fails) ──
$dev = ($env:TAVERN2AGENT_DEV -eq "1")
$settingsPath = "$piAgentDir/settings.json"
try {
  $raw = Get-Content $settingsPath -Raw -Encoding utf8
  $settings = $raw | ConvertFrom-Json
  $sub = $settings.subagents
  if (-not $sub) { $sub = [PSCustomObject]@{} }
  $sub | Add-Member -MemberType NoteProperty -Name "disableBuiltins" -Value (-not $dev) -Force
  $settings | Add-Member -MemberType NoteProperty -Name "subagents" -Value $sub -Force
  $settings | ConvertTo-Json -Depth 3 | Set-Content $settingsPath -Encoding utf8
} catch {
  Write-Host "settings.json fix skipped: $($_.Exception.Message)"
}

# ── env ──
$env:PI_CODING_AGENT_DIR = ".pi/agent"
if ((-not $env:DEEPSEEK_API_KEY) -and $env:ANTHROPIC_AUTH_TOKEN) {
  $env:DEEPSEEK_API_KEY = $env:ANTHROPIC_AUTH_TOKEN
}

# ── launch ──
$piArgs = @(
  "--no-skills",
  "--skill", "./skills/",
  "-e", "./extension.ts",
  "--session-dir", "./sessions",
  "--no-context-files"
) + $args

& $piPath @piArgs
$piExit = $LASTEXITCODE

Write-Host ""
Write-Host "================================================"
Write-Host "tips: delete .pi/agent/auth.json, sessions/, state/ before sharing this project."
Write-Host "================================================"

exit $piExit
