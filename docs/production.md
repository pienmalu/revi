# 本番環境

研究室内の非商用利用向け。無料枠を超えた場合は利用制限を受け入れ、有料プランや有料トライアルへ変更しない。

| 項目      | 設定                                                       |
| --------- | ---------------------------------------------------------- |
| URL       | https://revi-eta.vercel.app                                |
| Vercel    | `123popopcorns-projects/revi`、Hobby                       |
| Neon      | `revi` / `dry-dawn-94437563`、Free、Singapore              |
| PDF保存先 | `revi-pdfs` / `store_mSxuAbXXpx9j2uC0`、private、Singapore |
| Node.js   | 22系                                                       |

初回は鍵付きの研究室用リンクから開く。
リンクは手元の `output/access-link.txt` に保存し、Gitや配布ファイルには含めない。
リンクを知る人は閲覧・編集できるため、研究室内で共有する。

## 引き継いだデータ

デモの資料3件、版4件、コメント4件、メンバー2人、添付ファイル5件を移行した。
移行時に全10表の内容とファイルのSHA-256が一致することを確認した。
元のデータは `data/`、移行前のバックアップは `output/backups/pre-production-20260924/` に残している。

移行ツールは停止中のアプリからコピーしたバックアップだけを読む。
移行先はスキーマ作成済みで空のDB、またはバックアップと完全に同じDBに限る。
本番運用開始後に再適用するための同期ツールではない。

```sh
node --import tsx scripts/migrate-local.ts --snapshot /absolute/path/to/backup --inspect
# DATABASE_URL（直接接続）とBLOB_READ_WRITE_TOKENを本番専用の環境から渡す
node --import tsx scripts/migrate-local.ts --snapshot /absolute/path/to/backup --apply
```

## Slackの設定（利用者が行う）

1. `slack-manifest.yaml` の受信先を `https://revi-eta.vercel.app/api/slack` にする。
2. VercelのProduction環境に `SLACK_BOT_TOKEN` と `SLACK_SIGNING_SECRET` を登録する。
3. 本番を再デプロイし、Slackアプリをテスト用チャンネルに招待する。
4. PDF受付、確認OK、提出報告を試してから研究室で使う。

`SLACK_APP_TOKEN` と `SLACK_DEV_SIGNING_SECRET` は本番では不要。
DB・Blob・公開URL・定期処理用の環境変数は設定済み。
Slackのトークンがない間もWeb画面は使えるが、Slackへの通知は行わない。

## 再公開

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
vercel deploy --prod --yes --scope 123popopcorns-projects
```

本番ビルドにはWebpackを使う。
TurbopackではVercelへの配布時にシンボリックリンクのエラーが発生したため。
PDF.jsはビルドに含め、PDF画面はブラウザで読み込む。
`.vercelignore` で実データ・バックアップ・接続情報をアップロードから除外する。

手元の開発設定は本番と別に保つ。
Vercel CLIによる開発設定の更新後に開発用URLを戻し、中継用シークレットを再生成した。
手元でSlackの中継を使う場合は `pnpm slack:dev` を起動し直す。

## 2026年9月24日の確認結果

本番デプロイ `dpl_CqBoiN8WKiLdmmHRp1Fajjw2eK6Q` はReady。
認証なしのアクセス拒否、鍵付きリンクによる認証、非公開Blobの直接アクセス拒否、6MBのPDFアップロード・解析・取得、コメント操作、確認OK、提出報告・受領ファイルの取得、CSV出力を本番APIで確認した。
定期処理も認証付きで200を返し、Slack未設定のため送信は0件。
テスト用資料の削除後、元のデモデータ全件と5ファイルが保持され、テスト用ファイルが残っていないことを確認した。
新しく作成した研究室用リンクの鍵だけを設定表に追加している。

自動テスト54件、Lint、型チェック、本番ビルドが成功。
作業環境ではブラウザ起動が制限されたため、本番のPDF表示は利用者が確認した。
ビルドにはBudouX経由の任意依存 `canvas` の警告が残る。アプリはBudouXの文字列分割だけを使い、canvas描画は呼び出さない。

同日、ブラウザ起動が可能になった後、拡大縮小とモバイルのボトムシートを修正して再公開した。
本番 `revi-a7gkdip8l-123popopcorns-projects.vercel.app` を通常の公開URLへ反映済み。
Chromiumのタッチ入力で二本指の拡大（PDF幅379→684）と、画面幅を変えた後の倍率保持を確認した。
PCのCtrl+ホイールによる拡大（890→1262）と倍率保持、シート上端のドラッグによる開く・全画面近くまで広げる・閉じる操作も確認した。
iPhone実機のSafari操作は未確認。文字選択直後にコメント欄を開く仕様は変更していない。
認証なし・不正な鍵は引き続き401となる。正常な鍵はHttpOnly Cookieへ保存し、URLから除く設計。
確認結果は `output/ui-production-verification.jsonl`、画面画像は `output/ui-native-touch-*.png` に保存した。

続いて、シートを閉じる途中で一瞬上へ跳ね返る不具合を修正した。
高さとtranslateYの同時アニメーションをやめ、下端固定の高さだけで開閉する。
本番 `revi-poeowcyei-123popopcorns-projects.vercel.app` に反映済み。
通常位置から閉じる・少し持ち上げて戻す・最大位置から閉じる操作をタッチ入力で再現し、指を離した後の各フレームを測定した。
修正前は約110〜137pxの逆戻り、修正後の本番では3ケースとも0px。
記録は `output/sheet-motion-production.json`。Lint・型チェック・ビルドと、拡大縮小の回帰確認も成功。

その後追加した認証変更と選択時の「コメントする」切り替えは、利用者の依頼で取り消した。
現在は `revi-5qpuoiqhq-123popopcorns-projects.vercel.app`。保存済みの有効な鍵で継続利用する元の認証方式に戻している。本番の鍵は変更していない。
文字選択を700msで自動確定する処理を削除し、タッチのpointerdown/upでPDF部品がブラウザの選択を消したり確定したりしないようにした。
選択した文字列はそのまま調整でき、既存のシートを利用者が開いたときに確定する。追加のボタン表示はない。
一文字のDOM選択が待機後・タッチイベント後も保持され、既存のシートをタップするとその一文字が引用されることを本番で確認した。
実機で選択ハンドルを指で動かす検証ではないため、端末・ブラウザ別の細かな選択感は未確認。
Lint・型チェック・ビルド、ローカルの拡大縮小とシート開閉の回帰確認が成功。結果は `output/native-selection-production.json`。

シートをタップすると選択が消える端末に対応し、ハンドルのpointerdown捕捉時にRangeを保存してから、開くときに確定するよう修正した。
ドラッグを中断して開かなかった場合、次の操作で古い選択は引き継がない。
モバイル幅では入力欄への自動フォーカスをやめ、入力欄をタップしてから入力を開始する。
本番 `revi-9q5dse3ji-123popopcorns-projects.vercel.app` に反映済み。
タップ時の選択解除を再現した上で、タップ・ドラッグで一文字が引用されること、開くだけではフォーカスせず入力欄をタップすれば入力できること、中断時に選択を使い回さないことをブラウザで確認した。
結果は `output/selection-tap-production.jsonl`。Lint・型チェック・ビルドも成功。

表示中の版の「…」に「コメントをMarkdownで保存」を追加した。
投稿者・ページ・引用文・指摘・返信・対応状況を出力する。図表の範囲指定にはページ内の位置を記載する。
画面のフィルターにかかわらず当該版の全コメントを含み、別の版や研究室用リンクの鍵は含めない。
`GET /api/versions/[id]/comments/markdown` は既存の鍵認証を通し、UTF-8の添付ファイルをprivate/no-storeで返す。
本番 `revi-gn9sxp7y6-123popopcorns-projects.vercel.app` に反映。PC・モバイル幅で実際のダウンロードと本文・返信を確認し、未認証の取得は401になることも確認した。
フォーマットと認証・版の分離の追加テスト2件、Lint・型チェック・ビルドが成功。結果は `output/markdown-production.jsonl`。
