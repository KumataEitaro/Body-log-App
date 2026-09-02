# リモートコンテンツ運用手順（読み物・バッジ・法則の文言をアップデート無しで配る）

対象: 熊田さん（管理者）。Supabase の SQL Editor に貼るだけで、アプリのアップデート無しに
読み物を足す／バッジを足す／法則図鑑の文言を直すことができます。

- SQL Editor: https://supabase.com/dashboard/project/rhyfspqxsfpdogzmizic/sql/new
- 前提: `supabase/migration-30.sql` を一度実行済み（テーブル `remote_content` がある）
- アプリ側の実装: `native/src/lib/remoteContent.ts`（取得・キャッシュ・マージ）

## 何ができて、何ができないか（先に理解しておくこと）

App Store の規約上、**コードを含む機能は OTA で配れません**。配れるのは「宣言的データ」だけです。

| 種類 | リモートで足せる | リモートで差し替えられる | 要アップデート |
|---|---|---|---|
| 読み物 | ○ 新記事を丸ごと | ○ 既存記事の文言 | — |
| バッジ | ○ 名前・説明・アイコン名・カテゴリ＋**条件DSLで書ける獲得条件** | ○ 既存バッジの文言 | DSLで書けない条件（例: 不死鳥＝途切れたあと再30日） |
| 法則 | × | ○ 図鑑の文言（発見文・根拠・未発見ヒント） | **新しい法則の追加**（検出は統計計算＝コード） |

## テーブルの形

```
remote_content
  id               text  主キー。例 'readings-2026-09-a'（何の配信か分かる名前）
  kind             text  'readings' | 'badges' | 'laws_text'
  version          int   同kind内の適用順。大きいほど後に適用＝優先（既定1）
  payload          jsonb { "items": [ ... ] }
  published_at     timestamptz 既定 now()
  min_app_version  text  例 '1.0.20'。この版より古いアプリは行を無視。null=全部に配る
```

アプリの動き:
- 起動時（ログイン後）＋24時間ごとに全行を読み、端末にキャッシュ。オフラインならキャッシュ、無ければ同梱データだけ
- 同梱データと **item の id で統合**。同じ id → 上書き（文言差し替え）、新しい id → 追加
- 同じ kind の行が複数あれば version 昇順 → published_at 昇順で重ねる（後勝ち）
- 解釈できない項目（必須キー欠け・未知のカテゴリ・未知の metric）は**その項目だけ捨てる**。アプリは落ちない

文言は多言語オブジェクト `{ "ja": "…", "en": "…" }` で書きます。無い言語は **ja → en** の順で代用されます。
日本語だけ書いても壊れません（英語ユーザーには日本語が見えるだけ）。

---

## 1. 読み物を1本足す（コピペ用）

```sql
insert into remote_content (id, kind, version, payload, min_app_version) values (
  'readings-2026-09-protein-timing',   -- ★ 一意な名前
  'readings',
  1,
  $${
    "items": [
      {
        "id": "protein-timing",          -- ★ 記事の id（同梱の id と同じなら差し替え）
        "emoji": "⏰",
        "minutes": 4,                     -- 読了目安。省略すると本文の長さから概算
        "publishedAt": "2026-09-02",      -- 一覧の並び（新しい順）と「NEW」表示（30日）に使う
        "langs": ["ja", "en"],            -- 省略可。指定すると、その言語で表示中のときだけ出る
        "title": { "ja": "たんぱく質は「いつ」摂るか", "en": "When to eat protein" },
        "lead":  { "ja": "1回の量と回数の目安", "en": "How much per meal, how often" },
        "body":  { "ja": "本文。**太字** と ・箇条書き が使えます。\n\n空行で段落を分けます。",
                   "en": "Body text. **bold** and ・bullets work.\n\nBlank line = new paragraph." },
        "sources": [ { "label": "Schoenfeld & Aragon 2018", "url": "https://..." } ]
      }
    ]
  }$$::jsonb,
  null                                  -- min_app_version。読み物は全バージョンでOK
);
```

同梱の記事の id（差し替え先）: `native/src/content/columns.ts` の `id:` を参照
（例 `a-day-with-bodylog`, `pfc-basics`）。

## 2. バッジを1個足す（コピペ用）

```sql
insert into remote_content (id, kind, version, payload, min_app_version) values (
  'badges-2026-09-streak200',
  'badges',
  1,
  $${
    "items": [
      {
        "id": "streak200",                -- ★ 新しい id（既存と同じ id なら文言差し替え。条件も上書きされる）
        "cat": "streak",                  -- 'streak'(継続) | 'action'(記録) | 'body'(体重) | 'move'(運動)
        "icon": "Rocket",                 -- Lucide のアイコン名（下の許可リスト）。無い名前は既定の Award
        "emoji": "🚀",                    -- ステッカー等のテキスト表現用（省略可）
        "name": { "ja": "二百日行", "en": "200 Days" },
        "desc": { "ja": "200日連続で記録する", "en": "Log 200 days in a row" },
        "when": { "metric": "streak", "op": ">=", "value": 200 }
      }
    ]
  }$$::jsonb,
  '1.0.21'                              -- ★ DSL対応が入ったビルド以降にだけ配る（下記「min_app_versionの決め方」）
);
```

### 条件DSL（when）

- 形: `{ "metric": "<名前>", "op": ">=", "value": <数値> }`。`op` は `>=`（既定）`>` `<=` `<` `==`
- AND にしたいときは配列: `"when": [ {…}, {…} ]`（全部満たしたら獲得）。OR はありません（バッジを2つに分ける）
- 使える metric（`native/src/lib/remoteContent.ts` の `BADGE_METRICS`）:

| metric | 意味 |
|---|---|
| `streak` | いまの連続記録日数（お守り込み） |
| `recordedDays` | 直近400日の通算記録日数 |
| `morningDays` | 朝（10時まで）に記録した日の累計 |
| `photoCount` | 写真解析の累計枚数 |
| `coachCount` | AI相談の累計往復数 |
| `myFoodCount` | マイ食品の登録数 |
| `restCount` | レストタイマーの累計起動回数（端末ローカル） |
| `weightLossKg` | 開始時体重 − 最低体重（kg） |
| `liftVolumeMonthKg` | 月間の挙上ボリューム最大値（kg×回数×セット） |
| `cardioKmMonth` | 月間の有酸素距離の最大値（km） |
| `burnKcalWeek` | 週間の運動消費kcalの最大値 |
| `prCount` | 自己ベストの更新回数 |
| `weekCount` | 今週（月曜起点）の記録日数 |

- 未知の metric を書いた項目は**捨てられます**（そのバッジは表示されない）。新しい metric が欲しいときはアプリ側の追加＝要アップデート
- 新しいバッジは、条件を満たしている既存ユーザーに「過去の記録から獲得しました」として遡って通知されます（既存の遡及通知の仕組みがそのまま働く）

### アイコン名の許可リスト（`native/src/components/BadgeIcon.tsx` の `BADGE_ICONS`）

```
Flame Bird Calendar CalendarCheck CalendarDays Sunrise Sun Moon Star Sparkles
Camera Aperture MessageCircle Brain Lightbulb Pencil ClipboardList ListChecks Repeat History
Salad Apple Carrot Coffee Egg Fish Leaf Sprout Wheat Utensils BookOpen CheckCheck Timer
Scale Medal Trophy Award Crown Gem Mountain Flag Target Rocket
Dumbbell Weight Footprints Route Bike Waves Wind Zap TrendingUp Activity Gauge
Heart HeartPulse Droplet Smile Users UserPlus Share2
```

## 3. 法則の文言を差し替える（コピペ用）

```sql
insert into remote_content (id, kind, version, payload, min_app_version) values (
  'laws-text-2026-09-a',
  'laws_text',
  1,
  $${
    "items": [
      {
        "id": "food_up",                  -- 法則の種類（下の一覧）。分岐のある種類は 'kind:variant'
        "title": { "ja": "あなたは「{food}」を食べた翌日、体重が+{kg}kgになりやすい" },
        "sub":   { "ja": "食べた日{n}日ぶんの傾向から" },
        "hint":  { "ja": "食べものと翌日の体重のこと" }   -- 未発見シルエットのヒント（variant無しの id にだけ効く）
      },
      { "id": "weekday:stable", "title": { "ja": "あなたはどの曜日も安定している" } }
    ]
  }$$::jsonb,
  null
);
```

- title / sub / hint はどれか1つだけでもOK。書かなかったものは同梱の文言のまま
- 差し込める変数（{…}）と種類:

| id | 変数 |
|---|---|
| `food_up` / `food_safe` | `{food}` `{kg}` `{n}` |
| `weekday`（崩れやすい曜日）/ `weekday:stable`（安定） | `{d}`=曜日名 `{kcal}` |
| `binge_trigger` | `{x}`=引き金のラベル `{lift}`=倍率 `{n}` |
| `timeslot` | `{pct}` |
| `recover` | `{days}` `{binges}` |
| `comeback` | （なし） |
| `sleep_factor:short` / `sleep_factor:long` | `{min}` `{late}` `{off}` |

- **法則そのものの追加（新しい種類）はできません**。検出は統計計算（コード）なのでアプリのアップデートが必要です

---

## min_app_version の決め方

- 読み物・法則文言: 基本 `null`（全バージョンに配る）
- バッジ: 条件DSLの評価器が入ったビルド（feat/remote-content 以降）にだけ配る。
  それより古いアプリは `remote_content` を読まないので実害はないが、**新しい metric を足したときは
  その metric が入ったビルドの版**を書く（古い版はその項目を捨てるだけなので、書かなくても落ちはしない）
- 版の文字列は `native/app.json` の `version`（例 `1.0.20`）。数値の桁で比較する

## 間違えたときの戻し方

- **行を削除する**: `delete from remote_content where id = 'badges-2026-09-streak200';`
  → 次回の取得（起動時 or 24時間後）で消える。既に獲得済みのバッジの記録（端末側）は残るが、
  定義が無いので表示されなくなるだけ
- **直したいとき**: 同じ id の行を `update remote_content set payload = $$…$$::jsonb where id = '…';`
  version を**下げない**（下げると他の行との適用順が変わり、意図しない上書きが起きる）
- **全部止めたいとき**: `delete from remote_content;`（テーブルが空でもアプリは同梱データで動く）
- 反映のタイミング: アプリは起動時＋24時間ごとに読む。すぐ確認したいときはアプリを再起動

## 確認の仕方

```sql
select id, kind, version, published_at, min_app_version, jsonb_array_length(payload->'items') as n
from remote_content order by kind, version;
```

## 書き込み権限について

`remote_content` は RLS 有効で、**select は認証ユーザー全員・insert/update/delete のポリシーは無し**。
SQL Editor（service role）からは書けるが、アプリの anon キーからは書けない。管理者が SQL Editor で
直接 insert する運用（管理画面は作らない）。
