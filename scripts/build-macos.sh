#!/usr/bin/env bash
set -Eeuo pipefail

die() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

info() {
  printf '\n==> %s\n' "$*"
}

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

[[ "$(uname -s)" == "Darwin" ]] || die "このスクリプトはmacOS上で実行してください。"

if ! command -v brew >/dev/null 2>&1; then
  die "Homebrewが見つかりません。https://brew.sh/ からHomebrewを導入して、もう一度実行してください。"
fi

if ! xcode-select -p >/dev/null 2>&1; then
  printf 'Xcode Command Line Toolsをインストールします。表示されるダイアログを完了後、再実行してください。\n'
  xcode-select --install || true
  exit 1
fi

# Some Command Line Tools releases keep libc++ headers only inside the SDK.
SDK_ROOT="$(xcrun --show-sdk-path)"
if [[ -f "$SDK_ROOT/usr/include/c++/v1/cstdio" ]]; then
  export CPLUS_INCLUDE_PATH="$SDK_ROOT/usr/include/c++/v1${CPLUS_INCLUDE_PATH:+:$CPLUS_INCLUDE_PATH}"
fi

info "Build dependencies"
for formula in node@22 r pkg-config; do
  if ! brew list --versions "$formula" >/dev/null 2>&1; then
    brew install "$formula"
  fi
done

# node@22 is keg-only on some Homebrew installations, so add its bin directory
# for this build without changing the user's global PATH.
NODE_PREFIX="$(brew --prefix node@22)"
R_PREFIX="$(brew --prefix r)"
export PATH="$NODE_PREFIX/bin:$R_PREFIX/bin:$HOME/.cargo/bin:$PATH"

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[[ "$NODE_MAJOR" == "22" ]] || die "Node.js 22が必要です (現在: $(node --version))。"

if ! command -v rustup >/dev/null 2>&1; then
  command -v curl >/dev/null 2>&1 || die "curlが見つかりません。"
  info "Installing Rust stable with rustup"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable
  export PATH="$HOME/.cargo/bin:$PATH"
fi

command -v rustup >/dev/null 2>&1 || die "rustupをインストールできませんでした。"
rustup toolchain install stable --profile minimal
export RUSTUP_TOOLCHAIN=stable

command -v Rscript >/dev/null 2>&1 || die "Rscriptが見つかりません。HomebrewのRを確認してください。"
[[ "$(command -v Rscript)" == "$R_PREFIX/bin/Rscript" ]] || die "HomebrewのRscriptを選択できませんでした。"

info "Toolchain"
printf 'Architecture: %s\n' "$(uname -m)"
printf 'Node.js: %s\n' "$(node --version)"
rustc --version
Rscript --version

info "Installing JavaScript dependencies"
npm ci

info "Installing R packages required by FlowDaJo"
Rscript scripts/setup-r.R

info "Staging the self-contained R/flowCore runtime"
Rscript scripts/stage-r-runtime.R
# Homebrew ships some headers read-only; Tauri copies resources into target/
# and must be able to replace those copies on the next build.
chmod -R u+w "$ROOT/src-tauri/runtime/R"
for copied_runtime in "$ROOT/src-tauri/target/debug/runtime/R" "$ROOT/src-tauri/target/release/runtime/R"; do
  if [[ -d "$copied_runtime" ]]; then chmod -R u+w "$copied_runtime"; fi
done
python3 scripts/relocate-macos-r.py "$ROOT/src-tauri/runtime/R" "$(Rscript -e 'cat(R.home())')"
python3 scripts/smoke-macos-runtime.py "$ROOT/src-tauri/runtime"

info "Testing the native R worker"
cargo test --manifest-path src-tauri/Cargo.toml --quiet

info "Building the native macOS DMG"
R_MIN_MACOS="$(otool -l "$ROOT/src-tauri/runtime/R/bin/exec/R" | awk '/cmd LC_BUILD_VERSION/ { field="minos"; next } /cmd LC_VERSION_MIN_MACOSX/ { field="version"; next } field != "" && $1 == field { print $2; exit }')"
[[ "$R_MIN_MACOS" =~ ^[0-9]+\.[0-9]+$ ]] || die "同梱RのmacOS最小バージョンを確認できませんでした。"
printf 'Minimum macOS version required by bundled R: %s\n' "$R_MIN_MACOS"
npm run tauri build -- --config src-tauri/tauri.macos.conf.json --config "{\"bundle\":{\"macOS\":{\"minimumSystemVersion\":\"$R_MIN_MACOS\"}}}"

DMG_DIR="$ROOT/src-tauri/target/release/bundle/dmg"
shopt -s nullglob
DMGS=("$DMG_DIR"/*.dmg)
(( ${#DMGS[@]} > 0 )) || die "ビルドは終了しましたがDMGが見つかりません: $DMG_DIR"

info "Verifying the R runtime inside the DMG"
MOUNT_POINT="$(mktemp -d "${TMPDIR:-/tmp}/flowdajo-dmg.XXXXXX")"
cleanup_mount() {
  hdiutil detach "$MOUNT_POINT" -quiet >/dev/null 2>&1 || true
  rmdir "$MOUNT_POINT" 2>/dev/null || true
}
trap cleanup_mount EXIT
hdiutil attach -readonly -nobrowse -quiet -mountpoint "$MOUNT_POINT" "${DMGS[0]}"
python3 scripts/smoke-macos-runtime.py "$MOUNT_POINT/FlowDaJo.app/Contents/Resources/runtime"
cleanup_mount
trap - EXIT

info "Build complete"
printf 'DMG output:\n'
for dmg in "${DMGS[@]}"; do
  ls -lh "$dmg"
done
printf '\nこのMacのCPU向けビルドです。配布用の署名・公証はこのスクリプトでは行いません。\n'
