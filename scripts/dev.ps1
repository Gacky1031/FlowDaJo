$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
if (Test-Path "$env:USERPROFILE\.cargo\bin") { $env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH" }
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) { throw 'Rust MSVC toolchain is required. See README.' }
if (-not (Test-Path node_modules)) { npm.cmd ci; if ($LASTEXITCODE) { exit $LASTEXITCODE } }
npm.cmd run tauri dev
