# FlowDaJo 0.4.6 配布前チェック

2026-10-05 / Windows x64。

- `npm test`: 26件成功。Rでの共通ビン・平滑化・正規化・曲線ごとの分画集計、Control固定、テンプレート対応付け、取り込み時の軸設定保持、チャンネル順に依存しない新規プロットの初期軸を確認。
- Playwright: 5件成功。ドラッグ／右クリックでのHistogram重ね合わせ、どちら側でもControl固定、色のOverride、他サンプルへの展開、保存・再読み込み、Globalへの切り替え、軸設定の復元・キャンセル・Undoを確認。
- PDF/SVGで比較用の凡例をグラフ外に表示。生成したPDFを画像に変換し、凡例と曲線が重ならないことを確認。
- 配布物はWindowsインストーラー・R/flowCore/WebView2同梱のポータブルZIP・SHA-256一覧。`scripts/verify-release.py 0.4.6`でZIPのファイル一覧と主要ファイルを照合する。
- インストーラーをクリーン環境へインストールする試験は未実施。
- macOS GitHub Actionsワークフローを削除。今回のReleaseにはMac版を作成しない。

## 同番号の差し替えで追加した確認

- Edgeで4件、WebKitで3件成功。上部メニューの固定幅・文字サイズ・スクロール不要の操作、Popover非対応時の表示、FSC-A／SSC-Aでの分画ドラッグ配置、取り込み済み軸スケールの引き継ぎを確認。
- EdgeとWebKitのメニュー画像を比較し、同じ幅・行高で表示されることを確認。WebKitはWindows上での試験であり、Mac実機の確認は未実施。
- PowerShellの配布スクリプトとMacのシェルスクリプトは構文チェックを通過。Mac実機でのDMG作成は未実施。
- 配布先を `release/0.4.6/`、組み立て用を `artifacts/packaging/0.4.6/` に変更。以前のファイルは `artifacts/archive/` に保管。
