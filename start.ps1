param([int]$Port = 7310, [string]$DataDirectory, [string]$Workspace)
$ErrorActionPreference = 'Stop'
$monitorPython = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $monitorPython)) {
    throw '请先按 README 安装独立服务环境，或在已安装的环境运行 runboard serve。'
}
$monitorLocalPath = Join-Path $PSScriptRoot '.runboard-local.json'
$monitorLocal = if (Test-Path -LiteralPath $monitorLocalPath) { Get-Content -LiteralPath $monitorLocalPath -Raw | ConvertFrom-Json } else { $null }
if (-not $DataDirectory) { $DataDirectory = if ($env:RUNBOARD_HOME) { $env:RUNBOARD_HOME } elseif ($monitorLocal.home) { Join-Path $PSScriptRoot $monitorLocal.home } else { Join-Path ([Environment]::GetFolderPath('UserProfile')) '.runboard' } }
if (-not $Workspace) { $Workspace = if ($monitorLocal.workspace) { Join-Path $PSScriptRoot $monitorLocal.workspace } else { $PSScriptRoot } }
$monitorData = [IO.Path]::GetFullPath($DataDirectory)
$monitorWorkspace = [IO.Path]::GetFullPath($Workspace)
& $monitorPython -u -m runboard.cli --home $monitorData serve --workspace $monitorWorkspace --port $Port
