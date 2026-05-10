# Codex Nexus - PowerShell 启动脚本
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host ""
Write-Host "  Codex Nexus 启动中..." -ForegroundColor Cyan
Write-Host ""

# Check Node.js
if (!(Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "  [错误] 未找到 Node.js，请先安装: https://nodejs.org" -ForegroundColor Red
    Write-Host ""
    Read-Host "按回车退出"
    exit 1
}

node server.js

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "  [错误] 启动失败" -ForegroundColor Red
    Read-Host "按回车退出"
}
