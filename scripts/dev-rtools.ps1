Set-Location (Split-Path $PSScriptRoot -Parent)
. "$PSScriptRoot\rtools-env.ps1"
npm.cmd run tauri dev
