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

info "Build dependencies"
for formula in node@22 r pkg-config; do
  if ! brew list --versions "$formula" >/dev/null 2>&1; then
    brew install "$formula"
  fi
done

# node@22 is keg-only on some Homebrew installations, so add its bin directory
# for this build without changing the user's global PATH.
NODE_PREFIX="$(brew --prefix node@22)"
export PATH="$NODE_PREFIX/bin:$HOME/.cargo/bin:$PATH"

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

info "Building the native macOS DMG"
npm run tauri build -- --config src-tauri/tauri.macos.conf.json

DMG_DIR="$ROOT/src-tauri/target/release/bundle/dmg"
shopt -s nullglob
DMGS=("$DMG_DIR"/*.dmg)
(( ${#DMGS[@]} > 0 )) || die "ビルドは終了しましたがDMGが見つかりません: $DMG_DIR"

info "Build complete"
printf 'DMG output:\n'
for dmg in "${DMGS[@]}"; do
  ls -lh "$dmg"
done
printf '\nこのMacのCPU向けビルドです。配布用の署名・公証はこのスクリプトでは行いません。\n'
