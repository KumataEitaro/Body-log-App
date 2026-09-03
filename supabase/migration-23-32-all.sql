-- ============================================================
-- BodyLog migration 23〜32 まとめ（2026-09-04 作成）
-- 実行先: https://supabase.com/dashboard/project/rhyfspqxsfpdogzmizic/sql/new
--
-- これ1本で 23〜32 の全てが入る。全て再実行安全なので、
-- 一部が既に入っていても、丸ごと貼り直して問題ない。
--
-- ⚠️ 27 を実行すると、次回起動で全ユーザーに再同意画面が出る
--    （規約を全面改訂したので正しい挙動）。
--
-- 個別のファイルは supabase/migration-<番号>.sql に残してある（設計理由つき）。
-- ============================================================

-- ==================== migration-23 ====================
-- BodyLog migration-23: 新ティア設計（free/liteのAI回数変更）＋クーポン機構
-- 【ユーザー実行待ち】Supabase SQL Editor で実行:
-- https://supabase.com/dashboard/project/rhyfspqxsfpdogzmizic/sql/new
--
-- 新ティア表（2026-09-01決定）:
--   AIテキスト解析: free 3回/日・lite 5回/日・standard 50・premium 100
--   AI写真解析:     free 1枚/日・lite 2枚/日・standard 5・premium 30
--   AI相談:         free/lite 0（ロック）・standard 10・premium 50 セッション/日
-- 値は lib/plan.ts の FALLBACK と揃えること（DBが読めない時の保険が同じ設計になるように）。

-- 1) free/liteの上限を新ティアへ（standard/premiumは据え置き）
update public.plan_limits set text_day = 3, photo_day = 1, coach_day = 0 where plan = 'free';
update public.plan_limits set coach_day = 0 where plan = 'lite';  -- text5/photo2は据え置き

-- 2) クーポンコード（発行台帳）。plan='lite'|'standard'|'premium' を無期限で付与する
create table if not exists public.coupon_codes (
  code text primary key,
  plan text not null,
  max_uses int not null default 1,
  used_count int not null default 0,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
-- RLS: 有効化するがポリシーを一切作らない＝anon/authenticatedからは全操作不可。
-- 触れるのは service role（/api/redeem-coupon）だけ（コードの総当たり列挙をDB層で防ぐ）
alter table public.coupon_codes enable row level security;

-- 3) 使用履歴（PK=(user_id, code) で「1ユーザー1コード1回」をDB層で保証）
create table if not exists public.coupon_redemptions (
  user_id uuid not null references auth.users(id) on delete cascade,
  code text not null,
  redeemed_at timestamptz not null default now(),
  primary key (user_id, code)
);
-- RLS: 本人が自分の使用履歴をselectできるのみ（insert/update/deleteはservice roleだけ）
alter table public.coupon_redemptions enable row level security;
drop policy if exists "coupon_redemptions_read_own" on public.coupon_redemptions;
create policy "coupon_redemptions_read_own" on public.coupon_redemptions
  for select using (auth.uid() = user_id);

-- 発行例（コードは好きな文字列。下は「20人まで使えるpremium無期限クーポン」）:
-- insert into coupon_codes (code, plan, max_uses) values ('<好きなコード>', 'premium', 20);
-- 期限つきにするなら:
-- insert into coupon_codes (code, plan, max_uses, expires_at) values ('<好きなコード>', 'standard', 50, '2026-12-31 23:59:59+09');

-- ==================== migration-24 ====================
-- BodyLog migration-24: マイミール（複数品目のセット保存→1タップ再記録）
-- 【ユーザー実行待ち】Supabase SQL Editor で実行:
-- https://supabase.com/dashboard/project/rhyfspqxsfpdogzmizic/sql/new
--
-- 1500人ペルソナ監査ペイン3位「定番の食事を毎回AIに通すのが面倒」への対応。
-- 「今日の記録」の食事行・トレイの✓保存長押しからセット（items配列）を名前つきで保存し、
-- 食事タブのチップから1タップでトレイへ全品目を呼び出す（AI解析なし・保存済み栄養値をそのまま）。
-- アプリはこのテーブルが無くても壊れない（読み込み失敗は空扱い＝チップ非表示）。

create table if not exists public.my_meals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  items jsonb not null,
  created_at timestamptz not null default now()
);

-- RLS: 本人のみ全操作可
alter table public.my_meals enable row level security;
drop policy if exists "my_meals_own" on public.my_meals;
create policy "my_meals_own" on public.my_meals
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 一覧は「本人の登録順」で読むだけなので複合インデックスを1本
create index if not exists my_meals_user_created on public.my_meals (user_id, created_at);

-- ==================== migration-25 ====================
-- BodyLog migration-25: バイタル記録（血圧・脈拍・血糖）
-- 【ユーザー実行待ち】Supabase SQL Editor で実行:
-- https://supabase.com/dashboard/project/rhyfspqxsfpdogzmizic/sql/new
--
-- 1500人ペルソナ監査Later群「中高年・健康管理層の本丸」。
-- 体重とカロリーだけでは、健診で「血圧を気にして」と言われた層の受け皿にならない。
-- 1日1件（unique(user_id,date)）で血圧・脈拍・血糖を残し、概要タブ「からだ」の
-- バイタル行と、受診用PDFレポート（直近30日）の材料にする。
-- アプリはこのテーブルが無くても壊れない（読み込み失敗は空扱い＝表もグラフも空状態のまま）。

create table if not exists public.vitals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  systolic int,     -- 収縮期血圧（上）mmHg
  diastolic int,    -- 拡張期血圧（下）mmHg
  pulse int,        -- 脈拍 bpm
  glucose int,      -- 血糖値 mg/dL
  note text,
  created_at timestamptz not null default now(),
  unique (user_id, date)
);

-- RLS: 本人のみ全操作可（他人の血圧が絶対に見えない）
alter table public.vitals enable row level security;
drop policy if exists "vitals_own" on public.vitals;
create policy "vitals_own" on public.vitals
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 読み出しは常に「本人の日付順・直近N日」なので複合インデックスを1本
create index if not exists vitals_user_date on public.vitals (user_id, date);

-- ==================== migration-26 ====================
-- BodyLog migration-26: 食事の制約（除外アラート・B-18）
-- 【ユーザー実行待ち】Supabase SQL Editor で実行:
-- https://supabase.com/dashboard/project/rhyfspqxsfpdogzmizic/sql/new
--
-- ビーガン/グルテンフリー/ハラール等の「食べないもの」を登録し、解析結果に
-- 該当の可能性を警告する機能（docs/DIET-MODES.md）。モードごとに実装せず
-- 「除外リスト＋自由記述」の1つの器にまとめている。
--
-- 既存の profiles.constraints_note（AI相談用の恒常的な前提）とは別カラムにする。
-- あちらは「提案してほしくない」ための好み、こちらは警告の判定基準で、
-- 誤検知のコストが桁違いに違うため混ぜない。
--
-- アプリはこの3列が無くても壊れない（読みはselect('*')でundefined→空扱い、
-- 書きは列を外して再実行するフォールバックを settings.tsx / API側に実装済み）。

alter table public.profiles add column if not exists diet_modes jsonb not null default '[]'::jsonb;
alter table public.profiles add column if not exists diet_custom text;
-- 同意日時: 免責への同意をいつ得たかを残す（後日の紛争で「何にいつ同意したか」を再現するため）。
-- 値が無い＝未同意。アプリは未同意のあいだ機能をONにできない（同意ゲート・docs/DIET-MODES.md §6-2）
alter table public.profiles add column if not exists diet_consent_at timestamptz;

comment on column public.profiles.diet_modes is '食事の制約: 有効なプリセットキーの配列 例 ["vegan","gluten_free"]';
comment on column public.profiles.diet_custom is '食事の制約: 自由記述の排除指定（AIへそのまま渡す・プレミアム）';
comment on column public.profiles.diet_consent_at is '食事の制約: 免責同意の日時（未同意はnull＝機能をONにできない）';

-- ==================== migration-27 ====================
-- BodyLog migration-27: 規約・プライバシーポリシーの再同意フロー
-- 【ユーザー実行待ち】Supabase SQL Editor で実行:
-- https://supabase.com/dashboard/project/rhyfspqxsfpdogzmizic/sql/new
--
-- 規約を改定したとき、既存ユーザー全員に「読んで同意」を取り直す必要がある
-- （改定を告知しただけでは、米国では同意の成立を争われうる）。
-- アプリ側は lib/consent.ts の TERMS_VERSION と比較し、古ければ全画面で同意を求める。
-- 列が無い環境でも壊れない（未同意扱いにせず、静かにスキップする実装）。

alter table public.profiles add column if not exists terms_version text;
alter table public.profiles add column if not exists terms_agreed_at timestamptz;

-- 同意の証跡は上書きせず履歴として残す（後日の紛争で「いつ何に同意したか」を再現できる）
create table if not exists public.consent_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  version text not null,          -- 同意した規約バージョン（例 '2026-09-01'）
  kind text not null default 'terms',  -- terms / privacy / diet 等
  agreed_at timestamptz not null default now()
);
alter table public.consent_log enable row level security;
drop policy if exists "consent_log_own" on public.consent_log;
create policy "consent_log_own" on public.consent_log
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists consent_log_user on public.consent_log (user_id, agreed_at);

-- ==================== migration-28 ====================
-- BodyLog migration-28: 生理周期モード（月経開始日の記録）
-- 【ユーザー実行待ち】Supabase SQL Editor で実行:
-- https://supabase.com/dashboard/project/rhyfspqxsfpdogzmizic/sql/new
--
-- 1500人ペルソナ監査「日本ダイエット層: 女性の周期変動を説明しないグラフが停滞期離脱を生む」。
-- 月経前〜月経中は水分貯留で体重が1〜2kg増えることがある。それを「太った」と誤解すると
-- 理不尽な自己嫌悪と離脱を生む。この機能の目的はただ一つ、「記録した周期と体重の重なりを
-- 見せる」こと。予測もしないし診断もしない（次回予測日は意図的に持たない）。
--
-- 【プライバシー】このテーブルは本アプリで最も機微なデータである。
-- ・RLSは **本人のみ**（select/insert/update/delete すべて auth.uid() = user_id）に限定する。
--   管理者ロール・共有・集計目的の緩いポリシーは絶対に足さない。
-- ・記録するのは「開始日」と任意メモだけ。症状・妊娠可能性・体調スコア等の医療情報は持たない。
-- ・機能自体が既定OFF（アプリ側 AsyncStorage 'bl-cycle-enabled'）で、ONにした本人にしか
--   カードも帯も出ない。OFFの人にはこのテーブルへの読み書きが一度も起きない。
-- ・退会時は on delete cascade で確実に消える（残骸を残さない）。
--
-- アプリはこのテーブルが無くても壊れない（読み込み失敗は空配列扱い＝機能が静かに非表示）。

create table if not exists public.cycle_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  start_date date not null,          -- 月経開始日（記録するのはこれだけ）
  note text,                         -- 任意メモ（本人用の覚え書き。解析には使わない）
  created_at timestamptz not null default now(),
  unique (user_id, start_date)       -- 同じ開始日は1件（二重タップでも増えない）
);

-- RLS: 本人のみ全操作可。他人の周期が絶対に見えない
alter table public.cycle_logs enable row level security;
drop policy if exists "cycle_logs_own" on public.cycle_logs;
create policy "cycle_logs_own" on public.cycle_logs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 読み出しは常に「本人の開始日順・直近N件」なので複合インデックスを1本
create index if not exists cycle_logs_user_start on public.cycle_logs (user_id, start_date);

-- ==================== migration-29 ====================
-- BodyLog migration-29: アプリ内フィードバック（ご意見・不具合の報告）
-- 【ユーザー実行待ち】Supabase SQL Editor で実行:
-- https://supabase.com/dashboard/project/rhyfspqxsfpdogzmizic/sql/new
--
-- 背景: β運用中なのに、ユーザーが不満や不具合を言える口がアプリの中に無かった
-- （開発者本人が手でスクショを送っている状態）。このまま公開すると
-- 「不満を言う場所が無い＝いきなり★1レビュー」になる。まず**アプリ内で受け止める**。
--
-- 【設計方針】
-- ・送るのは本人が書いた文章と、環境（アプリのバージョン・OS・言語）だけ。
--   記録の中身（体重・食事・写真）は一切送らない。何が送られるかはフォーム上に明記する。
-- ・**改ざん防止**のため update / delete のポリシーは作らない（insert と select のみ）。
--   送った本人でも後から書き換えられない＝台帳として信用できる。
-- ・退会時は on delete cascade で確実に消える（残骸を残さない）。
--
-- アプリはこのテーブルが無くても壊れない（送信失敗＝「送信できませんでした」の一行だけ）。

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,                -- 'bug' | 'idea' | 'other'（検証はAPI側・値の追加に強くしておく）
  body text not null,                -- 本文（1〜1000字。API側で長さを検証する）
  app_version text,                  -- 自動で添える環境情報（フォームに明示している3点）
  platform text,
  locale text,
  created_at timestamptz not null default now()
);

-- RLS: 本人の insert と select だけ。update / delete のポリシーは**意図的に作らない**
alter table public.feedback enable row level security;

drop policy if exists "feedback_insert_own" on public.feedback;
create policy "feedback_insert_own" on public.feedback
  for insert with check (auth.uid() = user_id);

drop policy if exists "feedback_select_own" on public.feedback;
create policy "feedback_select_own" on public.feedback
  for select using (auth.uid() = user_id);

-- レート制限（同一ユーザー1日10件）が「本人の当日ぶん」を数えるので、この複合1本で足りる
create index if not exists feedback_user_created on public.feedback (user_id, created_at desc);

-- ==================== migration-30 ====================
-- BodyLog migration-30: リモートコンテンツ（読み物・バッジ・法則の文言をアップデート無しで配信）
-- 【ユーザー実行待ち】Supabase SQL Editor で実行:
-- https://supabase.com/dashboard/project/rhyfspqxsfpdogzmizic/sql/new
--
-- 背景: 読み物を1本足す・バッジを1個足す・法則の文言を直す、のたびにApp Store審査を
-- 通すのは重すぎる。一方で「コードを含む機能」はOTA配信できない（App Store規約）。
-- そこで**宣言的データとして表現できるもの**だけをこのテーブルから配る:
--   readings  … 読み物（純テキスト。完全にリモート化できる）
--   badges    … バッジ（名前・説明・アイコン名・カテゴリ＋獲得条件の宣言的DSL）
--   laws_text … 法則図鑑の文言だけ（検出ロジックはコードなので、法則の追加は要アップデート）
-- payload の形と運用手順は docs/REMOTE-CONTENT.md。
--
-- 【設計方針】
-- ・読むのは全認証ユーザー（select）。書くのは service role だけ（管理者がSQL Editorでinsert）。
--   insert/update/delete の RLS ポリシーは**意図的に作らない**＝アプリのanonキーでは書けない。
-- ・アプリ側は id で同梱データと統合する（同idは上書き＝文言差し替え、新idは追加）。
--   同じ kind の行が複数あれば version昇順→published_at昇順に適用（後勝ち）。
-- ・min_app_version より古いアプリはその行を無視する（新しいDSLのmetricを古い版に見せない）。
-- ・テーブルが空でも・無くてもアプリは壊れない（同梱データだけで動く。取得失敗はキャッシュ→同梱）。

create table if not exists public.remote_content (
  id text primary key,                          -- 例 'readings-2026-09'、'badges-v2'、'laws-text-v1'
  kind text not null check (kind in ('readings', 'badges', 'laws_text')),
  version int not null default 1,               -- 同kind内の適用順（大きいほど後に適用＝優先）
  payload jsonb not null,                       -- { "items": [ ... ] }（形は docs/REMOTE-CONTENT.md）
  published_at timestamptz not null default now(),
  min_app_version text                          -- 例 '1.0.20'。null=全バージョンに配る
);

-- RLS: 認証ユーザーは読める。書き込みポリシーは無し（service role は RLS を通過するので管理者は書ける）
alter table public.remote_content enable row level security;

drop policy if exists "remote_content_select_authenticated" on public.remote_content;
create policy "remote_content_select_authenticated" on public.remote_content
  for select to authenticated using (true);

-- アプリは kind を問わず全行を published_at 順に読む（行数は運用上せいぜい数十）
create index if not exists remote_content_kind_published on public.remote_content (kind, published_at);

-- ==================== migration-31 ====================
-- BodyLog migration-31: マイ食品に品目内訳（items）を持たせる
-- 【ユーザー実行待ち】Supabase SQL Editor で実行:
-- https://supabase.com/dashboard/project/rhyfspqxsfpdogzmizic/sql/new
--
-- 背景: 設定＞マイ食品の管理＞「食品を追加」で、複数の食材（例: 鶏むね肉100g、ブロッコリー50g、
-- 白米150g）をAIで計算して1つのマイ食品として登録できるようにした。合計のkcal/PFCは従来の
-- 列に入るが、何をどれだけ足した結果なのか（内訳）が残らないと後から見直せないため、
-- 品目配列（FoodItem[]）を任意列として持たせる。単品の登録では null のまま。
--
-- アプリはこの列が無くても壊れない: 追加時に列が無いエラー（PGRST204）が返ったら
-- 内訳を落として合計だけで再登録する（lib/foods.ts saveMyFood）。
alter table public.my_foods add column if not exists items jsonb;

-- ==================== migration-32 ====================
-- BodyLog migration-32: リモートコンテンツに kind 'nutrients'（食材ナビの栄養データ）を追加
-- 【ユーザー実行待ち】Supabase SQL Editor で実行:
-- https://supabase.com/dashboard/project/rhyfspqxsfpdogzmizic/sql/new
--
-- 背景: 「食材ナビ」（かしこい置き換え・栄養ランキング図鑑・たんぱく源ティア）は、日本の一般食材 約80品の
-- 栄養データ（native/src/content/nutrientDb.ts・日本食品標準成分表2020年版（八訂）ベースの目安値）で動く。
-- 値の訂正（例: 成分表の改訂）や品目の追加は純データなので、App Store審査を通さずに remote_content から配りたい。
-- 既存の kind（readings / badges / laws_text）と同じテーブル・同じマージ規則（同idは上書き・新idは追加）に乗せる。
--
-- payload の形（items の1要素＝1品目。content/nutrientDb.ts の NutrientFood と同一）と投入例は docs/REMOTE-CONTENT.md §4。
-- 100gあたりの値が妥当範囲（lib/remoteContent.ts NUTRIENT_RANGE_MAX）を超える項目はアプリ側で捨てる（桁違いの数字を図鑑に載せない）。
--
-- 古いアプリ（kind 'nutrients' を知らない版）はこの行を「未知のkind」として無視する（落ちない）。
-- check 制約の付け直しだけで、既存行・RLS・索引はそのまま。

alter table public.remote_content drop constraint if exists remote_content_kind_check;
alter table public.remote_content
  add constraint remote_content_kind_check check (kind in ('readings', 'badges', 'laws_text', 'nutrients'));

-- ==================== 確認（ここまで流したら最後にこれを実行） ====================
-- 期待値: 新テーブル 8 / profiles の新列 5 / nutrients を許す制約 1
select
  (select count(*) from information_schema.tables
     where table_schema = 'public'
       and table_name in ('coupon_codes','coupon_redemptions','my_meals','vitals',
                          'consent_log','cycle_logs','feedback','remote_content')) as new_tables,
  (select count(*) from information_schema.columns
     where table_schema = 'public' and table_name = 'profiles'
       and column_name in ('diet_modes','diet_custom','diet_consent_at',
                           'terms_version','terms_agreed_at')) as profile_cols,
  (select count(*) from information_schema.columns
     where table_schema = 'public' and table_name = 'my_foods'
       and column_name = 'items') as my_foods_items,
  (select count(*) from pg_constraint
     where conname = 'remote_content_kind_check'
       and pg_get_constraintdef(oid) like '%nutrients%') as nutrients_ok,
  (select count(*) from public.plan_limits
     where plan = 'free' and text_day = 3 and photo_day = 1 and coach_day = 0) as free_limits_ok;
-- 正しく通っていれば: new_tables=8 / profile_cols=5 / my_foods_items=1 / nutrients_ok=1 / free_limits_ok=1