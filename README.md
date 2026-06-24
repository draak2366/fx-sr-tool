# USD/JPY S/Rライン分析ツール

USD/JPYのサポート・レジスタンスライン（S/R）を複数時間足で自動検出し、
R1/R2・S1/S2・★強度・マルチTF合流を表示するライントレードの分析補助ツール。

## 構成

| ファイル | 役割 |
|---|---|
| `index.html` / `style.css` | フロント（静的）。`sr.json`を読んで表示・5分自動更新 |
| `sr-engine.js` | S/R検出エンジン（ブラウザ/Node両対応）|
| `sample-data.js` | API取得失敗時のサンプル（フォールバック）|
| `config.js` | データ取得元URL（GitHub rawのsr.json）|
| `build-sr.js` | Twelve Dataから取得→S/R計算→`sr.json`生成（Actionが実行）|
| `.github/workflows/build-sr.yml` | 5分ごとにbuild-sr.jsを実行しsr.jsonをコミット |

## セットアップ

1. GitHubでこのフォルダをリポジトリにpush
2. リポジトリ Settings → Secrets and variables → Actions → New repository secret
   - Name: `TWELVEDATA_KEY`　Value: Twelve DataのAPIキー
3. Actions タブで `build-sr` ワークフローを有効化（初回は手動 Run でテスト）
4. `config.js` の `dataUrl` を
   `https://raw.githubusercontent.com/<ユーザー名>/<リポジトリ名>/main/sr.json`
   に設定
5. フロント（index.html等）を Netlify 等で公開

## 注意

- **APIキーは絶対にコミットしない**（GitHub Secretsのみ）
- `sr.json` は計算結果のみ（キーを含まない）ので公開OK
- 本ツールは分析補助であり、売買助言ではない（免責をフロントに明記済み）
