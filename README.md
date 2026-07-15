# Codex Agent Office

Codexのタスク実行状況を、ピクセルアートのオフィスとして可視化するWeb UIです。
複数プロジェクトの並行タスク、エージェントの状態、ソースプレビュー、タスク別チャット履歴を一画面で確認できます。

公開UIだけではローカルファイルやCodexを操作できません。利用者自身のPCでLocal Bridgeを起動し、6桁コードとmacOSの確認画面で明示的に接続した場合だけ動作します。

## 主な機能

- オフィス内をキーボード・画面ボタンで移動
- Codexに近づいてチャットWindowを開くゲーム風UI
- Markdown対応チャット
- 複数プロジェクトの登録と並行タスク実行
- タスクごとに分離されたチャット履歴
- Codexのコマンド、変更ファイル、進行状況の可視化
- 添付ファイルの受け渡し
- Local BridgeによるCodex自動検出

## 必要環境

- macOS
- Node.js 22.13.0以上
- ChatGPTデスクトップアプリ、またはCodex CLI
- npm

## インストール

```bash
git clone https://github.com/CatwalkTK/codex-agent-office.git
cd codex-agent-office
npm install
npm run local
```

ターミナルに表示された`http://localhost:3000`をブラウザで開きます。
`npm run local`はWeb UIとLocal Bridgeを同時に起動します。終了するときは`Ctrl+C`を押してください。

別々に起動する場合は、2つのターミナルで以下を実行します。

```bash
npm run dev
npm run bridge
```

## Bridgeとの接続

1. `npm run bridge`を起動します。
2. ターミナルまたは`http://127.0.0.1:4312`に表示される6桁コードを確認します。
3. Office UIへコードを入力します。
4. macOSに表示される接続確認で許可します。

ペアリングコードは10分で失効し、入力失敗は5回までです。接続トークンはメモリとブラウザタブ内だけに保存され、ファイルへ永続化されません。セッションは明示解除、Bridge停止、または無通信状態で失効します。

## セキュリティ設計

- Bridgeは`127.0.0.1`だけで待機します。
- CORSは許可したOriginとの完全一致です。
- 公開UIへローカルの絶対パスを返しません。プロジェクトは匿名IDで扱います。
- ペアリング、添付保存、履歴削除、Codex実行はmacOS側で確認します。
- 作業フォルダーはmacOSのフォルダー選択画面からのみ登録できます。
- 添付はプロジェクト外の所有者専用一時領域へ保存し、タスク終了後に削除します。
- ソースプレビューは作業フォルダー内の通常のテキスト系ソースに限定し、シンボリックリンクや秘密情報ファイルを拒否します。
- Codexは`workspace-write`サンドボックスで、選択した外部プロジェクトを作業ディレクトリとして起動します。
- WebレスポンスにはCSP、HSTS、クリックジャッキング対策などのセキュリティヘッダーを設定します。

追加Originを許可する場合は、信頼できるサイトだけを指定してください。

```bash
CODEX_OFFICE_ALLOWED_ORIGINS=https://office.example.com npm run bridge
```

## 保存データ

タスクとチャット履歴は`~/.codex/office/history.json`へ所有者専用権限で保存されます。APIキー、ペアリングトークン、添付内容は履歴へ保存しません。

作業フォルダーの登録情報は`~/.codex/office-workspace.json`へ所有者専用権限で保存されます。Office本体のフォルダーを作業対象として選択することはできません。

## 確認コマンド

```bash
npm run lint
npm test
npm audit
```

## 公開ソースとライセンス

ソースコードは[GitHub](https://github.com/CatwalkTK/codex-agent-office)で公開しています。

本ソフトウェアは`AGPL-3.0-only`で提供します。改造版を配布する場合や、ネットワーク経由で利用者へ提供する場合は、GNU Affero General Public License v3.0の条件に従って対応ソースを利用者へ提供してください。完全な条件は[LICENSE](./LICENSE)を参照してください。

## 注意

Local Bridgeは利用者の権限でCodexを起動します。内容を理解できないタスク、添付、フォルダー操作はmacOSの確認画面で拒否してください。公開サイトとLocal Bridgeは、公式リポジトリから取得した版を使用してください。
