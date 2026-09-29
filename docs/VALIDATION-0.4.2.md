# 0.4.2 配布前チェック

2026-09-29 / Windows x64。

- `npm test`: 17件成功。
- 同梱R 4.5.1で `r/worksheet.R` の構文解析に成功。
- `scripts/build-rtools.ps1`: Tauri本体とNSISインストーラーの生成に成功。
- Tauriビルドに含まれる `npm run build`: TypeScriptとViteのビルドに成功。
- インストーラーのクリーンなWindows環境へのインストール確認は未実施。

配布ZIPの全ファイル一覧と主要ファイルのSHA-256は、`scripts/verify-release.py 0.4.2` で照合する。
