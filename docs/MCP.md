# FlowDesk MCP

このPCのCodexには `flowdesk` という名前で登録済みです。接続が表示されない場合はCodexを再起動してください。

## 操作できること

- `health`: 同梱R / flowCoreを確認
- `new_project` / `load_project` / `get_project` / `save_project`: 解析セッションとプロジェクトJSON
- `import_samples`: FCSファイル、DIVAフォルダ（既存のDIVA取り込み制限は同じ）
- `put_worksheet`: Global/Normalシート、複数プロット、軸、表示形式、位置・サイズ
- `put_gate`: Global/個別ゲートの作成・更新。既定はGlobal
- `set_compensation`: スピルオーバー行列を更新
- `analyze`: 全イベントの分画統計、プロット範囲・細胞数
- `export`: CSV、ワークシートPDF、全サンプルPDF、単一プロットPDF/SVG

## AIへの依頼例

「FlowDesk MCPで C:/data/experiment のFCSを取り込み、FSC-A対SSC-AのGlobal worksheetを作って。プロジェクトを C:/data/analysis.json に保存して」

「FlowDesk MCPで C:/data/analysis.json を開き、各サンプルのCells分画の細胞数と割合を C:/data/counts.csv に出力して」

## 動作と取り扱い

MCPはGUIの未保存状態とは独立した解析セッションです。GUIで保存したJSONをload_projectで読み込み、AIによる変更はsave_projectで保存してGUIから開きます。接続終了時に未保存のセッションは失われます。

出力には絶対パスを指定します。出力先フォルダは事前に用意してください。既存ファイルはoverwrite:trueを明示した場合だけ上書きします。プロジェクトの入れ替えもreplace:trueが必要です。

GlobalのカードはsampleId: active、Normalのカードは具体的なサンプルIDを指定します。put_worksheetは指定IDのシート全体を置き換えます。比較プロットの軸を揃えるには各軸へ同じmin/maxを指定してください。MCPはGUIの自動軸同期処理を実行しません。

ゲート座標とmin/maxは表示変換後の座標です。Linearは測定値、Logはlog10、Logicleは変換後の座標です。analyzeで実際の表示範囲を確認してください。補償行列はパーセントではなく比率（1%=0.01）で指定します。行が元蛍光、列が測定検出器です。

編集はRで検証してからセッションへ反映します。統計は全イベントを集計し、MCP応答から大量の描画イベント配列を除外します。FCS本体を書き換えません。任意のRコードを実行するツールはありません。

## 実装と再登録

このMCPはソースフォルダ内のNode.jsサーバーです。既存のWindows配布ZIPには追加していません。このPCのNode.jsとプロジェクト内の同梱Rを使います。GUIを起動する必要はありません。

```powershell
npm ci
node --test tests/mcp.test.mjs
codex mcp add flowdesk -- "C:\Program Files\nodejs\node.exe" ".\mcp\server.mjs"
```

Codex設定は ~/.codex/config.toml。元設定のバックアップはconfig.toml.before-flowdesk-mcp-20260921です。接続はstdioで、TCPポートや外部公開サーバーは使いません。

登録方法: https://developers.openai.com/codex/mcp/

