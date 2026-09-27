# 0.4.1 配布前チェック

2026-09-27 / Windows x64。R/flowCoreとWebView2を同梱したインストーラーとポータブルZIPを作成した。

- `npm test`: 17件成功。
- メニューのUIテスト: 1件成功。最小ウィンドウサイズでファイル・出力メニューの末尾までスクロールなしで操作できる。
- `npm run tauri build`: 成功。R/flowCore、WebView2、`LICENSE`をバンドル対象に設定。
- `scripts/verify-release.py 0.4.1`: 成功。ポータブルZIP内の18,027ファイルと主要11ファイルを検証し、インストーラーとZIPのSHA-256を記録。

インストーラーそのもののクリーン環境へのインストールは未検証。macOSの現行DMGはGitHub Actionsの請求・利用上限により生成できていないため、0.4.1 Releaseには掲載しない。
