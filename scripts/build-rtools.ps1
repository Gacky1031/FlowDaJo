Set-Location (Split-Path $PSScriptRoot -Parent)
. "$PSScriptRoot\rtools-env.ps1"
npm.cmd run tauri build
if ($LASTEXITCODE) { exit $LASTEXITCODE }
& "$PSScriptRoot\collect-windows-installer.ps1"
