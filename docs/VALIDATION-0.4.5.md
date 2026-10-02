# FlowDaJo 0.4.5 配布前チェック

2026-10-02 / Windows x64。

- `npm test`: 21件すべて成功。
- `npm run build`: TypeScriptとViteの本番ビルドに成功。
- Playwright: 軸スケール変更後のゲート表示・編集と統計ウィジェットの一括削除・Undoを確認。
- Rust: 10件成功。R workerの軸推奨設定呼び出しを確認。
- 変換後のゲートを含むPDFを出力し、ページ表示を確認。
- Windows x64のインストーラーとポータブル版を本ビルドで作成。
- ポータブルZIPの内容と主要ファイルのSHA-256を `scripts/verify-release.py 0.4.5` で照合。
