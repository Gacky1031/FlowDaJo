$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
if (Test-Path "$env:USERPROFILE\.cargo\bin") { $env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH" }
npm.cmd ci
if ($LASTEXITCODE) { exit $LASTEXITCODE }
npm.cmd run tauri build
exit $LASTEXITCODE
