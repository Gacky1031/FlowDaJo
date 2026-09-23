# 0.4.0 検証記録

2026-09-17 / Windows 11 x64 / 同梱R 4.5.1・flowCore。

## 確認内容

- 全7プロット形式、Linear/Log/Logicle、Log非正値除外、空集団、密度質量保存、等高線間隔、CDF終点100%、ヒストグラムmode正規化。
- ゲート内部drill down（元カードを残して遷移カードを作成）、親に戻る、右クリック名前変更/削除/Undo、楕円・範囲ゲート。
- 個別適用/全体適用の分画、全体適用ゲートの別サンプル評価、FSC/SSC定型展開ボタン。
- Global worksheet（1シート1サンプル・全カードactive）とNormal sheet（複数サンプル/複数分画カード）の分離、右クリックGlobal⇄個別ゲート移動、Normal専用の分画プロット他サンプル展開。コンペ定型解析（FSC-A × 全蛍光）、選択プロットのX/Y軸一括変更、行優先/列優先の行列配置、Global/個別分画フィルタ。
- 点径・透明度の保存復元、日本語CSV・負のmedian・数式として解釈されるテキストの保護、PDF/SVG出力。
- PDFの全4ページを画像化して確認。日本語、タイトル、統計表、補正行列を確認。

## 実行結果

- `npm run build`: 成功。
- `npm test`: 11件成功。
- R core: 20件成功。
- `cargo test`: 5件成功。
- `npx playwright test`: 12シナリオ成功（Normal sheetの単一プロット右クリック展開、複数プロット×複数サンプル展開、サイドバーからのドラッグ配置、展開と行列配置の統合、比較軸の同期を含む）。
- WindowsリリースEXEのコンパイル成功。
- 実EXE: 外部R/R_HOME/ライブラリ/WebView2へのパスを無効にして起動。同梱Rで16,000イベントを解析し、7形式・軸右クリック・拡大復帰・CSV/PDF/SVG出力を確認。ページエラー0件。
- 実EXEの7形式の画面とR出力PDF全4ページを画像で確認。
- 記録: `artifacts/native-axis-0.4.0-validation.json`。配布ZIPの内容と主要ファイルのハッシュは `scripts/verify-release.py 0.4.0` で検証。

## 残る範囲

FlowJo .wsp、Boolean gate、分布の重ね描き、自動単染色補正、DIVAゲート完全復元、自由配置そのままのPDFは未実装。Windows10/クリーンVM、百万イベント級性能は未検証。Yu GothicのないWindows構成では日本語フォントの表示を別途確認する必要がある。
