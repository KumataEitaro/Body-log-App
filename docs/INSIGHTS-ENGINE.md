# インサイト・エンジン設計（個人ビッグデータ × 科学的裏付け）— 2026-09-02

熊田さんの構想: 「全ての項目（ヘルスケア・食べたもの・運動記録）をデータベース化して、
気分や体重変化との相関を**常に**出せるようにしておく。AI相談や『あなたの法則』で視座を出す。
複数の要素（3つ4つ）が絡み合った法則がいい気付きになる。法則カードをタップしたら、
健康への視座と科学的裏付け（最新研究）をしっかり説明する（Appleヘルスケアの解説記事の流儀）」

## 0. 参照した手本（Appleヘルスケア「心肺機能」の解説記事・2026-09-02動画）
記事の骨格 = ①これは何か（測定の意味） ②あなたの位置（年代・性別の分布の中で） ③低い/高いことの意味
④影響しうる要因（箇条書き） ⑤改善の方法 ⑥医師の診察を受けるタイミング ⑦出典（研究名）
→ BodyLogerの法則詳細ページはこの7節をそのまま採用する。

## 1. 日次特徴量ストア（lib/features.ts）
すべての分析の土台。**1日=1行**の特徴ベクトルを端末内で構築・キャッシュ（AsyncStorage `bl-day-features`）。
起動時と保存時に差分更新。生データはDBに既にあるので**派生値だけ**を持つ。

| 群 | 特徴量 | 出どころ |
|---|---|---|
| 食 | intake, over(=摂取−目標), binge(超過≥+800 or 2,500超), protein_g, meal_count, late_eating(21時以降kcal比), **time_slots**（§4） | logs/entries |
| 食材 | wheat_g, rice_g, chicken_g, salmon_g, fish_g, dairy_g, sugar_drink（品名の辞書マッチ・content/foodTags.ts） | logs.items |
| 体 | weight, weight_delta7, mood(1–5), mood_avg3 | entries |
| 睡眠 | sleep_h, sleep_debt5（5日間の目安7hからの不足累計）, deep_min, rem_min | health.ts |
| 動 | steps, active_kcal, lift_volume_kg, lift_sessions, e1rm_delta（主要種目） | health.ts / lifts |
| 周期 | cycle_day, water_window（生理周期ON時のみ） | cycle.ts |

## 2. 相関エンジン（lib/correlate.ts・純関数）
- **ラグ付き相関**: 特徴X(t−k) と 結果Y(t)、k=0..3日。Spearman（外れ値に強い）
- **条件付きリスク比**: P(binge | 条件) / P(binge)。条件は閾値化した特徴（sleep_debt5≥5h 等）
- **多要素ルール**: 2〜3条件のAND。最小サポート n≥6、リフト≥1.5、両群とも≥4日、で採択
- **安全弁**: n<14日は「まだデータが足りません」。相関は因果と言わない（文言は「〜のとき〜が起きやすい」）
- 出力 `Insight { id, kind, factors[], effect, n, confidence, text, evidenceKey }`

## 3. 法則カタログの拡張（lib/laws.ts）
既存8種に追加（すべて §2 のエンジン経由・端末内）:
- sleep_debt_binge: 「睡眠不足が5時間たまると、翌日〜翌々日に食べすぎが◯倍」
- mood_lag_binge: 「気分が3日平均で落ちると、◯日後に食べすぎ」
- wheat_vs_rice_mood: 「小麦中心の日は翌朝の気分が◯低い／米中心の日は◯」
- salmon_master: 「今月サーモン◯g（週◯回）」— 良い面（オメガ3）と多様性の視座
- chicken_heavy: 「鶏肉が月◯kg」— たんぱく源の偏り・プリン体の一般情報（診断しない）
- lift_sleep: 「7時間以上寝た翌日のトレはボリューム+◯%」
- lift_protein_pr: 「たんぱく質が目標を満たした週は自己ベスト更新が◯倍」
- lift_mood: 「トレした日の気分は平均+◯」
- **multi_*（多要素）**: 例「睡眠不足×前日気分低×水曜」→ 食べすぎ◯倍。エンジンが見つけた上位3件を動的に法則化
- 文言の断定禁止・診断禁止（既存の安全ガードと同じ線）

### 3.1 新LawKind一覧と evidenceKey（E1a実装済み・2026-09-02。E1bがエビデンスを書くための契約）
検出は `lib/laws.ts detectEngineLaws(features, today, proteinPerKg)`（純関数・`detectLaws` から合流）。
入力は `lib/features.ts` の日次特徴量（14日未満なら全種スキップ）。数値の閾値は laws.ts の `ENGINE_*` 定数。
生値 `p` は翻訳非依存で保存し、文言は表示のたびに `lawText` が組み直す（既存8種と同じ流儀）。

| kind | 採択基準（correlate.ts の安全弁 n≥14・両群≥4 に加えて） | 生値 p | 文言例 | evidenceKey |
|---|---|---|---|---|
| sleep_debt_binge | 条件: sleep_debt5≥5h。結果: 当日または翌日に binge。リスク比≥1.5・該当≥2回 | x(倍) n h | あなたは睡眠不足が5時間たまると、その日から翌日にかけて食べすぎが{x}倍起きやすい | `sleep_debt_binge` |
| mood_lag_binge | 条件: k日前の mood_avg3≤2.5（k=1..3・最大倍率のk）。結果: binge。リスク比≥1.5 | k x n | あなたは気分が3日つづけて落ちると、{k}日後に食べすぎが{x}倍起きやすい | `mood_lag_binge` |
| wheat_vs_rice_mood | 小麦中心（wheat_g≥100かつ>rice_g）vs 米中心の日の**翌日**の気分平均差≥0.5。各群≥5日 | dir(wheat_low/rice_low) d a b | あなたは小麦中心の日の翌日、気分が平均{d}低い（米中心の日と比べて） | `wheat_vs_rice_mood` |
| salmon_master | 直近30日で salmon_g>0 の日が4日以上 | g(合計・10g丸め) w(週あたり回数) days | あなたはこの30日でサーモンを約{g}g（週{w}回）食べている | `salmon_master` |
| chicken_heavy | 直近30日の chicken_g≥2,000g かつ fish_g<鶏の25% | kg g fish | あなたはこの30日で鶏肉を約{kg}kg食べている／sub: たんぱく源が偏っています。魚・卵・大豆も混ぜると栄養の幅が広がります（**病名・プリン体は出さない**） | `chicken_heavy` |
| lift_sleep | トレ日を「その朝の sleep_h≥7」で2群化・ボリューム平均差≥10%・各群≥4回 | dir(up/down) pct a b | あなたは7時間以上寝た日のトレは、ボリュームが平均{pct}%多い | `lift_sleep` |
| lift_protein_pr | 週単位（月曜起点）。条件: たんぱく質週平均≥体重×protein_per_kg×0.9。結果: 週内に pr。トレ週≥6・各群≥2・リスク比≥1.5 | x n | あなたはたんぱく質が目標に届いた週、自己ベスト更新が{x}倍起きやすい | `lift_protein_pr` |
| lift_mood | トレ日 vs 非トレ日（記録あり）の気分平均差≥0.4・各群≥5日 | dir(up/down) d a b | あなたはトレした日の気分が、平均{d}高い | `lift_mood` |
| multi_binge | `correlate.mineRules(features,'binge',{minSupport:6,minLift:1.5,maxFactors:3})` の上位3件のうち2因子以上。id は `multi_binge:<key1+key2>`（キー辞書順＝決定的） | f(因子キー'+'結合) x n h | あなたは「前日の気分が低め」「睡眠不足が5時間以上たまっている」がそろった日、食べすぎが{x}倍起きやすい | `multi_binge` |

- `lawVariant`: wheat_vs_rice_mood → `wheat_low` / `rice_low`、lift_sleep・lift_mood → `up` / `down`（リモート文言 `laws_text` の id は 'kind:variant'）
- 多要素ルールの因子キーとラベルは `lib/correlate.ts CONDITIONS`（`conditionLabel(key)` で現在の言語へ）。
  事前アラート（§8）に使えるのは `morning: true` の条件（睡眠・前日の状態・曜日・生理前後）だけ
- Insight 型（correlate.ts）: `{ id, kind:'lag_corr'|'risk_ratio'|'rule', factors[], outcome, effect, n, confidence:'low'|'mid'|'high', text, evidenceKey, lag?, support?, hits?, baseRate? }`。
  confidence は n と効果量の3段階（high: n≥30かつ倍率≥2 / mid: n≥21 または n≥14で倍率≥2 / low: それ以外）

## 4. 食べた時間の精密化（log.tsx トレイ・後続E2）
現状の朝/昼/夜は保存時刻（DB now()）由来で粗い。トレイに**「食べた時間」チップ**を追加:
「いま」既定／「朝7時」「昼12時」「15時」「19時」「22時」の候補／時刻ピッカー（15分刻み）。
選んだ時刻を `logs.at` に入れて保存（過去日の記録も正しい時刻に）。特徴量の time_slots は
早朝(4–7)/朝(7–10)/午前(10–12)/昼(12–14)/午後(14–17)/夕(17–20)/夜(20–23)/深夜(23–4) の8区分。

## 5. 法則の解説記事（app/law-detail.tsx・E1b）
カードをタップ → 全画面の記事。§0の7節構成:
1. **あなたのデータ**（この法則を導いた実データのミニチャート・n日・期間）
2. **これは何を意味するか**（非審判・1〜2段落）
3. **科学的背景**（content/evidence.ts: 研究名・著者・誌名・年・要点1行。**実在を確認できた文献のみ**。
   「最新の研究では…」の煽り表現は禁止。査読論文/メタ分析/主要ガイドラインを優先）
4. **あなたができること**（具体行動3つ・小さく始められるもの）
5. **医療機関に相談する目安**（該当する法則のみ・診断しない）
6. **注意**（相関≠因果／個人差／このアプリは医療機器ではない）
7. **出典**（リンクはDOI/PubMed。アプリ内ブラウザで開く）
- 文言・出典は remote_content の `laws_text` で差し替え可（既存の仕組みに乗せる）
- **ストーリー共有は法則から外す**（熊田さん: 「法則をストーリーに乗せる意味はない」）。共有はバッジ・筋トレ実績・体重グラフに限定

## 6. AI相談への注入（coach.tsx → dataBlock）
相談時の dataBlock に「見つかっている法則の上位3件＋直近7日の特徴量サマリ」を追加。
コーチはそれを引いて答える（例:「あなたは睡眠不足が5時間たまると翌日に食べすぎる傾向があるので、今週は…」）。

## 7. 実装フェーズ
- E1a: features.ts / correlate.ts / laws.ts拡張 / coach注入（lib中心）
- E1b: law-detail.tsx / evidence.ts / 共有スコープ変更 / laws.tsx導線（UI中心）
- E1c: E1aで増えた法則へのエビデンス追記（E1a・E1b完了後）
- E2: 食べた時間チップ（log.tsx・マイ食品作業の完了後）

## 8. 気づきアラート（法則駆動の事前警告・熊田さん 2026-09-02「過食アラートはとてもいい」）
既存の「過食リスクの事前アラート」（食事タブのカード＋通知）を、**エンジンが見つけた個人の法則で駆動**する。
- `evaluateAlerts(todayFeatures, insights): Alert[]`（lib/correlate.ts・純関数）
  今日（と直近数日）の特徴量が、採択済みルールの**条件側**を満たしたら発火。
  例: 「睡眠負債5.5h ＋ 昨日の気分↓」→「今日は食べすぎが起きやすい条件が2つそろっています」
- 出し方（優先順）: ①食事タブのカード（既存 BingeTriggerCard を拡張・条件を箇条書きで見せる・
  「今日は+200kcal緩める」1タップ予防はそのまま） ②朝の通知（smartモードのときだけ・1日1件まで・
  文言は非審判「今日は◯◯の日。無理せず」）
- **ポジティブ側も出す**: 「7時間寝た→今日はトレのボリュームが伸びやすい日」「たんぱく質が足りている週→PRのチャンス」。
  警告だけだと監視されている感が出るため、良い条件が揃った日は背中を押す
- 抑制: 同じアラートは1日1回・連続3日出たら4日目は休む（慣れ防止）・n<14の法則からは出さない
- 実装分担: 判定=E1a（correlate.ts）、カード/通知の配線=E2（log.tsx・notify.ts・マイ食品作業の完了後）
- **E1a実装メモ（2026-09-02）**: `evaluateAlerts(todayFeatures, recentFeatures, insights): Alert[]`
  （recentFeatures から「今日の前日」の行を引いて prev_* 条件を判定する）。
  `Alert = { id:'alert:'+ruleId, tone:'caution'|'positive', factors:string[]（満たした条件の現在言語ラベル）, text, ruleId }`。
  tone は結果側から（binge/mood_low → caution、lift_volume_up → positive）。n<14 の Insight と、条件が判定不能（null）の日は発火しない。
  `suppressAlerts(alerts, history:{id,date}[], today)`: 同 id は1日1回・直近3日連続で出ていれば今日は休む。
  ルールの供給は `mineDefaultRules(features)`（binge＋lift_volume_up）。UI側の保存（history）は E2 が持つ
