# 配布物の作成

現在の公式配布物はWindows x64向けです。Releaseには同じコミットから作った次の3ファイルだけを置きます。

- `FlowDaJo-<version>-windows-x64-setup.exe` — 通常のインストーラー
- `FlowDaJo-<version>-windows-x64-portable.zip` — インストール不要のポータブル版
- `SHA256SUMS-<version>.txt` — 上記2ファイルのSHA-256

新しい変更を配布するときはバージョンを更新し、そのコミットにタグを付けてからビルドします。Releaseのタグ、ソース、配布物のバージョンを一致させます。古いタグの配布物を新しいコードで上書きしないでください。

WindowsではR、flowCore、WebView2の同梱状態を確認してから、`scripts/build-rtools.ps1`でインストーラーを、`scripts/package-portable.ps1`でZIPを作ります。`python scripts/verify-release.py <version>`でZIP内の主要ファイルとチェックサムを検証します。インストーラー、ZIPの双方に`LICENSE`と第三者ライセンス情報を含めます。

macOSのDMGは、両アーキテクチャの現行コミットでビルドと確認ができた場合だけ同じReleaseに追加します。GitHub ActionsのmacOSワークフローは手動起動です。Actionsが利用できない場合は`README.md`の案内に従い、DMGを掲載せずソースからのビルド手順を示します。
