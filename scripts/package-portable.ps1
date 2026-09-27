param(
  [switch]$SkipArchive,
  [string]$DestinationPath,
  [string]$ArchivePath
)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$destination = if ($DestinationPath) { $DestinationPath } else { Join-Path (Get-Location) 'release\FlowDaJo-0.4.0' }
$destination = [System.IO.Path]::GetFullPath($destination)
New-Item -ItemType Directory -Path (Join-Path $destination 'r') -Force | Out-Null
Copy-Item -LiteralPath 'src-tauri\target\release\flowdesk-tauri.exe' -Destination (Join-Path $destination 'FlowDaJo.exe') -Force
Copy-Item -LiteralPath 'r\core.R','r\worker.R','r\worksheet.R','r\diva.R' -Destination (Join-Path $destination 'r') -Force
Copy-Item -LiteralPath 'src-tauri\runtime\WebView2Loader.dll','README.md' -Destination $destination -Force
New-Item -ItemType Directory -Path (Join-Path $destination 'runtime') -Force | Out-Null
foreach ($folder in @('R','WebView2','sources')) {
  Copy-Item -LiteralPath (Join-Path 'src-tauri\runtime' $folder) -Destination (Join-Path $destination 'runtime') -Recurse -Force
}
Copy-Item -LiteralPath 'src-tauri\runtime\r-manifest.json','src-tauri\runtime\THIRD-PARTY-NOTICES.md' -Destination (Join-Path $destination 'runtime') -Force
New-Item -ItemType Directory -Path (Join-Path $destination 'docs') -Force | Out-Null
Copy-Item -LiteralPath 'docs\ARCHITECTURE.md','docs\VALIDATION-0.4.0.md','docs\UI-INTERACTION.md' -Destination (Join-Path $destination 'docs') -Force
if (-not $SkipArchive) {
  $archive = if ($ArchivePath) { $ArchivePath } else { Join-Path (Get-Location) 'release\FlowDaJo-0.4.0-windows-x64-bundled.zip' }
  $archive = [System.IO.Path]::GetFullPath($archive)
  Compress-Archive -LiteralPath $destination -DestinationPath $archive -Force
  Get-FileHash $archive -Algorithm SHA256

}
