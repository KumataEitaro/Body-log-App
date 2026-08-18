-- ===================================================================
-- 審査用デモアカウントに「過去1年分」の記録を生成する
--
-- 【使い方】
--  1. 先にアプリ（またはWeb）でデモ用アカウントを新規登録しておく
--  2. 下の demo_email を、そのアカウントのメールアドレスに書き換える
--  3. このファイル全体をSupabaseのSQL Editorに貼り付けて Run
--
-- 前提: supabase/apply-pending.sql を先に実行済みであること（bodyfat・ex_minutes列を使うため）
-- 何度実行しても同じ結果になる（対象ユーザーの既存データを消してから入れ直す）。
-- 対象ユーザー以外のデータには一切触れない。
-- ===================================================================

do $$
declare
  -- ▼▼▼ ここだけ書き換える ▼▼▼
  demo_email text := 'bodylog.review@gmail.com';
  -- ▲▲▲ ここだけ書き換える ▲▲▲

  uid uuid;
  d date;
  today date := (now() at time zone 'Asia/Tokyo')::date;
  start_d date;

  day_idx int;
  dow int;                  -- 0=日 .. 6=土
  wk int;

  w numeric;                -- その日の体重
  bf numeric;               -- 体脂肪率
  base_w numeric;           -- トレンド上の体重
  intake numeric; p numeric; f numeric; c numeric;
  ex_level text;
  ex_adj numeric;
  is_binge boolean;
  is_rest boolean;
  skip_day boolean;
  mood_txt text;
  mi int;

  -- 食事メニュー: 各行 [名前, kcal, P, F, C]
  -- ※PostgreSQLの2次元配列は arr[i] で行を取り出せないため、必ず arr[i][j] で参照する
  bf_menu  text[] := array[
    ['納豆ごはん、味噌汁、焼き鮭',            '520','32','14','62'],
    ['トースト2枚、目玉焼き、ヨーグルト',      '480','24','18','54'],
    ['オートミール、プロテイン、バナナ',       '430','35','8','52'],
    ['ごはん、卵焼き、ほうれん草のおひたし',    '450','22','12','58'],
    ['シリアル、牛乳、ゆで卵2個',             '510','28','16','60']
  ];
  lu_menu  text[] := array[
    ['鶏むね肉のサラダボウル、玄米',          '620','48','16','66'],
    ['そば、天ぷら少々',                     '680','24','22','92'],
    ['コンビニのサラダチキン、おにぎり2個',    '560','38','8','82'],
    ['生姜焼き定食（ごはん・味噌汁）',        '780','36','28','88'],
    ['パスタ（トマトソース）、サラダ',        '640','22','18','96'],
    ['牛丼（並）、味噌汁',                   '720','26','24','98']
  ];
  di_menu  text[] := array[
    ['鶏胸肉200g、じゃがいも、玉ねぎ',        '640','52','14','72'],
    ['焼き魚、ごはん、味噌汁、小鉢',          '610','38','18','68'],
    ['豚しゃぶサラダ、豆腐、ごはん',          '580','42','20','54'],
    ['鍋（鶏肉・野菜）、雑炊',               '520','40','12','58'],
    ['ステーキ150g、温野菜',                 '700','48','36','24'],
    ['刺身盛り合わせ、ごはん、味噌汁',        '560','44','10','66']
  ];
  sn_menu  text[] := array[
    ['プロテイン1杯',                        '120','24','2','3'],
    ['ヨーグルト、ナッツ少々',                '180','10','12','8'],
    ['コーヒー、チョコ2粒',                  '110','2','7','11'],
    ['バナナ1本',                            '90','1','0','23']
  ];
  bg_menu  text[] := array[
    ['お萩2個、まんじゅう1個',               '430','6','9','82'],
    ['ポテトチップス1袋、アイス',             '680','8','38','76'],
    ['菓子パン2個、カフェオレ',               '620','12','24','88'],
    ['ラーメン、餃子、ビール2本',             '1180','38','42','128']
  ];

  ex_names text[] := array['ウォーキング','ランニング','自転車','散歩'];
  ex_mets numeric[] := array[3.5, 8.0, 6.0, 3.0];
  ei int;
  ex_min int;
  ex_kcal int;

  lift_names text[] := array['ベンチプレス','スクワット','デッドリフト','ラットプルダウン','ショルダープレス'];
  lift_base numeric[] := array[60, 80, 90, 45, 30];
  li int;
  lift_kg numeric;
  lift_txt text;

  -- 1食ぶんをlogsへ入れる内部処理を使い回すための変数
  mname text; mk numeric; mp numeric; mf numeric; mc numeric;
  at_ts timestamptz;
begin
  select id into uid from auth.users where email = demo_email;
  if uid is null then
    raise exception 'ユーザーが見つかりません: %  — 先にアプリで新規登録してください', demo_email;
  end if;

  start_d := today - 364;

  delete from public.logs where user_id = uid;
  delete from public.entries where user_id = uid;
  delete from public.my_foods where user_id = uid;

  -- プロフィール（35歳・男性・172cm）
  insert into public.profiles (id, display_name, sex, height_cm, age, init_weight, life_factor)
  values (uid, 'デモユーザー', 'male', 172, 35, 88.0, 1.35)
  on conflict (id) do update set
    display_name = excluded.display_name, sex = excluded.sex, height_cm = excluded.height_cm,
    age = excluded.age, init_weight = excluded.init_weight, life_factor = excluded.life_factor;

  -- 目標（88kg→76kg・現在も継続中）
  insert into public.goals (
    user_id, start_date, start_weight, start_bf, target_date, target_weight, target_bodyfat,
    protein_per_kg, fat_per_kg, ex_per_week, ex_weekly_kcal, ex_min_minutes, note
  )
  values (
    uid, start_d, 88.0, 26.0, today + 60, 76.0, 16.0,
    2.0, 0.8, 4, 2000, 20, '無理なく続けることを最優先'
  )
  on conflict (user_id) do update set
    start_date = excluded.start_date, start_weight = excluded.start_weight,
    start_bf = excluded.start_bf, target_date = excluded.target_date,
    target_weight = excluded.target_weight, target_bodyfat = excluded.target_bodyfat,
    protein_per_kg = excluded.protein_per_kg, fat_per_kg = excluded.fat_per_kg,
    ex_per_week = excluded.ex_per_week, ex_weekly_kcal = excluded.ex_weekly_kcal,
    ex_min_minutes = excluded.ex_min_minutes;

  insert into public.training_goals (user_id, name, target_kg) values
    (uid, 'ベンチプレス', 90), (uid, 'スクワット', 120), (uid, 'デッドリフト', 140)
  on conflict (user_id, name) do update set target_kg = excluded.target_kg;

  insert into public.my_foods (user_id, name, kcal, p, f, c) values
    (uid, '鶏むね肉100g', 108, 22.3, 1.5, 0),
    (uid, 'ゆで卵1個', 76, 6.2, 5.2, 0.2),
    (uid, 'プロテイン1杯', 120, 24, 2, 3),
    (uid, '白米150g', 234, 3.8, 0.5, 51.9),
    (uid, '納豆1パック', 100, 8.3, 5, 6.1),
    (uid, 'サラダチキン', 114, 24.1, 1.2, 0.3),
    (uid, 'ブロッコリー100g', 33, 4.3, 0.5, 5.2)
  on conflict (user_id, name) do nothing;

  -- ===== 365日分を生成 =====
  for day_idx in 0..364 loop
    d := start_d + day_idx;
    dow := extract(dow from d)::int;
    wk := day_idx / 7;

    -- 体重: 88kgから緩やかに減少。20〜27週目に停滞期。週末は水分で少し戻る
    base_w := 88.0
      - (case when day_idx < 140 then day_idx * 0.038
              when day_idx < 190 then 140 * 0.038 + (day_idx - 140) * 0.006
              else 140 * 0.038 + 50 * 0.006 + (day_idx - 190) * 0.030 end);
    w  := round((base_w + (case when dow in (0, 6) then 0.35 else 0 end)
                 + (random() - 0.5) * 0.7)::numeric, 1);
    bf := round((26.0 - (88.0 - base_w) * 0.85 + (random() - 0.5) * 0.6)::numeric, 1);

    skip_day := random() < 0.08 and day_idx < 350;   -- 記録が飛ぶ日（現実感）
    is_binge := (not skip_day) and (
      (dow in (5, 6) and random() < 0.22) or
      (day_idx between 140 and 190 and random() < 0.12) or
      random() < 0.04
    );
    is_rest := dow = 0 or (dow = 3 and random() < 0.6) or random() < 0.15;

    if skip_day then
      if random() < 0.5 then     -- 体重だけ測った日
        insert into public.entries (user_id, date, ex, adj, weight, bodyfat, mood)
        values (uid, d, 'オフ', 0, w, bf, '');
        insert into public.logs (user_id, date, at, items, weight, bodyfat, ex, adj, text)
        values (uid, d, (d + time '06:50') at time zone 'Asia/Tokyo', '[]'::jsonb, w, bf, 'オフ', 0, '');
      end if;
      continue;
    end if;

    intake := 0; p := 0; f := 0; c := 0;
    ex_level := 'オフ'; ex_adj := 0;

    -- ---- 朝食 ----
    mi := 1 + floor(random() * array_length(bf_menu, 1))::int;
    mname := bf_menu[mi][1]; mk := bf_menu[mi][2]::numeric; mp := bf_menu[mi][3]::numeric;
    mf := bf_menu[mi][4]::numeric; mc := bf_menu[mi][5]::numeric;
    at_ts := (d + time '07:40' + (random() * interval '40 min')) at time zone 'Asia/Tokyo';
    insert into public.logs (user_id, date, at, items, kcal, p, f, c, ex, adj, text)
    values (uid, d, at_ts,
            jsonb_build_array(jsonb_build_object('name', mname, 'kcal', mk, 'p', mp, 'f', mf, 'c', mc, 'qty', '×1')),
            mk, mp, mf, mc, 'オフ', 0, mname);
    intake := intake + mk; p := p + mp; f := f + mf; c := c + mc;

    -- ---- 昼食 ----
    mi := 1 + floor(random() * array_length(lu_menu, 1))::int;
    mname := lu_menu[mi][1]; mk := lu_menu[mi][2]::numeric; mp := lu_menu[mi][3]::numeric;
    mf := lu_menu[mi][4]::numeric; mc := lu_menu[mi][5]::numeric;
    at_ts := (d + time '12:20' + (random() * interval '50 min')) at time zone 'Asia/Tokyo';
    insert into public.logs (user_id, date, at, items, kcal, p, f, c, ex, adj, text)
    values (uid, d, at_ts,
            jsonb_build_array(jsonb_build_object('name', mname, 'kcal', mk, 'p', mp, 'f', mf, 'c', mc, 'qty', '×1')),
            mk, mp, mf, mc, 'オフ', 0, mname);
    intake := intake + mk; p := p + mp; f := f + mf; c := c + mc;

    -- ---- 間食（6割の日） ----
    if random() < 0.6 then
      mi := 1 + floor(random() * array_length(sn_menu, 1))::int;
      mname := sn_menu[mi][1]; mk := sn_menu[mi][2]::numeric; mp := sn_menu[mi][3]::numeric;
      mf := sn_menu[mi][4]::numeric; mc := sn_menu[mi][5]::numeric;
      at_ts := (d + time '15:30' + (random() * interval '60 min')) at time zone 'Asia/Tokyo';
      insert into public.logs (user_id, date, at, items, kcal, p, f, c, ex, adj, text)
      values (uid, d, at_ts,
              jsonb_build_array(jsonb_build_object('name', mname, 'kcal', mk, 'p', mp, 'f', mf, 'c', mc, 'qty', '×1')),
              mk, mp, mf, mc, 'オフ', 0, mname);
      intake := intake + mk; p := p + mp; f := f + mf; c := c + mc;
    end if;

    -- ---- 夕食 ----
    mi := 1 + floor(random() * array_length(di_menu, 1))::int;
    mname := di_menu[mi][1]; mk := di_menu[mi][2]::numeric; mp := di_menu[mi][3]::numeric;
    mf := di_menu[mi][4]::numeric; mc := di_menu[mi][5]::numeric;
    at_ts := (d + time '19:10' + (random() * interval '70 min')) at time zone 'Asia/Tokyo';
    insert into public.logs (user_id, date, at, items, kcal, p, f, c, ex, adj, text)
    values (uid, d, at_ts,
            jsonb_build_array(jsonb_build_object('name', mname, 'kcal', mk, 'p', mp, 'f', mf, 'c', mc, 'qty', '×1')),
            mk, mp, mf, mc, 'オフ', 0, mname);
    intake := intake + mk; p := p + mp; f := f + mf; c := c + mc;

    -- ---- 過食日の夜食 ----
    if is_binge then
      mi := 1 + floor(random() * array_length(bg_menu, 1))::int;
      mname := bg_menu[mi][1]; mk := bg_menu[mi][2]::numeric; mp := bg_menu[mi][3]::numeric;
      mf := bg_menu[mi][4]::numeric; mc := bg_menu[mi][5]::numeric;
      at_ts := (d + time '21:40' + (random() * interval '60 min')) at time zone 'Asia/Tokyo';
      insert into public.logs (user_id, date, at, items, kcal, p, f, c, ex, adj, text)
      values (uid, d, at_ts,
              jsonb_build_array(jsonb_build_object('name', mname, 'kcal', mk, 'p', mp, 'f', mf, 'c', mc, 'qty', '×1')),
              mk, mp, mf, mc, 'オフ', 0, mname);
      intake := intake + mk; p := p + mp; f := f + mf; c := c + mc;
    end if;

    -- ---- 筋トレ（月・木＋水の半分） ----
    if not is_rest and (dow in (1, 4) or (dow = 2 and random() < 0.5)) then
      lift_txt := '🏋️ ';
      for li in 1..2 loop
        ei := 1 + ((wk + li) % array_length(lift_names, 1));
        lift_kg := lift_base[ei] + floor(wk / 4.0) * 2.5;   -- 4週ごとに2.5kg伸びる
        lift_txt := lift_txt || lift_names[ei] || ' ' || trim_scale(lift_kg) || 'kg×'
                    || (6 + floor(random() * 4)::int) || '×3';
        if li = 1 then lift_txt := lift_txt || '、'; end if;
      end loop;
      insert into public.logs (user_id, date, at, items, ex, adj, text, ex_minutes)
      values (uid, d, (d + time '18:30' + (random() * interval '60 min')) at time zone 'Asia/Tokyo',
              '[]'::jsonb, '通常', 150, lift_txt, 55);
      ex_level := '通常';
      ex_adj := ex_adj + 150;
    end if;

    -- ---- 有酸素 ----
    if not is_rest and random() < 0.55 then
      ei := 1 + floor(random() * array_length(ex_names, 1))::int;
      ex_min := (array[20, 30, 30, 45, 60])[1 + floor(random() * 5)::int];
      ex_kcal := round(ex_mets[ei] * base_w * (ex_min / 60.0) * 1.05)::int;
      insert into public.logs (user_id, date, at, items, ex, adj, text, ex_minutes)
      values (uid, d, (d + time '07:00' + (random() * interval '120 min')) at time zone 'Asia/Tokyo',
              '[]'::jsonb, 'オフ', ex_kcal,
              '🏃 ' || ex_names[ei] || ' ' || ex_min || '分（約' || ex_kcal || 'kcal消費）', ex_min);
      ex_adj := ex_adj + ex_kcal;
      if ex_level = 'オフ' then ex_level := '軽い'; end if;
    end if;

    -- ---- 気分（7割の日） ----
    mood_txt := '';
    if random() < 0.7 then
      mood_txt := case
        when is_binge then (array['2/5','2/5','3/5'])[1 + floor(random() * 3)::int]
        when is_rest  then (array['3/5','4/5'])[1 + floor(random() * 2)::int]
        else (array['4/5','4/5','5/5','3/5'])[1 + floor(random() * 4)::int]
      end;
      insert into public.logs (user_id, date, at, items, ex, adj, mood, text)
      values (uid, d, (d + time '08:05') at time zone 'Asia/Tokyo', '[]'::jsonb, 'オフ', 0, mood_txt, '');
    end if;

    -- ---- 体重 ----
    insert into public.logs (user_id, date, at, items, weight, bodyfat, ex, adj, text)
    values (uid, d, (d + time '06:50') at time zone 'Asia/Tokyo', '[]'::jsonb, w, bf, 'オフ', 0, '');

    -- ---- 日次サマリー ----
    insert into public.entries (user_id, date, ex, adj, intake, p, f, c, weight, bodyfat, mood, food_text)
    values (uid, d, ex_level, ex_adj, intake, p, f, c, w, bf, mood_txt,
            case when is_binge then '夜に食べすぎた' else '' end)
    on conflict (user_id, date) do update set
      ex = excluded.ex, adj = excluded.adj, intake = excluded.intake,
      p = excluded.p, f = excluded.f, c = excluded.c,
      weight = excluded.weight, bodyfat = excluded.bodyfat, mood = excluded.mood,
      food_text = excluded.food_text;
  end loop;

  raise notice '完了: % に365日分のデータを作成しました', demo_email;
end $$;

-- 実行後の確認（件数と体重レンジが出る）
select
  count(*)                             as 日次サマリー件数,
  min(date)                            as 最初の記録,
  max(date)                            as 最後の記録,
  round(max(weight), 1)                as 開始時の体重,
  round(min(weight), 1)                as 最軽量,
  count(*) filter (where intake is null) as 未記録日数
from public.entries e
join auth.users u on u.id = e.user_id
where u.email = 'bodylog.review@gmail.com';
