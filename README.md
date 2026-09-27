# FlowDaJo

FlowDaJoは、FCSデータのゲーティング、サンプル比較、PDF出力を行うフローサイトメトリー解析アプリです。解析エンジンにはRとflowCoreを使用します。

**配布中のビルドはWindows x64向けです。** [Releases](https://github.com/Gacky1031/FlowDaJo/releases/latest)から通常のインストーラー、またはZIPを展開して使うポータブル版を選べます。どちらにもRとflowCoreを同梱しており、別途Rをインストールする必要はありません。macOS版は現在のReleaseでは配布していません。Macでは[`scripts/build-macos.sh`](scripts/build-macos.sh)を使ってソースからビルドできます。

## macOSでビルド

HomebrewとXcode Command Line Toolsを用意し、リポジトリのルートで `bash scripts/build-macos.sh` を実行します。スクリプトは必要なビルド依存を導入し、同梱Rによるデモ生成と日本語名のFCSの取り込みを、DMG作成前とDMG内で検査します。完成したDMGは `src-tauri/target/release/bundle/dmg/` にあります。署名と公証は別途必要です。

## 基本のワークフロー

1. **データを取り込む** — FACSDivaのXMLと対応するFCSデータを「DIVA XML」または「DIVAフォルダ」から読み込みます。複数のワークシートがある場合は、取り込むシートを選びます。FCSファイルだけを読み込むこともできます。
2. **Global worksheetで共通ゲートを整える** — サンプルを一つずつ切り替えながら、共通の軸とゲートを使って分画を確認します。複数サンプルで同じ定義を使うゲートは「全体適用」にします。特定サンプルだけのゲートは「個別適用」にします。
3. **Normal worksheetで見たいプロットを集める** — 注目するサンプルと分画をプロットとして配置し、比較しやすい一枚のシートを作ります。
4. **選んだ項目を他サンプルへ展開する** — Normal worksheetでプロットや統計ウィジェットを選び、「Normal 選択項目を展開」から対象サンプルと横・縦の配置方向を指定します。
5. **印刷する** — 印刷枠を整え、プレビューで確認してからWorksheet PDFまたは全サンプルレポートを出力します。

## 補足：Compensationの調整

Compensationは必要に応じて行う追加の手順です。DIVA XMLにCompensation設定が含まれていれば、取り込み後にウィジェットで確認できます。

- Compensationを見ながら調整するには、「解析操作 → Comp定型解析」を選び、FSC-Aに対して表示する蛍光チャンネルを選択します。選んだ蛍光ごとにプロットが作成され、Compensationウィジェットも配置されます。既存のワークシートには「＋ウィジェット → Compensation調整」から追加できます。
- ウィジェットの「編集中」でサンプルを選び、プロットを確認しながらCompensation matrixを調整します。DIVAから取り込んだmatrixを使う場合は、ウィジェット内のDIVAプリセットから選びます。適用先のサンプルにチェックを入れて「チェックしたサンプルへ適用」を押し、各サンプルで「補正 ON」を有効にします。

## GlobalとNormalの使い分け

| | Global worksheet | Normal worksheet |
|---|---|---|
| 目的 | 全サンプルに共通するゲートを作り、適用を確認する | 注目するプロットを集め、サンプル間で比較する |
| 表示 | 一度に1サンプル。サンプルを切り替えても軸と配置を保つ | 1枚に複数サンプル・複数分画を配置できる |
| 分画 | 全サンプル共通のゲートを基本に解析する | Globalゲートと個別ゲートの分画を並べて確認できる |

GlobalとNormalは別々のワークシートです。Globalで共通の分画を整えてから、Normalに比較したいプロットを集めるのが基本です。Normalでは、配置したプロットやウィジェットを選んで他サンプルへ展開できます。

## 保存とPDF

- **Worksheet PDF**は、現在のワークシートを印刷します。ワークシート上のA4印刷枠でページの向き・位置・範囲を調整できます。
- **全サンプル report**は、現在のワークシートの内容を各サンプル向けに出力します。統計・Compensationウィジェットは、ワークシートに配置した場合に印刷されます。
- 「保存」で解析プロジェクトを保存できます。プロジェクトには元のFCSデータは含まれないため、FCSファイルを移動・削除せずに保管してください。

## 対応範囲

FACSDiva XMLから、選択したワークシートの対応ゲート・プロット配置・軸設定・Compensation設定を取り込みます。DIVAのすべてのゲートや表示要素には対応していないため、取り込み後にゲートと軸を確認してください。FlowJo `.wsp` の読み込みには対応していません。

## ライセンス

FlowDaJo独自のソースコードはMIT Licenseです。利用条件はリポジトリ直下の `LICENSE` を参照してください。このライセンスは第三者ソフトウェアには適用されません。R、flowCoreとその依存パッケージはそれぞれのライセンスに従い、Windows版に含まれるMicrosoft WebView2 RuntimeもMicrosoftの条件に従います。バージョンとライセンスの一覧は [`r-manifest.json`](src-tauri/runtime/r-manifest.json) と [`THIRD-PARTY-NOTICES.md`](src-tauri/runtime/THIRD-PARTY-NOTICES.md) を確認してください。
