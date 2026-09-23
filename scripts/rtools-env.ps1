# Process-local environment only; does not change the existing Rtools installation.
$ErrorActionPreference = 'Stop'
$rtoolsBin = 'C:\rtools45\x86_64-w64-mingw32.static.posix\bin'
if (-not (Test-Path "$rtoolsBin\gcc.exe")) { throw 'Rtools45 not found. Use the standard MSVC build script instead.' }
$env:PATH = "$env:USERPROFILE\.cargo\bin;$rtoolsBin;$env:PATH"
$env:RUSTUP_TOOLCHAIN = 'stable-x86_64-pc-windows-gnu'
$env:RUSTFLAGS = '-C link-self-contained=yes'
$rustRoot = (& rustc.exe --print sysroot).Trim()
if ($LASTEXITCODE) { throw 'Install the GNU toolchain with: rustup toolchain install stable-x86_64-pc-windows-gnu --profile minimal' }
$env:LIBRARY_PATH = Join-Path $rustRoot 'lib\rustlib\x86_64-pc-windows-gnu\lib\self-contained'
$env:CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER = "$rtoolsBin\gcc.exe"
