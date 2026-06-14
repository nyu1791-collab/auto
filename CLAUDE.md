# auto

Claude Code (Web) による自動開発用のリポジトリです。プロジェクトの内容はまだ決まっていません。

## 自動開発の方針

- 作業は `claude/auto-execution-dev-mode-*` のようなフィーチャーブランチで行い、変更は都度コミット・プッシュする。
- ファイル編集やテスト実行などリバーシブルな操作は確認なしに進めてよい(`.claude/settings.json` で `acceptEdits` を設定済み)。
- force push・ブランチ削除・履行済みコミットの変更などの破壊的操作は事前にユーザーに確認する。

## 利用制限解除後の自動再実行について

Claude のレート制限(利用制限)が解除された後にセッションを自動的に再開・継続させたい場合、
それはこのリポジトリの設定ではなく Claude Code on the web の「Trigger(スケジュール実行)」機能を
Web UI から設定する必要があります。詳細は以下を参照してください。

https://code.claude.com/docs/en/claude-code-on-the-web

## プロジェクトの内容

未定。最初の開発タスク・技術スタックが決まったら、この節と `.claude/hooks/session-start.sh`
(依存関係インストール用の SessionStart hook)を追記してください。
