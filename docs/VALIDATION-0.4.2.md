# 0.4.2 配布前チェック

2026-09-29 / Windows x64。

- `npm test`: 17件成功。
- ゲート貼り付けUI回帰テスト: 5件成功（全体／個別親、コピー／切り取り、子孫チャンネル不一致を含む）。
- 同梱R 4.5.1で `r/worksheet.R` の構文解析に成功。
- `npm run build`: TypeScriptとViteのビルドに成功。
- この更新後に `scripts/build-rtools.ps1` を実行し、Tauri本体とNSISインストーラーを再生成済み。
- インストーラーのクリーンなWindows環境へのインストール確認は未実施。

配布ZIPの全ファイル一覧と主要ファイルのSHA-256は、`scripts/verify-release.py 0.4.2` で照合する。
