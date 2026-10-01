# FlowDaJo 0.4.4 配布前チェック

2026-10-01 / Windows x64。

- `npm test`: R worker、ゲートラベルのベクター出力、テンプレートの保存・読込を検証。
- `npm run build`: TypeScriptとViteの本番ビルドに成功。
- Playwright画面テスト: ドラッグ、ゲート形状・統計値の不変、Undo/やり直し、保存・復元、PDF出力を検証。
- `scripts/build-rtools.ps1`: Rtools45のGNUツールチェーンでWindows x64アプリとNSISインストーラーを生成。
- ポータブルZIPの全ファイルと主要ファイルのSHA-256を `scripts/verify-release.py 0.4.4` で照合。
