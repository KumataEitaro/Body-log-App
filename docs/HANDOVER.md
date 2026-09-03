# 引き継ぎ・復旧手順書（PCとGoogleアカウントを失う前提）— 2026-09-03

**前提**: このPC・作業用Googleアカウント・このClaude環境は無くなる。
**残るもと**: `gotcha429@gmail.com`（Apple Developer / App Store Connect / Google Play / AdMob / RevenueCat / Codemagic）、
GitHub（`github.com/KumataEitaro/Body-log-App`）、Supabase、Vercel。

---

## 1. 失うと取り返せないもの（＝Driveへ待避が必須）

待避フォルダは作成済み: **`C:\Users\hashi\Documents\BodyLog-backup\`**
これを**丸ごと自分のGoogle Driveへドラッグ＆ドロップ**する（秘密を含むので**共有しない private フォルダ**へ）。

| # | 中身 | 失ったときの影響 | 再発行 |
|---|---|---|---|
| 1 | **`bodylog-upload-key.keystore` ＋ `keystore-password.txt`** | **Google Playのアプリを二度と更新できない**（パッケージ名を変えて別アプリとして作り直すしかない） | **不可能** ← 最重要 |
| 2 | **`AuthKey_3ZJYG68J6P.p8`**（App Store Connect APIキー） | Codemagicの自動署名・TestFlight配信が止まる | 可（ASCで新規発行し、Codemagicの連携を差し替え）。ただし**p8は発行時に1回だけダウンロードできる**ので、この控えが唯一 |
| 3 | `ios証明書/`（`bodylog_dist.p12` `.key` `.cer` `.csr` `.pem`） | iOS配布証明書。Codemagicは自動署名なので実害は小さい | 可（Apple Developerで再作成。年1回の更新も必要） |
| 4 | `.env.local` | 実害ほぼ無し（**中身はSupabaseの公開URL＋anonキー＋一時トークンだけ**。秘密の本体はVercelの環境変数側にある） | 可 |
| 5 | `icon-source-1254px.png` | アイコンの**元画像**。リポジトリには生成後のPNGしか無い | 不可（作り直し） |
| 6 | `04_Claudeの記憶/` | 次のAIに引き継ぐ前提知識（プロジェクトの決定事項・ハマりどころ） | 不可 |
| 7 | `05_業務メモ_社内限__上げるか要判断/` | **社外秘の業務メモ**（丸和W3・スターゼン・タイミー・SATO）。BodyLogとは無関係。**個人Driveに上げるかは要判断**（会社の情報管理規程に従うこと） | — |

## 2. 失わないもの（＝待避不要）

- **ソースコード・設計文書・SQL**: すべてGitHubにpush済み。ローカルブランチ101本すべてリモートにある（2026-09-03確認）
- **Supabaseのデータとスキーマ**: Supabase側（`rhyfspqxsfpdogzmizic`）
- **Vercelの環境変数**（GEMINI_API_KEY / QA_SECRET / RC_WEBHOOK_SECRET など）: Vercel側。**ローカルには無い**
- **Codemagicの設定**（環境変数グループ `rc`・キーストア登録・ASC連携）: Codemagic側
- **App Store Connect / Play Console / AdMob / RevenueCat の設定**: 各サービス側

## 3. 新しいPCでの復旧手順

```bash
# 1) リポジトリ
git clone https://github.com/KumataEitaro/Body-log-App.git bodylog
cd bodylog && npm install && cd native && npm install

# 2) ローカル環境変数（Driveから .env.local を戻す。無ければVercelから引く）
#    vercel link → vercel env pull .env.local

# 3) 検証が通ることを確認（ここが緑なら復旧成功）
cd native && npx tsc --noEmit && npx jest --silent   # 1250テスト
cd .. && npm test                                     # vitest 265テスト
```

- **キーストアは新PCに置く必要はない**（Codemagicに登録済みの `bodylog_keystore` を使うため）。Driveの控えは「Codemagicのアカウントも失ったとき」の保険
- **p8も同様**（Codemagicの `bodylog-asc` 連携が生きていれば不要）

## 4. サービスと識別子の一覧（秘密ではない値）

| 項目 | 値 |
|---|---|
| Apple Team ID | `JBQJBFY3JJ` |
| iOS Bundle ID | `com.gotcha.bodylog.rn` |
| Android パッケージ名 | `com.gotcha.bodylog.rn`（**変更不可**） |
| App Store 表示名 | BodyLoger |
| Supabase プロジェクト | `rhyfspqxsfpdogzmizic` |
| Web / API | `https://bodylog-orcin.vercel.app` |
| AdMob | pub-3319916143033433（iOS App ID `~3403103040` / banner `/6775266640`、Android `~9006783518` / `/4738084646`） |
| Codemagic ワークフロー | `rn-testflight`（iOS）/ `rn-android`（Play・.aab手動アップロード） |
| GitHub | `github.com/KumataEitaro/Body-log-App` |

## 5. 次のAIへの引き継ぎ（Claude環境が変わるとき）

`04_Claudeの記憶/` の `.md` を新環境のメモリディレクトリへ置く。とくに読ませるべきもの:

- `bodylog-project.md` / `bodylog-v2-service.md` / `bodylog-rn-migration.md` — 何を作っているか
- `bodylog-release-management.md` — 版の切り方（ビルド毎にパッチ+1・提出前にMINOR切り上げ）
- `bodylog-codemagic-signing.md` — **署名の罠**（自動署名でも古いプロファイルを再利用する／`plutil`はドット入りキーで静かに失敗する）
- `feedback-self-audit-procedure.md` — 「自己検閲して」の手順
- `feedback-parallel-agents-worktrees.md` — 並行作業は専用worktreeで
- `feedback-include-urls.md` — 操作依頼にはURLを添える

リポジトリ側の正本も併せて読ませる: `docs/STRATEGY.md`（中心命題と判断ゲート）→ `docs/FEATURES.md`（全機能）→ `docs/BACKLOG.md` → `docs/RELEASE.md` / `RELEASE-RISKS.md`。

## 6. 残っている作業（2026-09-03時点）

- **Supabase SQL 10本（23〜32）が未実行** → `docs/` 各設計書に全文。SQL Editor: `https://supabase.com/dashboard/project/rhyfspqxsfpdogzmizic/sql/new`
- iOSは1.1.0のビルド成功済み（build 81）→ TestFlight確認 → App Store提出
- Google Playは開発者登録（$25・本人確認）→ 内部テスト → **クローズドテスト12人×14日** → 製品版
- **RC_WEBHOOK_SECRETのローテーション**（課金を点火する前に必須・スクショで漏洩済み）
- カレンダー連携（B-19）は1.2.0の主機能として設計済み
