param(
  [string]$Version,
  [switch]$SkipArchive,
  [string]$DestinationPath,
  [string]$ArchivePath
)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$configuredVersion = (Get-Content 'src-tauri\tauri.conf.json' -Raw | ConvertFrom-Json).version
if (-not $Version) { $Version = $configuredVersion }
if ($Version -ne $configuredVersion) { throw 'Version must match the current application build.' }
$root = (Get-Location).Path
if ($Version -notmatch '^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$') { throw 'Invalid release version.' }
$releaseDirectory = Join-Path $root "release\$Version"
New-Item -ItemType Directory -Path $releaseDirectory -Force | Out-Null
$destination = if ($DestinationPath) { $DestinationPath } else { Join-Path $root "artifacts\packaging\$Version\FlowDaJo-$Version" }
$destination = [System.IO.Path]::GetFullPath($destination)
if (Test-Path -LiteralPath $destination) {
  if ($DestinationPath) { throw 'DestinationPath must be a new folder. Choose an empty staging location.' }
  $stagingRoot = [System.IO.Path]::GetFullPath((Join-Path $root 'artifacts\packaging')) + [System.IO.Path]::DirectorySeparatorChar
  $backup = [System.IO.Path]::GetFullPath((Join-Path $root "artifacts\archive\packaging\$Version-$(Get-Date -Format 'yyyyMMdd-HHmmss')-$([guid]::NewGuid().ToString('N').Substring(0,8))"))
  if (-not $destination.StartsWith($stagingRoot, [System.StringComparison]::OrdinalIgnoreCase) -or -not $backup.StartsWith($root + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Staging path escaped the workspace.' }
  New-Item -ItemType Directory -Path (Split-Path $backup -Parent) -Force | Out-Null
  Move-Item -LiteralPath $destination -Destination $backup
}
New-Item -ItemType Directory -Path (Join-Path $destination 'r') -Force | Out-Null
Copy-Item -LiteralPath 'src-tauri\target\release\flowdesk-tauri.exe' -Destination (Join-Path $destination 'FlowDaJo.exe') -Force
Copy-Item -LiteralPath 'r\core.R','r\worker.R','r\worksheet.R','r\diva.R' -Destination (Join-Path $destination 'r') -Force
Copy-Item -LiteralPath 'src-tauri\runtime\WebView2Loader.dll','README.md','LICENSE' -Destination $destination -Force
New-Item -ItemType Directory -Path (Join-Path $destination 'runtime') -Force | Out-Null
foreach ($folder in @('R','WebView2','sources')) {
  Copy-Item -LiteralPath (Join-Path 'src-tauri\runtime' $folder) -Destination (Join-Path $destination 'runtime') -Recurse -Force
}
Copy-Item -LiteralPath 'src-tauri\runtime\r-manifest.json','src-tauri\runtime\THIRD-PARTY-NOTICES.md' -Destination (Join-Path $destination 'runtime') -Force
New-Item -ItemType Directory -Path (Join-Path $destination 'docs') -Force | Out-Null
Copy-Item -LiteralPath 'docs\ARCHITECTURE.md',"docs\VALIDATION-$Version.md",'docs\UI-INTERACTION.md','docs\RELEASING.md' -Destination (Join-Path $destination 'docs') -Force
New-Item -ItemType Directory -Path (Join-Path $destination 'docs\releases') -Force | Out-Null
Copy-Item -LiteralPath "docs\releases\$Version.md" -Destination (Join-Path $destination 'docs\releases') -Force
if (-not $SkipArchive) {
  $archive = if ($ArchivePath) { $ArchivePath } else { Join-Path $releaseDirectory "FlowDaJo-$Version-windows-x64-portable.zip" }
  $archive = [System.IO.Path]::GetFullPath($archive)
  Compress-Archive -LiteralPath $destination -DestinationPath $archive -Force
  Get-FileHash $archive -Algorithm SHA256

}
Write-Host "Staging: $destination"
Write-Host "Distribution: $releaseDirectory"
