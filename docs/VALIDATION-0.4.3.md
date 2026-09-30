# FlowDaJo 0.4.3 配布前チェック

2026-10-01 / Windows x64。

- `npm test`: 18件すべて成功。
- `npm run build`: TypeScriptとViteの本番ビルドに成功。
- `scripts/build-rtools.ps1`: Windows x64ネイティブアプリとNSISインストーラーの生成に成功。
- ネイティブスモーク: 同梱R/WebView2で起動し、7種類のプロットとCSV/PDF/SVG出力を確認。ページエラーなし。
- ポータブルZIPとインストーラーの内容・SHA-256: `scripts/verify-release.py 0.4.3` で検証。

配布ZIPの全ファイル一覧と主要ファイルのSHA-256は、`scripts/verify-release.py 0.4.3` で照合する。
