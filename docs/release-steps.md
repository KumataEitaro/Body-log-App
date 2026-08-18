# BodyLog 公開手順（URL付き・上から順にやればOK）

所要時間の目安: **合計40〜60分**（Appleの審査待ちは別途1〜2日）

---

## STEP 1. Supabaseでデータベースを更新（5分）

体脂肪率・体の写真・運動目標の機能は、この更新をしないと動きません。

**開くURL**
👉 https://supabase.com/dashboard/project/rhyfspqxsfpdogzmizic/sql/new

※ ログインは **gotcha429@gmail.com** のアカウントです（会社のdialog-incではありません）

**やること**
1. 上のURLを開く（SQL Editorの新規クエリ画面が開きます）
2. パソコンで `C:\Users\hashi\Downloads\bodylog\supabase\apply-pending.sql` をメモ帳などで開く
3. **中身を全部コピー**して、SQL Editorの黒い入力欄に貼り付け
4. 右下の緑の **RUN** ボタンを押す
5. 下に `Success. No rows returned` と出れば完了

> 何度実行しても壊れない作りになっているので、「前にやったかも」という場合もそのまま実行して大丈夫です。

**確認したいとき**
👉 https://supabase.com/dashboard/project/rhyfspqxsfpdogzmizic/editor
左のテーブル一覧に `body_photos` があればOK。

---

## STEP 2. Codemagicでビルド（15分・うち待ち時間10分）

**開くURL**
👉 https://codemagic.io/apps

**やること**
1. アプリ一覧から **Body-log-App** を選ぶ
2. `rn-testflight` のワークフローを選んで **Start new build**
3. ブランチは `main`（今日の修正が全部入っています）
4. 10分ほど待つ。緑の ✓ が出れば成功
5. TestFlightに自動で上がるので、iPhoneのTestFlightアプリで更新して動作確認

> ビルドが赤で失敗したら、ログの最後の20行くらいをコピーして私に貼ってください。

---

## STEP 3. 審査用のデモアカウントを作る（10分）

Appleの審査員がログインして中身を確認するために必要です。

**やること**
1. iPhoneのBodyLogアプリで、いまのアカウントから**サインアウト**
   （設定 → いちばん下のログアウト）
2. **新規登録**で審査用アカウントを作る
   - メール: 使っていないGmailなど（例: `bodylog.review@gmail.com`）
   - パスワード: メモしておく
3. プロフィールを入力（性別・身長・年齢）
4. 目標を設定（体重の目標）
5. **記録を数日分入れる**（審査員が空っぽの画面を見ないように）
   - 食事を3〜4件（「唐揚げ定食」などでOK）
   - 体重を2〜3日分
   - 運動を1〜2件
6. 終わったら自分のアカウントに戻す

> メールアドレスとパスワードは STEP 5 で使うのでメモしておいてください。

---

## STEP 4. スクリーンショットを撮る（10分）

**必要なもの**: iPhone 6.9インチ用に **最低3枚**（推奨5枚）

いまお使いのiPhoneで撮ったスクショをそのまま使えます。おすすめの画面:

| # | 画面 | 撮り方 |
|---|---|---|
| 1 | 食事タブ | 記録が数件入った状態。「あと食べられる」の数字が主役 |
| 2 | 概要タブ | 体重グラフが見えている状態 |
| 3 | 相談タブ | AIの回答が表示されている状態 |
| 4 | 運動タブ | かんたん記録の一覧 |
| 5 | 概要タブ下部 | 過食の引き金 or 数字で見る |

撮ったら iPhone から Mac/PC に送っておいてください（AirDrop・メール添付など）。

---

## STEP 5. App Store Connectで申請（15分）

**開くURL**
👉 https://appstoreconnect.apple.com/apps

**やること**

### 5-1. バージョンを作る
1. **BodyPlatform** を選ぶ
2. 左メニューの一番上に「iOS App」があるので、その横の **⊕** を押して **1.0** を作成

### 5-2. 情報を入力
`docs/app-store-release.md`（先にお渡ししたファイル）から**コピペ**してください。

| 入力欄 | 値 |
|---|---|
| 名前 | BodyLog - AI食事・体重記録 |
| サブタイトル | 1行書くだけ。AIが栄養とカロリーを推定 |
| プロモーション用テキスト | （ファイルの該当箇所） |
| 説明 | （ファイルの該当箇所） |
| キーワード | （ファイルの該当箇所） |
| サポートURL | https://bodylog-orcin.vercel.app/support |
| プライバシーポリシーURL | https://bodylog-orcin.vercel.app/privacy |

### 5-3. スクショをアップ
STEP 4で撮った画像をドラッグ&ドロップ

### 5-4. ビルドを選ぶ
「ビルド」欄で、STEP 2でアップされた最新のものを選択

### 5-5. App Privacy（プライバシー）に回答
左メニューの **App Privacy** → 「編集」から:

| 種類 | 回答 |
|---|---|
| 健康とフィットネス | 収集する・ユーザーに紐づく・**トラッキングしない** |
| 連絡先情報（メール） | 収集する・ユーザーに紐づく |
| ユーザーコンテンツ（写真） | 収集する・ユーザーに紐づく |
| 識別子（ユーザーID） | 収集する・ユーザーに紐づく |
| トラッキング | **なし** |

### 5-6. 審査メモを書く
「App Review Information」の欄に:
- **サインイン必須**: はい
- **ユーザー名**: STEP 3で作ったメールアドレス
- **パスワード**: STEP 3で決めたパスワード
- **メモ欄**:
```
・ヘルスケア（HealthKit）は読み取りのみ使用（体重・ワークアウト）。書き込みは行いません。
・食事の栄養推定にGoogle Gemini APIを使用しています。プライバシーポリシーに明記済みです。
・アカウント削除はアプリ内「設定 → アカウントを削除」から完結します。
・医療的な診断は行わない旨を、AI相談画面に常時表示しています。
```

### 5-7. 提出
右上の **「審査に提出」** を押して完了！

---

## 提出後

- 審査は通常 **1〜2日**。結果はメールで届きます
- 「Approved」になったら、自動または手動でリリース（設定した方）
- リジェクトされたら、Appleからの指摘文をそのまま私に貼ってください。対応します

---

## よく使うURL一覧

| 用途 | URL |
|---|---|
| Supabase SQL実行 | https://supabase.com/dashboard/project/rhyfspqxsfpdogzmizic/sql/new |
| Supabase テーブル確認 | https://supabase.com/dashboard/project/rhyfspqxsfpdogzmizic/editor |
| Codemagic ビルド | https://codemagic.io/apps |
| App Store Connect | https://appstoreconnect.apple.com/apps |
| Apple Developer | https://developer.apple.com/account |
| Vercel（Web側） | https://vercel.com/kumataeitaros-projects/bodylog |
| 公開中のWeb版 | https://bodylog-orcin.vercel.app |
| GitHub | https://github.com/KumataEitaro/Body-log-App |

---

## 補足: いまリリースに含まれないもの（v1.1で対応）

- **Googleログイン**: Appleの規約で、Googleログインを載せるなら「Appleでサインイン」も必須になります。今回はメール+パスワードのみで出し、次のバージョンで両方まとめて対応します（ボタンは非表示にしてあります）
- **英語以外の言語**: 仕組みは完成しているので、翻訳を辞書に入れるだけで有効になります
