-- ===================================================================
-- 審査・スクリーンショット用デモアカウントに「過去1年分」の記録を生成する
--
-- 実行先（SupabaseのSQL Editor・新規クエリ）:
-- https://supabase.com/dashboard/project/rhyfspqxsfpdogzmizic/sql/new
--
-- 【使い方】
--  1. 先にアプリ（またはWeb）でデモ用アカウントを新規登録しておく
--  2. 下の demo_email を、そのアカウントのメールアドレスに書き換える
--  3. このファイル全体をSQL Editorに貼り付けて Run
--  4. いちばん下に出る確認クエリの結果で件数を目視する
--
-- 前提: supabase/apply-pending.sql を先に実行済みであること（bodyfat・ex_minutes列を使う）。
--       未適用なら冒頭で「何が足りないか」を名指しして止まる。
--       migration-20/22/24/25 が未適用でも落ちない（該当テーブルだけ静かに飛ばす）。
--
-- 冪等: setseed で乱数を固定しているので、何度実行しても **まったく同じデータ** になる。
--       対象ユーザーの既存データを消してから入れ直す。対象ユーザー以外には一切触れない。
--
-- 生成しないもの:
--   ・body_photos … 行は入れられるが画像の実体は Storage にしか置けない。行だけ入れると
--                   カードが「灰色の空枠＋日付」で出る（クラッシュはしない）。スクショでは
--                   みっともないので既定はOFF。実物の写真を入れる手順は
--                   docs/release-steps.md STEP 3-b / docs/app-store-release.md 参照
--   ・cycle_logs  … デモは35歳男性。生理周期モードは設定でONにした人だけの機能なので入れない
-- ===================================================================

do $$
declare
  -- ▼▼▼ ここだけ書き換える ▼▼▼
  demo_email text := 'bodylog.review@gmail.com';
  -- 体の写真の「行だけ」を入れるか。true にすると概要タブのカードに日付と体脂肪率が並ぶが、
  -- 画像は灰色の空枠になる（Storageに実体が無いため）。スクショを撮るなら false のまま、
  -- アプリの「撮影」ボタンから本物を5枚入れること（手順は docs/release-steps.md STEP 3-b）
  seed_body_photos boolean := false;
  -- ▲▲▲ ここだけ書き換える ▲▲▲

  uid uuid;
  today date := (now() at time zone 'Asia/Tokyo')::date;
  start_d date;
  pr_day date;                -- 自己ベストを置く日（きょうのハイライトに載せるため直近に固定）
  d date;

  day_idx int;
  dow int;                    -- 0=日 .. 6=土
  wk int;
  blk int; phase int;

  -- からだ
  base_w numeric;             -- トレンド上の体重（停滞期・年末年始の戻りを含む）
  w numeric; bf numeric; waist numeric;
  sys int; dia int; pulse int; glu int;

  -- その日のフラグ
  skip_day boolean; is_binge boolean; is_rest boolean;
  is_recent boolean; is_today boolean; terse boolean; prev_binge boolean := false;
  is_party boolean; is_summer boolean;
  p_skip numeric; p_binge numeric;

  -- その日の集計
  intake numeric; pp numeric; ff numeric; cc numeric;
  ex_total numeric;           -- Σ(EX_ADD[log.ex] + log.adj)。native/src/lib/day.ts と同じ定義
  max_ex text;                -- その日の最高強度（表示用）
  ent_adj numeric;            -- entries.adj = ex_total - EX_ADD[max_ex]（summarizeDay と一致させる）
  mood_txt text; food_text text; note_txt text;
  day_target numeric;         -- その日の目安kcal（BMR×生活係数＋運動ぶん）

  -- 献立の組み立て（1日ぶんを配列に積んでから、まとめて logs へ流す）
  m_menu text[]; m_at timestamptz[];
  a text[];                   -- '名前|kcal|p|f|c|salt|fib|sug|k|ca|mg|fe|zn|vd|vc' を split したもの
  kk int; mi int;

  -- 筋トレ
  lift_names text[] := array['ベンチプレス','スクワット','デッドリフト','ラットプルダウン','ショルダープレス'];
  lift_base  numeric[] := array[60, 80, 90, 45, 30];
  lift_mult  numeric[] := array[1.0, 1.5, 1.7, 0.9, 0.7];
  best_kg    numeric[] := array[0, 0, 0, 0, 0];
  -- 4週=1ブロックの伸び（kg）。一直線ではなく、伸びない月（同値）を3回はさむ
  gain_steps numeric[] := array[0, 2.5, 5.0, 7.5, 7.5, 10.0, 12.5, 12.5, 15.0, 17.5, 17.5, 20.0, 22.5, 25.0];
  gain numeric; topkg numeric; lift_kg numeric; reps int;
  li int; ei int; is_pr boolean; lift_txt text; pr_hit boolean;

  -- 有酸素
  ex_names text[] := array['ウォーキング','ランニング','自転車','水泳','階段登り','散歩'];
  ex_mets  numeric[] := array[3.5, 8.0, 6.0, 5.5, 7.0, 3.0];
  ex_pace  numeric[] := array[0.10, 0.17, 0.33, 0, 0, 0.08];  -- km/分（0=距離を残さない種目）
  ci int; ex_min int; ex_kcal int; ex_km numeric;

  -- メモの丁寧さ（4. 記録の粒度がばらつく）
  notes_good text[] := array[
    'よく噛んで食べた', '満足感あり', '野菜から食べた', '腹八分で止められた',
    'たんぱく質しっかり', '思ったより軽かった', '作り置きが効いてる'
  ];
  notes_bad text[] := array[
    'ちょっと足りない感じ', '食べすぎた', '塩辛かったかも', '断れなかった',
    '惰性で食べた', '夜が遅くなった'
  ];

  -- ===== 献立表 =====
  -- 形式: 名前|kcal|P|F|C|salt(g)|fib(g)|sug(g)|k(mg)|ca(mg)|mg(mg)|fe(mg)|zn(mg)|vd(μg)|vc(mg)
  -- ※ 栄養素キーは native/src/lib/items.ts NUTRIENT_KEYS と同じ10種。これが無いと
  --    概要タブの「わたしの栄養」・栄養ランキングが全部空になる
  -- ※ 酒を含む行は kcal > 4P+9F+4C になる（アルコールは7kcal/gでPFCに入らない）。AI解析の出力と同じ
  bf_wd text[] := array[   -- 平日の朝（3. 曜日の癖: 平日は自炊で規則正しく）
    '納豆ごはん150g、味噌汁、焼き鮭、ほうれん草のおひたし|575|38|16|69|2.8|6.6|3|1060|196|140|3.5|2.8|11.0|22',
    'オートミール60g、プロテイン、バナナ、ギリシャヨーグルト|580|46|11|74|0.6|8.0|20|1250|320|165|3.0|3.6|1.2|14',
    'トースト2枚、目玉焼き2個、ヨーグルト、コーヒー|590|30|24|64|2.4|4.4|10|600|290|78|2.4|2.6|3.6|3',
    'ごはん150g、卵焼き、味噌汁、納豆、焼きのり|550|30|16|71|2.8|5.0|3|840|146|130|3.3|2.8|1.8|6',
    'プロテインとゆで卵2個だけ（寝坊した）|255|34|11|5|0.6|0.2|3|330|180|45|1.6|2.2|2.6|0'
  ];
  bf_we text[] := array[   -- 休日の朝
    'パンケーキ2枚、ベーコンエッグ、カフェオレ|730|30|32|80|3.2|3.4|28|660|310|74|2.6|3.0|3.4|3',
    '和定食（ごはん・焼き魚・味噌汁・小鉢2品）|675|40|19|86|3.2|7.2|5|1250|230|165|3.8|3.2|10.0|28',
    '鶏むねのサンド、サラダ、カフェラテ|595|38|19|68|2.8|5.6|12|880|260|95|2.4|2.4|1.0|34',
    'オートミール、プロテイン、ブルーベリー、くるみ|560|42|16|62|0.4|8.4|16|1000|270|170|3.0|3.4|1.0|12'
  ];
  lu_wd text[] := array[   -- 平日の昼（弁当・コンビニ・社食）
    '作り置き弁当（鶏むね200g、玄米120g、ブロッコリー、卵）|655|58|16|70|2.2|8.0|3|1180|127|150|3.2|3.8|1.4|86',
    'コンビニ: サラダチキン、おにぎり1個、味噌汁、ゆで卵2個|555|48|18|50|3.8|2.6|2|540|100|64|2.2|2.8|2.6|4',
    '社食の日替わり定食（魚フライ、ごはん少なめ、味噌汁、小鉢）|685|40|24|78|3.4|5.2|6|900|147|106|2.5|2.7|6.0|18',
    'そば（かけ）、ゆで卵、鶏の炙り、サラダ|600|36|14|82|4.0|5.2|4|640|100|105|2.6|2.4|1.6|14',
    '鶏むねと根菜のスープ、玄米おにぎり1個|495|40|10|62|3.0|6.2|5|860|84|112|2.0|2.3|0.3|36',
    -- ↓最後の1本は「雑に済ませた日」。確率を落として選ぶ（下の mi の式を参照）
    'コンビニのサラダチキンとサラダだけ（会議が押した）|255|34|8|12|2.2|3.2|3|480|60|45|1.2|1.6|0.6|24'
  ];
  lu_out text[] := array[  -- 外食の昼（金土に増える）
    '中華定食（回鍋肉、ごはん、スープ、餃子3個）|920|36|38|108|5.0|5.8|8|820|110|95|2.6|3.4|0.4|40',
    'ラーメン、半チャーハン|910|34|32|122|6.0|4.6|6|620|100|75|2.6|2.8|0.4|6',
    '生姜焼き定食（ごはん大盛り）|885|42|30|112|4.2|4.4|10|880|80|110|2.2|3.6|0.5|24',
    'カツカレー、サラダ|975|32|40|122|4.4|5.6|12|760|90|88|2.6|3.2|0.4|20',
    'パスタ（ボロネーゼ）、サラダ、パン|845|30|28|118|4.4|6.4|10|760|130|95|3.0|2.8|0.3|22'
  ];
  di_wd text[] := array[   -- 平日の夜（自炊）
    '鶏むね250g、じゃがいも、ブロッコリー、味噌汁|595|62|13|58|2.6|8.6|5|1900|123|130|3.0|3.0|0.4|140',
    '鮭のホイル焼き、ごはん100g、具だくさん味噌汁、冷奴|625|48|20|64|3.0|6.6|4|1370|286|150|3.1|3.0|16.0|26',
    '豚しゃぶサラダ、冷奴、ごはん80g、味噌汁|600|48|24|48|3.2|5.8|5|1170|296|140|3.5|3.6|0.4|38',
    '鶏団子鍋（野菜たっぷり）、〆の雑炊少なめ|555|46|16|56|3.6|7.6|6|1420|206|132|3.2|3.4|1.2|52',
    '牛赤身ステーキ180g、温野菜、玄米80g|630|54|26|45|2.4|6.6|4|1280|97|150|4.6|7.8|0.2|56',
    '刺身盛り合わせ、ごはん100g、味噌汁、冷奴、枝豆|590|52|16|60|3.0|5.0|4|1120|246|140|2.9|2.8|7.0|14'
  ];
  di_out text[] := array[  -- 金土の夜（外食・飲酒）
    '焼肉（カルビ・ハラミ・サンチュ）、ライス、ビール2杯|1300|52|58|94|4.6|5.0|10|1200|90|110|5.0|8.4|0.2|24',
    '居酒屋（刺身、焼き鳥、枝豆、だし巻き）、ハイボール3杯|870|58|30|42|5.2|5.2|6|1150|150|120|3.2|4.0|6.0|18',
    '寿司12貫、味噌汁、ビール1杯|880|46|14|118|4.4|2.4|8|780|120|130|2.2|3.0|8.0|6',
    'イタリアン（前菜、パスタ、グラスワイン2杯）|1030|32|36|104|4.8|6.0|14|860|200|95|2.8|3.2|0.6|26',
    '鶏の唐揚げ定食、生ビール1杯|1010|42|40|96|3.8|3.8|6|760|70|80|2.0|3.0|0.4|14'
  ];
  di_sun text[] := array[  -- 日曜の夜（作り置き）
    '作り置き: 鶏むねの照り焼き、ひじき煮、玄米120g、味噌汁|655|56|15|74|3.4|9.0|8|1180|217|160|4.6|3.4|0.3|24',
    '作り置き: 豚肉と野菜の蒸し煮、玄米120g、味噌汁|670|46|22|72|3.4|8.4|7|1380|147|165|3.1|3.8|0.4|68',
    '作り置き: サバの味噌煮、根菜の煮物、ごはん100g|665|42|24|70|3.6|7.6|12|1120|186|140|2.9|2.6|7.0|20',
    '作り置き: 鶏そぼろ丼（ごはん少なめ）、味噌汁、ブロッコリー、卵|660|50|19|72|3.6|7.0|9|980|137|128|2.9|3.6|1.4|96'
  ];
  sn_menu text[] := array[ -- 間食（7番目のアイスは夏だけ選ばれる）
    'プロテイン1杯|125|24|2|3|0.2|0.6|1|260|130|45|0.4|1.2|0.0|0',
    'ギリシャヨーグルト、ミックスナッツ|275|16|17|14|0.2|2.8|9|430|220|85|1.0|1.6|0.1|1',
    'バナナ1本、ブラックコーヒー|95|1|0|23|0.0|1.2|15|470|8|40|0.3|0.3|0.0|16',
    'コーヒーとチョコ2粒|115|2|7|11|0.0|1.2|9|240|22|34|0.6|0.3|0.0|0',
    'ゆで卵2個、トマトジュース|200|15|11|10|0.9|1.0|7|540|60|35|1.8|1.4|2.4|18',
    '素焼きアーモンド20粒、緑茶|155|5|13|5|0.0|2.2|1|200|54|60|0.8|0.8|0.0|0',
    'アイス（バニラ）|220|4|12|24|0.1|0.0|22|160|130|12|0.1|0.4|0.2|0'
  ];
  rec_menu text[] := array[ -- 運動した日の補食（消費が大きい日に食べる量も増える＝不足注意を出さない）
    'トレ後: プロテイン、おにぎり1個|315|26|3|46|0.9|1.2|2|340|150|60|0.8|1.6|0.0|1',
    'トレ後: プロテイン、バナナ|225|25|2|27|0.2|1.8|16|640|150|85|0.7|1.5|0.0|16',
    'トレ後: サラダチキン、ゆで卵2個|335|43|17|2|1.7|0.0|0|450|90|55|2.4|3.0|3.6|2',
    'トレ後: プロテイン、ようかん1本|290|25|1|46|0.2|1.8|32|280|150|55|1.0|1.4|0.0|0',
    'トレ後のプロテインだけ|125|24|2|3|0.2|0.6|1|260|130|45|0.4|1.2|0.0|0',
    'トレ後: ゆで卵2個|155|13|11|1|0.5|0.0|0|130|52|12|1.8|1.4|2.2|0'
  ];
  night_menu text[] := array[ -- 夜食・過食
    'ラーメン、餃子、ビール2本|1340|40|44|126|7.0|5.6|8|780|130|90|3.2|4.0|0.4|8',
    'ポテトチップス1袋、アイス|740|8|42|82|1.6|3.6|30|800|140|50|0.8|0.8|0.2|24',
    '菓子パン2個、カフェオレ|655|13|26|92|1.4|2.6|44|380|190|35|1.0|1.0|0.4|1',
    'コンビニの唐揚げ、おにぎり、ビール1本|780|26|26|76|3.4|2.2|4|420|40|50|1.2|2.0|0.3|4',
    'お萩2個、まんじゅう1個、緑茶|440|7|4|94|0.3|4.0|48|260|30|45|1.6|1.0|0.0|4'
  ];
  party_menu text[] := array[ -- 5. 季節性: 年末年始・GW・お盆はこれが夕食を置き換える
    '忘年会（コース料理、ビール3杯、〆のラーメン）|1850|62|78|140|7.2|6.0|14|1300|180|140|5.0|7.0|3.0|20',
    'おせちとお雑煮、日本酒1合|1280|38|34|168|6.6|5.0|30|1250|180|130|3.6|3.4|2.0|30',
    '実家でごちそう（すき焼き、ごはんおかわり）|1320|58|62|132|6.2|5.4|22|1350|200|150|5.4|8.0|1.2|26',
    'BBQ（肉・焼きそば・ビール3杯）|1640|54|72|118|6.2|5.0|16|1250|120|130|4.6|7.4|0.8|30',
    '帰省: 天ぷらそば、スイカ、ビール2杯|1240|34|44|128|6.0|6.0|26|1150|110|110|3.0|3.2|0.6|26'
  ];

  n_logs int := 0; n_days int := 0;
begin
  select id into uid from auth.users where email = demo_email;
  if uid is null then
    raise exception 'ユーザーが見つかりません: %  — 先にアプリで新規登録してください', demo_email;
  end if;

  -- 前提マイグレーションの確認（足りないものを名指しで止める）
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'logs' and column_name = 'ex_minutes') then
    raise exception 'supabase/apply-pending.sql を先に実行してください（logs.ex_minutes がありません）';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'entries' and column_name = 'bodyfat') then
    raise exception 'supabase/apply-pending.sql を先に実行してください（entries.bodyfat がありません）';
  end if;

  -- 乱数を固定する＝何度実行しても同じデータになる（冪等）
  perform setseed(0.4242);

  start_d := today - 364;
  pr_day  := today - 2;   -- 6. 自己ベストは直近3日以内に1つ置く（きょうのハイライト用）

  -- ===== 既存データの削除（対象ユーザーぶんだけ） =====
  delete from public.logs     where user_id = uid;
  delete from public.entries  where user_id = uid;
  delete from public.my_foods where user_id = uid;
  delete from public.events   where user_id = uid;
  -- 後から生えたテーブルは、未適用の環境でも落ちないよう存在を確かめてから消す。
  -- PL/pgSQL は「実行されなかった文」を解析しないので、この書き方ならテーブルが無くても安全
  if to_regclass('public.my_meals')        is not null then delete from public.my_meals        where user_id = uid; end if;
  if to_regclass('public.vitals')          is not null then delete from public.vitals          where user_id = uid; end if;
  if to_regclass('public.purpose_periods') is not null then delete from public.purpose_periods where user_id = uid; end if;
  if to_regclass('public.coach_sessions')  is not null then delete from public.coach_sessions  where user_id = uid; end if;

  -- ===== プロフィール（35歳・男性・172cm） =====
  insert into public.profiles (id, display_name, sex, height_cm, age, init_weight, life_factor)
  values (uid, 'デモユーザー', 'male', 172, 35, 88.0, 1.35)
  on conflict (id) do update set
    display_name = excluded.display_name, sex = excluded.sex, height_cm = excluded.height_cm,
    age = excluded.age, init_weight = excluded.init_weight, life_factor = excluded.life_factor;

  -- 目的（いまはカット中）。列が無い環境は黙って飛ばす
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'profiles' and column_name = 'purpose') then
    update public.profiles set purpose = 'cut_lean' where id = uid;
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'profiles' and column_name = 'constraints_note') then
    update public.profiles set constraints_note = '甲殻類アレルギー（えび・かに）。辛いものは苦手。' where id = uid;
  end if;

  -- ===== 目標（88kg → 76kg・現在も継続中） =====
  insert into public.goals (
    user_id, start_date, start_weight, start_bf, target_date, target_weight, target_bodyfat,
    protein_per_kg, fat_per_kg, ex_per_week, ex_weekly_kcal, ex_min_minutes, note
  )
  values (
    uid, start_d, 88.0, 26.0, today + 70, 76.0, 16.0,
    2.0, 0.8, 4, 1800, 20, '無理なく続けることを最優先。停滞しても週平均で見る'
  )
  on conflict (user_id) do update set
    start_date = excluded.start_date, start_weight = excluded.start_weight,
    start_bf = excluded.start_bf, target_date = excluded.target_date,
    target_weight = excluded.target_weight, target_bodyfat = excluded.target_bodyfat,
    protein_per_kg = excluded.protein_per_kg, fat_per_kg = excluded.fat_per_kg,
    ex_per_week = excluded.ex_per_week, ex_weekly_kcal = excluded.ex_weekly_kcal,
    ex_min_minutes = excluded.ex_min_minutes, note = excluded.note;

  insert into public.training_goals (user_id, name, target_kg) values
    (uid, 'ベンチプレス', 90), (uid, 'スクワット', 120), (uid, 'デッドリフト', 140)
  on conflict (user_id, name) do update set target_kg = excluded.target_kg;

  -- ===== マイ食品 =====
  insert into public.my_foods (user_id, name, kind, unit, kcal, p, f, c, note) values
    (uid, '鶏むね肉100g（皮なし）', 'food',   '100g',  108, 22.3, 1.5,  0.0, ''),
    (uid, 'ゆで卵1個',             'food',   '1個',    76,  6.2, 5.2,  0.2, ''),
    (uid, 'プロテイン1杯',         'food',   '1杯',   125, 24.0, 2.0,  3.0, 'ホエイ・30g'),
    (uid, '白米150g',              'food',   '150g',  234,  3.8, 0.5, 51.9, ''),
    (uid, '玄米150g',              'food',   '150g',  228,  4.2, 1.5, 48.0, ''),
    (uid, '納豆1パック',           'food',   '1パック',100,  8.3, 5.0,  6.1, ''),
    (uid, 'サラダチキン',          'food',   '1個',   114, 24.1, 1.2,  0.3, 'コンビニのプレーン'),
    (uid, 'ブロッコリー100g',      'food',   '100g',   33,  4.3, 0.5,  5.2, ''),
    (uid, 'ギリシャヨーグルト',    'food',   '1個',   100, 10.0, 0.0, 12.0, ''),
    (uid, '味噌汁（具だくさん）',  'food',   '1杯',    65,  4.5, 2.0,  7.0, ''),
    (uid, '作り置き鶏むね照り焼き','recipe', '1人前', 245, 41.0, 5.0, 10.0, '鶏むね200g・醤油・みりん'),
    (uid, '朝の納豆ごはんセット',  'recipe', '1人前', 430, 16.0, 7.0, 74.0, 'ごはん200g＋納豆＋味噌汁')
  on conflict (user_id, name) do nothing;

  -- ===== マイミール（食事タブのチップ。複数品目のセット） =====
  if to_regclass('public.my_meals') is not null then
    -- created_at はわざと日付をずらす（設定＞マイ食品の並び順がこれで決まる）
    insert into public.my_meals (user_id, name, items, created_at) values
      (uid, '朝の定番',
       jsonb_build_array(
         jsonb_build_object('name','ごはん','qty','200g','kcal',312,'p',5.0,'f',0.6,'c',69.2,'salt',0.0,'fib',2.2,'sug',0,'k',58,'ca',6,'mg',14,'fe',0.2,'zn',1.2,'vd',0.0,'vc',0),
         jsonb_build_object('name','納豆','qty','1パック','kcal',100,'p',8.3,'f',5.0,'c',6.1,'salt',0.6,'fib',3.4,'sug',1,'k',330,'ca',45,'mg',50,'fe',1.7,'zn',0.9,'vd',0.0,'vc',0),
         jsonb_build_object('name','味噌汁','qty','1杯','kcal',40,'p',3.0,'f',1.4,'c',4.0,'salt',1.4,'fib',1.0,'sug',1,'k',180,'ca',40,'mg',25,'fe',0.6,'zn',0.3,'vd',0.0,'vc',2),
         jsonb_build_object('name','焼き鮭','qty','1切れ','kcal',150,'p',21.0,'f',7.0,'c',0.1,'salt',1.0,'fib',0.0,'sug',0,'k',380,'ca',14,'mg',30,'fe',0.5,'zn',0.5,'vd',16.0,'vc',1)), ((today - 300 + time '21:10') at time zone 'Asia/Tokyo')),
      (uid, 'ジム後のリカバリー',
       jsonb_build_array(
         jsonb_build_object('name','プロテイン','qty','1杯','kcal',125,'p',24.0,'f',2.0,'c',3.0,'salt',0.2,'fib',0.6,'sug',1,'k',260,'ca',130,'mg',45,'fe',0.4,'zn',1.2,'vd',0.0,'vc',0),
         jsonb_build_object('name','バナナ','qty','1本','kcal',93,'p',1.1,'f',0.2,'c',22.5,'salt',0.0,'fib',1.1,'sug',15,'k',360,'ca',6,'mg',32,'fe',0.3,'zn',0.2,'vd',0.0,'vc',16)), ((today - 268 + time '19:40') at time zone 'Asia/Tokyo')),
      (uid, 'コンビニ昼の定番',
       jsonb_build_array(
         jsonb_build_object('name','サラダチキン','qty','1個','kcal',114,'p',24.1,'f',1.2,'c',0.3,'salt',1.1,'fib',0.0,'sug',0,'k',340,'ca',6,'mg',30,'fe',0.3,'zn',0.6,'vd',0.1,'vc',1),
         jsonb_build_object('name','おにぎり（鮭）','qty','2個','kcal',360,'p',12.0,'f',3.0,'c',72.0,'salt',2.4,'fib',1.4,'sug',1,'k',150,'ca',20,'mg',30,'fe',0.6,'zn',1.2,'vd',1.4,'vc',0),
         jsonb_build_object('name','インスタント味噌汁','qty','1杯','kcal',35,'p',2.0,'f',1.0,'c',4.0,'salt',1.6,'fib',0.8,'sug',1,'k',120,'ca',20,'mg',18,'fe',0.4,'zn',0.2,'vd',0.0,'vc',1),
         jsonb_build_object('name','ゆで卵','qty','1個','kcal',76,'p',6.2,'f',5.2,'c',0.2,'salt',0.2,'fib',0.0,'sug',0,'k',65,'ca',26,'mg',6,'fe',0.9,'zn',0.7,'vd',1.1,'vc',0)), ((today - 205 + time '12:35') at time zone 'Asia/Tokyo')),
      (uid, '作り置きセット（鶏むね＋ブロッコリー＋玄米）',
       jsonb_build_array(
         jsonb_build_object('name','鶏むね照り焼き','qty','200g','kcal',245,'p',41.0,'f',5.0,'c',10.0,'salt',1.6,'fib',0.2,'sug',5,'k',600,'ca',10,'mg',60,'fe',0.6,'zn',1.4,'vd',0.2,'vc',6),
         jsonb_build_object('name','ブロッコリー','qty','150g','kcal',50,'p',6.5,'f',0.8,'c',7.8,'salt',0.0,'fib',6.5,'sug',2,'k',540,'ca',57,'mg',44,'fe',1.5,'zn',1.1,'vd',0.0,'vc',210),
         jsonb_build_object('name','玄米','qty','150g','kcal',228,'p',4.2,'f',1.5,'c',48.0,'salt',0.0,'fib',2.1,'sug',1,'k',143,'ca',11,'mg',74,'fe',0.9,'zn',1.2,'vd',0.0,'vc',0)), ((today - 131 + time '13:05') at time zone 'Asia/Tokyo')),
      (uid, '休日ブランチ',
       jsonb_build_array(
         jsonb_build_object('name','オートミール','qty','60g','kcal',225,'p',8.2,'f',3.4,'c',41.0,'salt',0.0,'fib',5.6,'sug',1,'k',160,'ca',28,'mg',60,'fe',2.3,'zn',1.2,'vd',0.0,'vc',0),
         jsonb_build_object('name','プロテイン','qty','1杯','kcal',125,'p',24.0,'f',2.0,'c',3.0,'salt',0.2,'fib',0.6,'sug',1,'k',260,'ca',130,'mg',45,'fe',0.4,'zn',1.2,'vd',0.0,'vc',0),
         jsonb_build_object('name','ブルーベリー','qty','80g','kcal',39,'p',0.4,'f',0.1,'c',10.0,'salt',0.0,'fib',2.7,'sug',8,'k',56,'ca',6,'mg',4,'fe',0.2,'zn',0.1,'vd',0.0,'vc',8),
         jsonb_build_object('name','くるみ','qty','20g','kcal',134,'p',3.0,'f',13.8,'c',2.3,'salt',0.0,'fib',1.5,'sug',1,'k',108,'ca',17,'mg',30,'fe',0.5,'zn',0.5,'vd',0.0,'vc',0)), ((today - 46 + time '10:20') at time zone 'Asia/Tokyo'));
  end if;

  -- ===== 先の予定（食事タブ「先の予定」の帯・目標タブのチートデイ一覧）=====
  -- title の先頭絵文字が種別そのもの（native/src/lib/eventPlan.ts eventKindOf）。
  -- 🍻=飲み会 / 🍽=外食 / 🍖=チートデイ / 📅=その他。これを外すと「その他」に落ちる。
  -- 帯に出るのは today〜today+7 のいちばん近い1件だけなので、必ずその範囲に1件置く。
  -- 未来だけでなく直近の過去も少し残す（消し忘れ＝実際に使っている証拠）
  insert into public.events (user_id, date, title, extra_kcal) values
    (uid, today - 12, '🍽 外食（取引先との会食）',   900),
    (uid, today - 4,  '🍻 飲み会（同期の送別会）',  1100),
    (uid, today + 3,  '🍻 飲み会（部の歓迎会）',    1000),
    (uid, today + 9,  '🍖 チートデイ（友人と焼肉）',1200),
    (uid, today + 16, '🍽 外食（出張が続く週）',     700),
    (uid, today + 23, '📅 姪の誕生日会',             600),
    (uid, today + 38, '🍻 飲み会（結婚式の二次会）',1100);

  -- ===== 目的サイクル（サイクル比較）=====
  -- 体重カーブの区切りとそろえてある。カット2本が完了済み＝前回との比較が出せる
  if to_regclass('public.purpose_periods') is not null then
    insert into public.purpose_periods (user_id, purpose, started_at, ended_at) values
      (uid, 'cut_std',  start_d,           start_d + 97),   -- 1本目のカット（14週・−3.8kg）
      (uid, 'easy',     start_d + 98,      start_d + 112),  -- 年末年始はゆる維持
      (uid, 'cut_lean', start_d + 113,     start_d + 265),  -- 2本目のカット（22週・−4.8kg）
      (uid, 'easy',     start_d + 266,     start_d + 300),  -- 梅雨どきに維持へ切替
      (uid, 'cut_lean', start_d + 301,     null);           -- 進行中（9週・−2.8kg）
  end if;

  -- ===== 体の写真（既定OFF）=====
  -- 行だけ入れても概要タブのカードは落ちない（native/src/components/BodyPhotosCard.tsx が
  -- createSignedUrl の失敗を url=null として握りつぶし、画像を灰色の空枠に差し替える）。
  -- ただし「灰色の空枠が3つ並んだ画面」はスクショに使えないので既定は false。
  -- 本物を入れるなら実機のアプリで「撮影」を5回押すのが唯一の道（手順は docs/release-steps.md STEP 3-b）。
  -- ※ path の先頭は必ず <user_id>/ にする（Storage の RLS がそこで本人判定している）
  if seed_body_photos and to_regclass('public.body_photos') is not null then
    delete from public.body_photos where user_id = uid;
    insert into public.body_photos (user_id, date, path, bodyfat, note)
    select uid, today - g.n,
           uid::text || '/' || to_char(today - g.n, 'YYYY-MM-DD') || '-seed' || g.n || '.jpg',
           g.bfv, g.memo
    from (values
      (357, 25.6, '始めた日。正面・自然光'),
      (280, 23.4, ''),
      (196, 21.5, '停滞したがウエストは減っている'),
      (112, 19.8, ''),
      ( 56, 18.6, ''),
      ( 21, 17.9, ''),
      (  5, 17.4, '肩まわりが出てきた')
    ) as g(n, bfv, memo);
    -- 旧Web版のダッシュボードは bf_est を読む。列があるほうにも同じ値を入れておく
    if exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'body_photos' and column_name = 'bf_est') then
      update public.body_photos set bf_est = bodyfat where user_id = uid;
    end if;
  end if;

  -- ===== 365日分を生成 =====
  for day_idx in 0..364 loop
    d := start_d + day_idx;
    dow := extract(dow from d)::int;         -- 0=日 .. 6=土
    wk  := day_idx / 7;
    blk := least(wk / 4, 13);
    phase := wk % 4;
    is_recent := day_idx >= 350;             -- 7. 直近2週間は丁寧に
    is_today  := (d = today);                -- 8. きょうは朝・昼まで。夜はこれから
    is_summer := to_char(d, 'MM') in ('07', '08');

    -- ---- 2. 体重トレンド: 一直線にしない。停滞2回＋年末年始の戻り＋梅雨の維持 ----
    base_w := 88.0 - (case
      when day_idx <=  55 then day_idx * 0.0568                       -- 出だしは順調（−0.40kg/週）
      when day_idx <=  83 then 3.124 + (day_idx -  55) * 0.0030       -- 停滞期1（4週・ほぼ動かない）
      when day_idx <=  97 then 3.208 + (day_idx -  83) * 0.0420       -- 動き出す
      when day_idx <= 112 then 3.796 - (day_idx -  97) * 0.0450       -- 年末年始で戻る（+0.7kg）
      when day_idx <= 174 then 3.121 + (day_idx - 112) * 0.0400       -- 新年の立て直し
      when day_idx <= 195 then 5.601 + (day_idx - 174) * 0.0040       -- 停滞期2（3週）
      when day_idx <= 265 then 5.685 + (day_idx - 195) * 0.0320       -- 春の再加速
      when day_idx <= 300 then 7.925 + (day_idx - 265) * 0.0020       -- 梅雨どきは維持に切替
      else                     7.995 + (day_idx - 300) * 0.0430       -- 直近9週はいちばん順調
    end);

    -- 1日ごとの上下は水分。週末で戻り、前日に食べすぎた翌朝はさらに乗る
    w := round((base_w
          + (case when dow in (0, 6) then 0.30 else 0 end)
          + (case when prev_binge then 0.45 else 0 end)
          + sin(day_idx::double precision / 5.5) * 0.22
          + (random() - 0.5) * 0.50)::numeric, 1);
    bf := round((26.0 - (88.0 - base_w) * 0.79 + (random() - 0.5) * 0.5)::numeric, 1);
    -- ウエストは日曜の朝だけ測る（毎日測る人は少ない）
    waist := round((98.0 - (88.0 - base_w) * 1.15 + (random() - 0.5) * 0.8)::numeric, 1);

    -- ---- 記録が飛ぶ日（アプリの使い込み具合そのものを曲線にする）----
    p_skip := case
      when is_recent             then 0.00   -- 直近は毎日つけている
      when day_idx <  30         then 0.02   -- 入れたては毎日
      when day_idx <= 97         then 0.06
      when day_idx <= 112        then 0.22   -- 年末年始は旅行で飛ぶ
      when day_idx <= 200        then 0.11   -- 中だるみ
      when day_idx <= 320        then 0.07
      else                            0.03
    end;
    skip_day := random() < p_skip;

    -- ---- 1. 完璧すぎない: 週1〜2回は超える日、月1〜2回は大きく外す日 ----
    p_binge := case dow when 5 then 0.26 when 6 then 0.28 when 0 then 0.08 else 0.05 end
      + (case when day_idx between  98 and 112 then 0.45 else 0 end)   -- 年末年始
      + (case when day_idx between 224 and 230 then 0.25 else 0 end)   -- GW
      + (case when day_idx between 328 and 333 then 0.25 else 0 end)   -- お盆
      -- 停滞期はストレスで食べる（停滞の理由が読める形にする）
      + (case when day_idx between  56 and  83 then 0.08 else 0 end)
      + (case when day_idx between 175 and 195 then 0.08 else 0 end);
    if is_recent then p_binge := p_binge * 0.5; end if;
    is_binge := (not skip_day) and random() < p_binge and day_idx < 362;
    is_party := is_binge and (day_idx between 98 and 112 or day_idx between 224 and 230
                              or day_idx between 328 and 333);

    is_rest := (case dow when 0 then random() < 0.55 when 3 then random() < 0.45 else random() < 0.12 end);
    if d = pr_day then is_rest := false; end if;

    if skip_day then
      prev_binge := false;
      if random() < 0.55 then     -- 体重だけは測った日（記録は無いがグラフは途切れない）
        insert into public.logs (user_id, date, at, items, weight, bodyfat, ex, adj, text)
        values (uid, d, (d + time '06:50' + (random() * interval '40 min')) at time zone 'Asia/Tokyo',
                '[]'::jsonb, w, bf, 'オフ', 0, '');
        insert into public.entries (user_id, date, ex, adj, weight, bodyfat, mood)
        values (uid, d, 'オフ', 0, w, bf, '')
        on conflict (user_id, date) do update set
          ex = excluded.ex, adj = excluded.adj, weight = excluded.weight,
          bodyfat = excluded.bodyfat, mood = excluded.mood;
        n_logs := n_logs + 1; n_days := n_days + 1;
      end if;
      continue;
    end if;

    intake := 0; pp := 0; ff := 0; cc := 0; ex_total := 0; max_ex := 'オフ';
    m_menu := array[]::text[]; m_at := array[]::timestamptz[];
    -- 4. 記録の粒度: 3割の日は「昼 コンビニ」みたいに雑に書く（直近はほぼ丁寧）
    terse := (not is_recent) and random() < 0.30;

    -- ---- 朝食 ----
    if dow in (0, 6) then
      mi := 1 + floor(random() * array_length(bf_we, 1))::int;
      m_menu := m_menu || bf_we[mi];
      m_at   := m_at || ((d + time '08:40' + (random() * interval '70 min')) at time zone 'Asia/Tokyo');
    else
      -- 最後の1本（寝坊の日）は1割弱だけ。等確率だと5日に1回になり摂取が落ちすぎる
      mi := case when random() < 0.09 then array_length(bf_wd, 1)
                 else 1 + floor(random() * (array_length(bf_wd, 1) - 1))::int end;
      m_menu := m_menu || bf_wd[mi];
      m_at   := m_at || ((d + time '07:10' + (random() * interval '50 min')) at time zone 'Asia/Tokyo');
    end if;

    -- ---- 昼食（3. 曜日の癖: 金土は外食が増える）----
    if random() < (case when dow in (5, 6) then 0.50 when dow = 0 then 0.22 else 0.11 end) then
      mi := 1 + floor(random() * array_length(lu_out, 1))::int;
      m_menu := m_menu || lu_out[mi];
    else
      mi := case when random() < 0.09 then array_length(lu_wd, 1)
                 else 1 + floor(random() * (array_length(lu_wd, 1) - 1))::int end;
      m_menu := m_menu || lu_wd[mi];
    end if;
    m_at := m_at || ((d + time '12:10' + (random() * interval '60 min')) at time zone 'Asia/Tokyo');

    -- ---- 間食（夏はアイスも選択肢に入る）----
    if random() < (case when is_recent then 0.92 else 0.82 end) then
      mi := 1 + floor(random() * (case when is_summer then 7 else 6 end))::int;
      m_menu := m_menu || sn_menu[mi];
      m_at   := m_at || ((d + time '15:10' + (random() * interval '70 min')) at time zone 'Asia/Tokyo');
    end if;

    -- ---- 夕食（きょうはまだ食べていないので入れない）----
    if is_today then
      null;
    elsif is_party then
      mi := 1 + floor(random() * array_length(party_menu, 1))::int;
      m_menu := m_menu || party_menu[mi];
      m_at   := m_at || ((d + time '19:30' + (random() * interval '120 min')) at time zone 'Asia/Tokyo');
    elsif dow = 0 then
      mi := 1 + floor(random() * array_length(di_sun, 1))::int;
      m_menu := m_menu || di_sun[mi];
      m_at   := m_at || ((d + time '18:40' + (random() * interval '60 min')) at time zone 'Asia/Tokyo');
    elsif dow in (5, 6) and random() < 0.55 then
      mi := 1 + floor(random() * array_length(di_out, 1))::int;
      m_menu := m_menu || di_out[mi];
      m_at   := m_at || ((d + time '19:20' + (random() * interval '110 min')) at time zone 'Asia/Tokyo');
    else
      mi := 1 + floor(random() * array_length(di_wd, 1))::int;
      m_menu := m_menu || di_wd[mi];
      m_at   := m_at || ((d + time '19:00' + (random() * interval '75 min')) at time zone 'Asia/Tokyo');
    end if;

    -- ---- 夜食（過食日・ただしパーティ日は夕食で既に盛れている）----
    if is_binge and not is_party and not is_today then
      mi := 1 + floor(random() * array_length(night_menu, 1))::int;
      m_menu := m_menu || night_menu[mi];
      m_at   := m_at || ((d + time '21:50' + (random() * interval '70 min')) at time zone 'Asia/Tokyo');
    end if;

    -- ===== 運動（食事より先に入れる: 補食の有無を消費量で決めるため）=====
    pr_hit := false;

    -- ---- 筋トレ（月・木＋土の半分。自己ベスト・停滞・デロードを織り込む）----
    -- きょうのジムは夜なのでまだ記録が無い（8. 途中までの1日にする）
    if (not is_today and not is_rest and (dow in (1, 4) or (dow = 6 and random() < 0.5))) or d = pr_day then
      gain := gain_steps[(case when d = pr_day then 13 else blk end) + 1];
      lift_txt := '🏋️ ';
      for li in 1..2 loop
        if d = pr_day then ei := li; else ei := 1 + ((wk * 2 + li - 1) % array_length(lift_names, 1)); end if;
        topkg := round(((lift_base[ei] + gain * lift_mult[ei]) / 2.5))::numeric * 2.5;
        if d = pr_day then
          lift_kg := topkg; reps := 3 + floor(random() * 3)::int;
        else
          case phase
            when 0 then lift_kg := topkg - 5.0;  reps :=  8 + floor(random() * 3)::int;  -- 積み上げ
            when 1 then lift_kg := topkg - 2.5;  reps :=  6 + floor(random() * 3)::int;
            when 2 then lift_kg := topkg;        reps :=  3 + floor(random() * 3)::int;  -- 挑戦週
            else        lift_kg := topkg - 10.0; reps := 10 + floor(random() * 3)::int;  -- デロード
          end case;
        end if;
        if lift_kg < 20 then lift_kg := 20; end if;
        is_pr := lift_kg > best_kg[ei];
        if is_pr then best_kg[ei] := lift_kg; pr_hit := true; end if;
        -- ⚠️ 種目の断片は「名前 ○kg×回×セット」で**終わらせる**こと。
        --    native/src/lib/liftLog.ts parseLiftText の正規表現は行末 `$` で終端を固定していて、
        --    後ろに何か足すと**その種目ごと黙って捨てられる**（2026-09-16 に実際に踏んだ）。
        --    「🎉自己ベスト更新」を付けていたため、**自己ベストを出した種目ほど履歴から消えていた**。
        --    自己ベストはアプリが記録から自分で計算する（app/lift-session.tsx・実績ページ）ので、
        --    テキストに書く必要がそもそも無い。
        lift_txt := lift_txt || lift_names[ei] || ' ' || trim_scale(lift_kg) || 'kg×' || reps || '×3';
        if li = 1 then lift_txt := lift_txt || '、'; end if;
      end loop;
      -- 補足も種目の断片にせず、独立した「、」区切りの1片にする。
      -- parseLiftText は読めない片を静かに落とすので、種目の解析は壊れない
      if phase = 3 and d <> pr_day then lift_txt := lift_txt || '、（デロード週）'; end if;
      -- ex='通常'（＝EX_ADD 150kcal・筋トレ1時間の既定）。adj=0 にして二重計上しない
      insert into public.logs (user_id, date, at, items, ex, adj, text, ex_minutes)
      values (uid, d, (d + time '18:40' + (random() * interval '70 min')) at time zone 'Asia/Tokyo',
              '[]'::jsonb, '通常', 0, lift_txt, 50 + floor(random() * 4)::int * 5);
      ex_total := ex_total + 150; max_ex := '通常';
      n_logs := n_logs + 1;
    end if;

    -- ---- 有酸素（運動タブからの記録と同じ形: ex='オフ' + adj=消費kcal）----
    if not is_rest and random() < 0.55 then
      ci := 1 + floor(random() * array_length(ex_names, 1))::int;
      ex_min := (array[20, 25, 30, 30, 40, 45])[1 + floor(random() * 6)::int];
      ex_kcal := round(ex_mets[ci] * base_w * (ex_min / 60.0) * 1.05)::int;
      ex_km := case when ex_pace[ci] > 0 then round((ex_pace[ci] * ex_min)::numeric, 1) else null end;
      insert into public.logs (user_id, date, at, items, ex, adj, text, ex_minutes, ex_km)
      values (uid, d, (d + time '06:40' + (random() * interval '100 min')) at time zone 'Asia/Tokyo',
              '[]'::jsonb, 'オフ', ex_kcal,
              '🏃 ' || ex_names[ci] || ' ' || ex_min || '分'
                || coalesce(' ' || trim_scale(ex_km) || 'km', '')
                || '（約' || ex_kcal || 'kcal消費）',
              ex_min, ex_km);
      ex_total := ex_total + ex_kcal;
      n_logs := n_logs + 1;
    elsif dow = 0 and random() < 0.6 then
      -- 日曜は休んでも散歩はする
      ex_min := (array[25, 30, 40])[1 + floor(random() * 3)::int];
      ex_kcal := round(3.0 * base_w * (ex_min / 60.0) * 1.05)::int;
      insert into public.logs (user_id, date, at, items, ex, adj, text, ex_minutes, ex_km)
      values (uid, d, (d + time '10:20' + (random() * interval '120 min')) at time zone 'Asia/Tokyo',
              '[]'::jsonb, 'オフ', ex_kcal,
              '🏃 散歩 ' || ex_min || '分 ' || trim_scale(round((0.08 * ex_min)::numeric, 1)) || 'km（約'
                || ex_kcal || 'kcal消費）', ex_min, round((0.08 * ex_min)::numeric, 1));
      ex_total := ex_total + ex_kcal;
      n_logs := n_logs + 1;
    end if;

    -- ---- 目安から離れすぎた日だけ補食（プロテイン・おにぎり等）で埋める ----
    -- アプリの目安は BMR×生活係数＋運動ぶん（native/src/lib/calc.ts targetKcal）で、
    -- 運動ぶんがまるごと足される。献立を完全ランダムに引くと、よく動いた日ほど
    -- 「不足注意」になり、判定が日替わりでギザギザに振れる（実在しないデータになる）。
    -- 実際の人は「あと食べられる」を見てトレ後に1品足すので、その行動をそのまま入れる。
    -- 到達点は目安−490〜−350kcal＝judge()の 'OK'（−300〜−500）帯の中に収まる
    day_target := round((10 * w + 6.25 * 172 - 5 * 35 + 5) * 1.35) + ex_total;
    select coalesce(sum(split_part(x, '|', 2)::numeric), 0) into intake from unnest(m_menu) x;
    if not is_binge and not is_today then
      for kk in 1..4 loop
        exit when intake >= day_target - 490;
        mi := 1 + floor(random() * array_length(rec_menu, 1))::int;
        m_menu := m_menu || rec_menu[mi];
        m_at   := m_at || ((d + time '17:20' + (random() * interval '200 min')) at time zone 'Asia/Tokyo');
        intake := intake + split_part(rec_menu[mi], '|', 2)::numeric;
      end loop;
    end if;

    -- ===== 食事を logs へ流す =====
    intake := 0; mood_txt := '';
    for kk in 1..coalesce(array_length(m_menu, 1), 0) loop
      a := string_to_array(m_menu[kk], '|');
      -- メモの丁寧さを日によって変える（雑な日は「コンビニ: サラダチキン」で終わる）
      note_txt := case
        when terse then split_part(a[1], '、', 1)
        when random() < (case when is_recent then 0.45 else 0.15 end) then a[1] || ' / ' ||
             (case when is_binge then notes_bad[1 + floor(random() * array_length(notes_bad, 1))::int]
                   else notes_good[1 + floor(random() * array_length(notes_good, 1))::int] end)
        else a[1]
      end;
      insert into public.logs (user_id, date, at, items, kcal, p, f, c, ex, adj, mood, text)
      values (uid, d, m_at[kk],
              jsonb_build_array(jsonb_build_object(
                'name', a[1], 'qty', '×1',
                'kcal', a[2]::numeric, 'p', a[3]::numeric, 'f', a[4]::numeric, 'c', a[5]::numeric,
                'salt', a[6]::numeric, 'fib', a[7]::numeric, 'sug', a[8]::numeric, 'k', a[9]::numeric,
                'ca', a[10]::numeric, 'mg', a[11]::numeric, 'fe', a[12]::numeric, 'zn', a[13]::numeric,
                'vd', a[14]::numeric, 'vc', a[15]::numeric)),
              a[2]::numeric, a[3]::numeric, a[4]::numeric, a[5]::numeric, 'オフ', 0, '', note_txt);
      intake := intake + a[2]::numeric; pp := pp + a[3]::numeric;
      ff := ff + a[4]::numeric; cc := cc + a[5]::numeric;
      n_logs := n_logs + 1;
    end loop;

    -- ---- 気分（朝の気分カードと同じ形式: 'N/5'。ときどき一言つく）----
    if random() < (case when is_recent then 0.95 else 0.72 end) then
      mood_txt := (case
        when is_binge then (array['2/5','2/5','3/5'])[1 + floor(random() * 3)::int]
        when pr_hit   then (array['5/5','5/5','4/5'])[1 + floor(random() * 3)::int]
        when is_rest  then (array['3/5','4/5'])[1 + floor(random() * 2)::int]
        else (array['4/5','4/5','5/5','3/5'])[1 + floor(random() * 4)::int]
      end);
      if random() < 0.25 then
        mood_txt := mood_txt || ' ' || (array['よく眠れた','寝不足','体が軽い','だるい','気分は上向き','肩が重い'])
                                        [1 + floor(random() * 6)::int];
      end if;
      insert into public.logs (user_id, date, at, items, ex, adj, mood, text)
      values (uid, d, (d + time '07:05' + (random() * interval '30 min')) at time zone 'Asia/Tokyo',
              '[]'::jsonb, 'オフ', 0, mood_txt, '');
      n_logs := n_logs + 1;
    end if;

    -- ---- 体重（朝いちばん。日曜だけウエストも）----
    insert into public.logs (user_id, date, at, items, weight, bodyfat, waist, ex, adj, text)
    values (uid, d, (d + time '06:45' + (random() * interval '35 min')) at time zone 'Asia/Tokyo',
            '[]'::jsonb, w, bf, case when dow = 0 then waist else null end, 'オフ', 0, '');
    n_logs := n_logs + 1;

    -- ---- バイタル（週2回＋直近2週は毎日。体重が落ちるほど血圧も下がる）----
    if to_regclass('public.vitals') is not null
       and (is_recent or dow in (1, 4)) then
      sys   := round(138 - (88.0 - base_w) * 1.55 + (random() - 0.5) * 7)::int;
      dia   := round( 88 - (88.0 - base_w) * 1.05 + (random() - 0.5) * 5)::int;
      pulse := round( 74 - (88.0 - base_w) * 0.95 + (random() - 0.5) * 7)::int;
      -- 血糖は毎回は測らない（月1回くらい）
      glu   := case when random() < 0.12
                    then round(104 - (88.0 - base_w) * 1.10 + (random() - 0.5) * 9)::int
                    else null end;
      insert into public.vitals (user_id, date, systolic, diastolic, pulse, glucose, note)
      values (uid, d, sys, dia, pulse, glu,
              case when glu is not null then '起床後・朝食前' else '' end)
      on conflict (user_id, date) do update set
        systolic = excluded.systolic, diastolic = excluded.diastolic,
        pulse = excluded.pulse, glucose = excluded.glucose, note = excluded.note;
    end if;

    -- ---- AI相談の消費台帳（画面には出ないが、相談タブの回数制の履歴になる）----
    -- きょうのぶんは入れない。万一 session_id が衝突すると当日1回ぶんの消費判定が狂うため
    if to_regclass('public.coach_sessions') is not null and not is_today
       and random() < (case when is_recent then 0.60 when day_idx > 200 then 0.28 else 0.16 end) then
      insert into public.coach_sessions (user_id, session_id, date, created_at)
      values (uid, gen_random_uuid(), d,
              (d + time '21:10' + (random() * interval '90 min')) at time zone 'Asia/Tokyo')
      on conflict do nothing;
    end if;

    -- ---- 日次サマリー（native/src/lib/day.ts summarizeDay と同じ計算）----
    -- food_text は「その日の全logのtextを at 順に ／ で連結」。アプリが再同期しても
    -- 同じ文字列になるよう、入れたlogsから組み直す（運動の行も混ざるのが正しい）
    select coalesce(string_agg(btrim(l.text), ' ／ ' order by l.at), '')
      into food_text
      from public.logs l
     where l.user_id = uid and l.date = d and btrim(coalesce(l.text, '')) <> '';

    ent_adj := ex_total - (case max_ex when '通常' then 150 when '軽い' then 30
                                       when '高' then 400 when '特大' then 800 else 0 end);
    insert into public.entries (
      user_id, date, ex, adj, intake, p, f, c, weight, bodyfat, waist, mood, food_text
    )
    values (uid, d, max_ex, ent_adj,
            round(intake, 1), round(pp, 1), round(ff, 1), round(cc, 1),
            w, bf, case when dow = 0 then waist else null end, mood_txt, left(food_text, 2000))
    on conflict (user_id, date) do update set
      ex = excluded.ex, adj = excluded.adj, intake = excluded.intake,
      p = excluded.p, f = excluded.f, c = excluded.c,
      weight = excluded.weight, bodyfat = excluded.bodyfat, waist = excluded.waist,
      mood = excluded.mood, food_text = excluded.food_text;

    n_days := n_days + 1;
    prev_binge := is_binge;
  end loop;

  raise notice '完了: % に % 日ぶん（logs % 件）を作成しました', demo_email, n_days, n_logs;
end $$;

-- ===================================================================
-- 実行後の確認
-- ※ 下の確認クエリにもメールアドレスが埋め込んである。demo_email を書き換えたときは
--   ここもまとめて置換すること（SQL Editor の検索置換でよい）
-- ===================================================================

-- (1) 全体像
select
  count(*)                                  as "日次サマリー件数",
  min(date)                                 as "最初の記録",
  max(date)                                 as "最後の記録",
  round(max(weight), 1)                     as "開始時の体重",
  round(min(weight), 1)                     as "最軽量",
  round(avg(intake) filter (where intake is not null))         as "平均摂取kcal",
  round(avg(p) filter (where p is not null))                   as "平均P(g)",
  count(*) filter (where intake is null)                       as "体重だけの日"
from public.entries e
join auth.users u on u.id = e.user_id
where u.email = 'bodylog.review@gmail.com';

-- (2) 直近7日（スクショで見えるところ）
select e.date, e.weight, e.bodyfat, e.intake, e.p, e.ex, e.adj, e.mood, left(e.food_text, 60) as メモ
from public.entries e
join auth.users u on u.id = e.user_id
where u.email = 'bodylog.review@gmail.com' and e.date > (now() at time zone 'Asia/Tokyo')::date - 7
order by e.date desc;

-- (3) 月ごとの体重推移（停滞期が2回あることを確認する）
select to_char(date, 'YYYY-MM') as 月,
       round(avg(weight), 2)    as 平均体重,
       round(avg(intake))       as 平均摂取
from public.entries e
join auth.users u on u.id = e.user_id
where u.email = 'bodylog.review@gmail.com'
group by 1 order by 1;

-- (4) テーブルごとの件数（空のままの画面が無いか）
-- migration-20/22/24/25 が未適用でもこのクエリ自体が落ちないよう、存在するテーブルだけを
-- 動的に数える（query_to_xml は「テーブル名を変数にして数える」ための定番の書き方）。
-- offset 0 は「先に存在チェックだけを済ませる」ための最適化の壁
select s.t as "テーブル",
       (xpath('/row/c/text()', query_to_xml(
          format('select count(*) c from public.%I x join auth.users u on u.id = x.user_id'
                 || ' where u.email = %L', s.t, 'bodylog.review@gmail.com'),
          false, true, '')))[1]::text::int as "件数"
from (
  select t from unnest(array[
    'logs', 'entries', 'my_foods', 'my_meals', 'events',
    'vitals', 'purpose_periods', 'coach_sessions', 'body_photos'
  ]) t
  where to_regclass('public.' || t) is not null
  offset 0
) s;

-- (5) 栄養素が items に入っているか（ここが0だと「わたしの栄養」が空になる）
select count(*) as "栄養素つきの品目数"
from public.logs l
join auth.users u on u.id = l.user_id,
     lateral jsonb_array_elements(l.items) it
where u.email = 'bodylog.review@gmail.com' and (it->>'salt') is not null;

-- (6) 直近28日の栄養素の1日平均（男性35歳の目安: 食塩7.5未満 / 食物繊維22 / K3000 / Ca750 / Fe7.5 / Zn9.5 / VD9 / VC100）
select
  round(sum((it->>'salt')::numeric) / 28, 1) as "食塩g",
  round(sum((it->>'fib')::numeric)  / 28, 1) as "食物繊維g",
  round(sum((it->>'k')::numeric)    / 28)    as "カリウムmg",
  round(sum((it->>'ca')::numeric)   / 28)    as "カルシウムmg",
  round(sum((it->>'mg')::numeric)   / 28)    as "マグネシウムmg",
  round(sum((it->>'fe')::numeric)   / 28, 1) as "鉄mg",
  round(sum((it->>'zn')::numeric)   / 28, 1) as "亜鉛mg",
  round(sum((it->>'vd')::numeric)   / 28, 1) as "ビタミンDμg",
  round(sum((it->>'vc')::numeric)   / 28)    as "ビタミンCmg"
from public.logs l
join auth.users u on u.id = l.user_id,
     lateral jsonb_array_elements(l.items) it
where u.email = 'bodylog.review@gmail.com'
  and l.date > (now() at time zone 'Asia/Tokyo')::date - 28;

-- (7) 自己ベストが直近3日以内にあるか（「きょうのハイライト」に載る）
select l.date, l.text
from public.logs l
join auth.users u on u.id = l.user_id
where u.email = 'bodylog.review@gmail.com' and l.text like '%自己ベスト%'
order by l.date desc limit 5;

-- APIのスキーマキャッシュを更新（このプロジェクトの鉄則）
notify pgrst, 'reload schema';
