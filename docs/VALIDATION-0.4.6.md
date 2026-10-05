# FlowDaJo 0.4.6 配布前チェック

2026-10-05 / Windows x64。

- `npm test`: 25件成功。Rでの共通ビン・平滑化・正規化・曲線ごとの分画集計、Control固定、テンプレート対応付け、取り込み時の軸設定保持を確認。
- Playwright: 5件成功。ドラッグ／右クリックでのHistogram重ね合わせ、どちら側でもControl固定、色のOverride、他サンプルへの展開、保存・再読み込み、Globalへの切り替え、軸設定の復元・キャンセル・Undoを確認。
- PDF/SVGで比較用の凡例をグラフ外に表示。生成したPDFを画像に変換し、凡例と曲線が重ならないことを確認。
- 配布物はWindowsインストーラー・R/flowCore/WebView2同梱のポータブルZIP・SHA-256一覧。`scripts/verify-release.py 0.4.6`でZIPのファイル一覧と主要ファイルを照合する。
- インストーラーをクリーン環境へインストールする試験は未実施。
- macOS GitHub Actionsワークフローを削除。今回のReleaseにはMac版を作成しない。
