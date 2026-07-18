# BodyLog デプロイ手順

構成: Next.js（Vercel）＋ Supabase（認証・DB）＋ Gemini（食事解析）。すべて無料枠で動きます。

## 1. Supabase プロジェクト作成（あなたが実施・5分）
1. https://supabase.com → Sign up（GitHubまたはGoogleでOK）
2. New project → Name: `bodylog` / Region: Tokyo (Northeast Asia) / DB Password: 自動生成でOK（控えておく）
3. 作成後、**Project Settings → API** を開き、次の2つを控える:
   - `Project URL`（https://xxxx.supabase.co）
   - `anon public` キー
   ※この2つは公開前提の値なのでチャットで私に共有してOK
4. **SQL Editor** → New query → `supabase/schema.sql` の中身を貼って Run
5. **Authentication → Providers → Email** で
   - `Confirm email` を **OFF** にする（友達が確認メール無しで即使えるように。Supabase無料枠はメール送信数が厳しいため）

## 2. Vercel アカウント作成（あなたが実施・3分）
1. https://vercel.com → Sign up（GitHubアカウント推奨）
2. 完了したら教えてください。あとは私が `vercel` CLI でログイン→デプロイまで進めます
   （ログイン時にブラウザで承認1クリックだけお願いします）

## 3. 環境変数（キーはあなたが直接設定）
Vercel の Project → Settings → Environment Variables に以下を設定:
| Name | Value | 備考 |
|---|---|---|
| NEXT_PUBLIC_SUPABASE_URL | SupabaseのProject URL | 公開可 |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | anon publicキー | 公開可 |
| GEMINI_API_KEY | aistudio.google.com/apikey で発行 | **秘密。あなたが直接貼る** |

## 4. 友達への案内
デプロイ後のURL（例: https://bodylog-xxxx.vercel.app）を送るだけ。
1. メールアドレス＋パスワードでアカウント作成
2. 身長・年齢・性別・体重を入れる（目安kcalが自動計算される）
3. 毎日「食事メモを自然文で書く → AI解析 → 保存」

## ローカル開発
```
cp .env.local.example .env.local   # 値を埋める
npm run dev                        # http://localhost:3000
```

## データ移行（熊田さんの過去実績）
ログイン後、「設定」タブ → 過去データの一括取込 に JSON を貼る。
（JSONは Claude が xlsx から生成して渡します）
