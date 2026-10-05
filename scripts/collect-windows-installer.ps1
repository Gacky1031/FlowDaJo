$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$config = Get-Content (Join-Path $root 'src-tauri\tauri.conf.json') -Raw | ConvertFrom-Json
$version = $config.version
if ($version -notmatch '^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$') { throw 'Invalid release version.' }
$source = Join-Path $root "src-tauri\target\release\bundle\nsis\$($config.productName)_${version}_x64-setup.exe"
if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Installer not found: $source" }
$destination = Join-Path $root "release\$version"
New-Item -ItemType Directory -Path $destination -Force | Out-Null
Copy-Item -LiteralPath $source -Destination (Join-Path $destination "FlowDaJo-$version-windows-x64-setup.exe") -Force
$bundleDirectory = [System.IO.Path]::GetFullPath((Split-Path $source -Parent))
$pattern = '^' + [regex]::Escape($config.productName) + '_\d+\.\d+\.\d+_x64-setup\.exe$'
$previousInstallers = @(Get-ChildItem -LiteralPath $bundleDirectory -File | Where-Object { $_.Name -match $pattern -and $_.FullName -ne $source })
if ($previousInstallers.Count) {
  $archive = [System.IO.Path]::GetFullPath((Join-Path $root "artifacts\archive\build-bundles\windows\$(Get-Date -Format 'yyyyMMdd-HHmmss')-$([guid]::NewGuid().ToString('N').Substring(0,8))"))
  if (-not $archive.StartsWith($root + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Archive escaped the workspace.' }
  foreach ($installer in $previousInstallers) {
    if (-not $installer.FullName.StartsWith($bundleDirectory + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Installer escaped the build folder.' }
  }
  New-Item -ItemType Directory -Path $archive -Force | Out-Null
  foreach ($installer in $previousInstallers) { Move-Item -LiteralPath $installer.FullName -Destination (Join-Path $archive $installer.Name) }
}
Write-Host "Installer: $destination\FlowDaJo-$version-windows-x64-setup.exe"
