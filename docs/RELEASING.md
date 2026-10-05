# 配布物の作成

配布用ファイルは **`release/<version>/`** にまとめます。作成途中のフォルダや過去版をここへ混ぜません。公開するWindows版は次の3ファイルです。

- `FlowDaJo-<version>-windows-x64-setup.exe` — 通常のインストーラー
- `FlowDaJo-<version>-windows-x64-portable.zip` — インストール不要のポータブル版
- `SHA256SUMS-<version>.txt` — 上記2ファイルのSHA-256

## Windows

プロジェクトのフォルダでPowerShellを開きます。R・flowCore・WebView2が同梱済みの環境では、次の順番で作成できます。

```powershell
./scripts/build-rtools.ps1
./scripts/package-portable.ps1
python scripts/verify-release.py
```

MSVCを使う環境では最初の行を `./scripts/build.ps1` に替えます。ビルドスクリプトは完成したインストーラーを配布フォルダへコピーします。パッケージスクリプトは `artifacts/packaging/<version>/FlowDaJo-<version>/` に新しい展開フォルダを組み立て、配布フォルダへZIPを出力します。前の展開フォルダは `artifacts/archive/packaging/` に保管します。

検証スクリプトはZIP内のファイル一覧と主要ファイルを照合し、配布フォルダへSHA-256一覧を出力します。インストーラーとZIPの双方に `LICENSE` と第三者ライセンス情報を含めます。

## Mac実機

```sh
bash scripts/build-macos.sh
```

完成したDMGと照合用ファイルを `release/<version>/` に置きます。このMacのCPU向けのビルドで、署名・公証は行いません。GitHub ActionsによるMac版の作成は終了しました。

## フォルダの役割

| 場所 | 内容 |
|---|---|
| `release/<version>/` | 他の人に渡す完成品 |
| `artifacts/packaging/` | ポータブル版の組み立て用フォルダ |
| `artifacts/archive/` | 整理前の過去版、過去の組み立て用フォルダ |
| `artifacts/` | テスト結果・画像・検証用PDF。配布不要 |
| `src-tauri/target/` | Rust/Tauriのコンパイル結果・内部バンドル。直接配布しない |
| `dist/` | アプリに組み込む画面のビルド結果。単独では起動しない |
| `output/mcp-cache/` | MCP操作用の解析キャッシュ |

リリースノートは `docs/releases/<version>.md` に保管します。GitHub Releaseへは配布ファイルだけを添付します。

## 公開

通常は新しい変更ごとにバージョンを更新し、ソース・タグ・配布物を同じコミットに揃えます。利用者から同じバージョンの差し替えを明示的に依頼された場合だけ、変更内容と更新日をリリースノートへ追記し、そのバージョンのタグも修正コミットへ更新します。配布ファイルとSHA-256一覧をすべて差し替え、公開後のハッシュを確認します。
