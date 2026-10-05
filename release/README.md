# 配布ファイルの場所

**他の人に渡すファイルは、このフォルダ内のバージョン別フォルダにあります。**

現在の配布先は `0.4.6/` です。

| ファイル | 用途 |
|---|---|
| `FlowDaJo-0.4.6-windows-x64-setup.exe` | Windowsにインストールする。通常はこちら |
| `FlowDaJo-0.4.6-windows-x64-portable.zip` | 展開して起動する。インストール不要 |
| `SHA256SUMS-0.4.6.txt` | 配布ファイルの照合用 |

ビルド・パッケージ作成スクリプトも `release/<version>/` に配布ファイルを置きます。Mac実機で作成したDMGも同じバージョンのフォルダに入ります。バージョンが変わっても、この配置規則は変わりません。

- `artifacts/packaging/<version>/` はポータブル版を組み立てる作業場所です。ここをそのまま渡す必要はありません。
- `artifacts/archive/` は整理前の過去版・作業ファイルの保管場所です。
- `src-tauri/target/release/` はビルドの内部作業場所です。配布用はこのフォルダではなく `release/<version>/` から選んでください。

ソースからの作成方法は [配布手順](../docs/RELEASING.md)、公開済みのファイルは [GitHub Releases](https://github.com/Gacky1031/FlowDaJo/releases) を参照してください。
