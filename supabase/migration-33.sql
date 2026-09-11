-- BodyLog migration-33: profiles 行の存在保証（QA P0-3）＋ プラン列のクライアント書き換え防止（QA P1-7）
-- 【ユーザー実行待ち】Supabase SQL Editor で実行:
-- https://supabase.com/dashboard/project/rhyfspqxsfpdogzmizic/sql/new
--
-- ■ 1) profiles 行の存在保証（QA 2026-09-10 P0-3 / P1-2）
-- これまで public.profiles に行を作る箇所はアプリのオンボーディング（upsert）1か所だけで、
-- 「あとで設定」を押した人・Apple連携で作り直した人には行が無かった。
-- 行が無いと `.update().eq('id', uid)` が **0行更新 / error=null**（PostgRESTは204）になり、
--   ・プロフィール保存が「保存しました。」を出して捨てられる
--   ・規約同意（terms_version）が永久に null → 起動のたびに再同意ゲートが出る無限ループ
--   ・食事の制約（アレルギー）が保存されない ＝ 安全に直結
-- という形で壊れる。アプリ側にも保険（native/src/lib/profileRow.ts の ensureProfileRow）を
-- 入れたが、**正しい直しはここ**。auth.users への insert と同じトランザクションで行を作る。
--
-- ■ 2) プラン列の凍結（QA 2026-09-10 P1-7）
-- profiles の RLS は `for all using (auth.uid() = id)` の1本だけで、後から生えた
-- plan / plan_until（＝エンタイトルメントの正本）にもそのまま掛かっていた。つまり
-- anonキー＋自分のJWTで `update profiles set plan='premium', plan_until=null` を投げるだけで
-- 有料プランを自分に付与できた（lib/plan.ts は plan_until=null の有料プランを無期限扱いする＝
-- rc-webhook の降格ガードもすり抜ける）。課金の点火（TODO A9）より先に入れる必要がある。
--
-- 冪等（何度実行しても同じ）。既存行・既存ポリシー・索引は変更しない。

-- ============================================================
-- 1) 新規ユーザーに profiles 行を自動で作る
-- ============================================================
-- security definer: auth.users のトリガから public.profiles へ書くため（呼び出し元は認証前）。
-- search_path を固定するのは、security definer 関数の乗っ取り（検索パス経由）を防ぐ定石。
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end $$;

-- サインアップを絶対に失敗させないための注意:
-- profiles の列に after-insert で埋まらない not null（default 無し）を足すと、この insert が
-- 失敗して **新規登録そのものが 500 になる**。列を足すときは必ず default を付けること。
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- 2) 既存ユーザーのバックフィル（行が無い人に空行を作る）
-- ============================================================
-- 列はすべて default を持つので id だけで足りる（display_name='' / sex='male' /
-- height_cm=170 / age=30 / life_factor=1.3）。既存行は on conflict で触らない。
insert into public.profiles (id)
select u.id from auth.users u
on conflict (id) do nothing;

-- ============================================================
-- 3) plan / plan_until をクライアントから書き換えられなくする
-- ============================================================
-- 列単位のRLSは書けないので before insert/update トリガで「客が書いた値を捨てて元に戻す」。
-- service_role（/api/rc-webhook・/api/redeem-coupon）だけが変更できる。
--
-- **insert も塞ぐ**のが要点: profiles_own は for all なので、客は自分の行を delete してから
-- plan='premium' で insert し直せる。update だけ守っても迂回されるため、insert では既定値へ倒す。
--
-- photo_trial_used は **減らす方向だけ** 拒否する（0にリセットして枠を無限に復活させる攻撃を止める）。
-- 増やす経路は app/api/parse-food/route.ts:151 と app/api/menu-advice/route.ts:138 にあり、
-- サーバー上のコードだが **ログイン中ユーザー本人のJWT**（cookie経由のSSRクライアント）で書いている。
-- ここで一律に凍結すると、その加算が黙って効かなくなる（いまは plan_limits の
-- photo_trial_total が全プラン0なので実害は無いが、静かに壊れた状態を作らない）。
-- 加算を service role へ移したら、この分岐も plan と同じ「常に元へ戻す」に締められる。
--
-- security definer にはしない: この関数は NEW を書き換えるだけでテーブルに触らないため、
-- 呼び出し元の権限で十分（definer にすると不要な権限昇格の面が増える）。
create or replace function public.protect_profile_entitlements()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- 凍結するのは **API 経由のクライアント**（PostgREST が切り替える anon / authenticated ロール）だけ。
  -- service_role（rc-webhook・redeem-coupon）と、SQL Editor・psql（postgres ロール＝管理者の手作業）は通す。
  -- auth.role() で判定すると SQL Editor は JWT が無く null になり、管理者のプラン付与まで黙って
  -- 元に戻されてしまうので current_user（セッションの実ロール）で見る
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      new.plan             := 'free';
      new.plan_until       := null;
      new.photo_trial_used := 0;
    else
      new.plan       := old.plan;
      new.plan_until := old.plan_until;
      if new.photo_trial_used < old.photo_trial_used then
        new.photo_trial_used := old.photo_trial_used;
      end if;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists profiles_protect_entitlements on public.profiles;
create trigger profiles_protect_entitlements
  before insert or update on public.profiles
  for each row execute function public.protect_profile_entitlements();

-- 注: ai_usage（日次のAI利用回数）は今回**触っていない**。
-- 加算（app/api/*/route.ts の `ai_usage.upsert`）が、サーバー上のコードとはいえ
-- ログイン中ユーザー本人のJWTで走っているため、client から update を外すと
-- カウンタが止まる。「加算を service role に寄せる」→「ai_usage の update を service_role 限定にする」
-- の順で別途対応する（QA P1-7 修正案2）。現状は自己申告の日次カウンタを自分でリセットできる。

-- ============================================================
-- 4) 確認クエリ（実行後にそれぞれを流して、期待どおりか目視する）
-- ============================================================
-- (a) profiles 行が無いユーザーが 0 人であること → missing_profiles = 0
--     select count(*) as missing_profiles
--       from auth.users u left join public.profiles p on p.id = u.id
--      where p.id is null;
--
-- (b) 2つのトリガが載っていること → 2行返る
--     （on_auth_user_created / auth.users, profiles_protect_entitlements / profiles）
--     select t.tgname, c.relname
--       from pg_trigger t join pg_class c on c.oid = t.tgrelid
--      where t.tgname in ('on_auth_user_created', 'profiles_protect_entitlements');
--
-- (c) プラン列が凍っていること（**アプリと同じ anon キー＋ログイン中のJWT**で試すこと。
--     SQL Editor は postgres ロールで走り、管理者の手作業として意図的に通す設計なので、
--     ここで update しても凍結の確認にはならない）
--     update profiles set plan='premium', plan_until=null where id = auth.uid();
--     select plan from profiles where id = auth.uid();   -- → 'free' のまま（エラーは出ない）
--     delete from profiles where id = auth.uid();
--     insert into profiles (id, plan) values (auth.uid(), 'premium');
--     select plan from profiles where id = auth.uid();   -- → 'free'（insert 経由の迂回も塞がっている）
--
-- (d) service_role からの正規の更新は通ること（rc-webhook / redeem-coupon の経路）
--     → /api/redeem-coupon でクーポンを1回使い、profiles.plan が変わることを確認する

notify pgrst, 'reload schema';
