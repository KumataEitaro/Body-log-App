# わたしの栄養 — 微量栄養素トラッキング 最終仕様（v1）

- 作成日: 2026-09-06（設計フェーズ・コード未変更）
- 位置づけ: 本書が「わたしの栄養」機能の正本。実装後は docs/FEATURES.md に節を追加し本書を参照する。判断ゲートは docs/STRATEGY.md、法務は docs/LEGAL.md、特徴量は docs/INSIGHTS-ENGINE.md。
- 統合元: 3案の審査で最高点だった案1（管理栄養士ファースト）を骨格に、案2（グランサビリティ）・案3（データ品質・コスト）の graft を取り込み、審査員3名の veto を全て守った。
- 一言で: **記録は増やさない。既に logs.items に貯まっている10栄養素を初めて読み、7日平均で見て、2週の事実が揃ったときだけ帯1本で知らせ、足すなら候補を並べる。**

> **実装状況（2026-09-25・feat/nutrition-intake）** — 本書の設計のうち、次を **栄養ランキング画面（`native/src/app/nutrient-rank.tsx`）に実装した**。
> 別画面 /nutrients・帯 'nutrient'・ピン設定シート・週判定（7日/28日/12週）は未実装で、本書のまま残す。実装内容の正本は docs/FEATURES.md の同日の節。
> - タブ「自分の摂取」: 直近30日の `logs.items` を `foodKey` で名寄せし、栄養素ごとに「1日あたりの平均量」（合計 ÷ 記録のある日数）で食材を並べる
> - タブ「不足栄養素」: 30日平均を 2025年版の基準（性別×年齢区分・たんぱく質は体重×g/kg・脂質/炭水化物/飽和脂肪酸は維持カロリーの %E）と比べ、少なめ順。
>   判定語は 足りている／やや少なめ／少なめ／超えている の4つ。行展開で「おすすめ食材」（食べたことのある食材先頭・レバー末尾＋注記・カリウムに腎注記）
> - **§2.1 の「軸は増やさない」は撤回**: 熊田さんの指示で記録する栄養素を 10 → 31 キーに拡張した（下表）。parse-food プロンプトも同じ表から生成
> - 「たんぱく源」ティアのタブは削除（`content/proteinTiers.ts` は残る）。§4.4 の再設計は不要になった
> - 基準の正本は `native/src/content/dri2025.ts`（下表の出典 URL をヘッダーに記載）。§2.2 の表のうち mg 30〜49歳男性は 2025年版で 380mg（2020年版の 370 から変更）
>
> | キー | 栄養素 | 単位 | 2025年版の指標 | 出典（一次資料 PDF・厚労省） |
> |---|---|---|---|---|
> | p / f / c | たんぱく質・脂質・炭水化物 | g | 推奨量（体重×g/kg を優先）／目標量 20〜30%E／50〜65%E | 001316462 / 001316463 / 001316464 |
> | salt | 食塩相当量 | g | 目標量（上限 7.5／6.5） | 001316468 |
> | fib | 食物繊維 | g | 目標量（下限） | 001316464 |
> | sug | 糖類 | g | 基準なし（記録のみ） | — |
> | satfat / n6 / n3 | 飽和脂肪酸／n-6系／n-3系 | g | 目標量 7%E 以下／目安量／目安量 | 001316463 |
> | k / ca / mg / phos | カリウム／カルシウム／マグネシウム／リン | mg | 目標量（下限）／推奨量／推奨量／目安量 | 001316468 |
> | fe / zn / cu / mn / iod / se / cr / mo | 鉄／亜鉛／銅／マンガン／ヨウ素／セレン／クロム／モリブデン | mg・µg | 推奨量（鉄は月経あり/なし）／推奨量／推奨量／目安量／推奨量／推奨量／目安量／推奨量 | 001316469 |
> | va / vd / ve / vk | ビタミンA（µgRAE）／D／E／K | µg・mg | 推奨量／目安量／目安量／目安量 | 001316466 |
> | vb1 / vb2 / nia / vb6 / vb12 / fol / pan / bio / vc | B1／B2／ナイアシン（mgNE）／B6／B12／葉酸／パントテン酸／ビオチン／C | mg・µg | 推奨量／推奨量／推奨量／推奨量／目安量／推奨量／目安量／目安量／推奨量 | 001316467 |
>
> PDF は https://www.mhlw.go.jp/content/10904750/<番号>.pdf。報告書の掲載ページ https://www.mhlw.go.jp/stf/newpage_44138.html 。
> 転記の確認: 健康長寿ネット https://www.tyojyu.or.jp/net/kenkou-tyoju/eiyouso/ （各栄養素ページ・2025年版）

---

## 1. 目的と判断ゲート（STRATEGY.md との整合）

### 1.1 目的（熊田さんの要望 → 機能）

| 要望 | 実装で応えるもの |
|---|---|
| 一般のランキングではなく「自分が何をどれくらい食べているか」 | /nutrients 「何をどれくらい食べているか」（自分の品目ランキング・回数×kcal・その品目が最も運んだ栄養素1つ）＋栄養素行の展開「この期間に運んだもの Top3」 |
| 足りない栄養素についてだけ食品をサジェスト | 判定が「やや少なめ」以下の栄養素の行を開いたときだけ「増やすなら候補」（既定3件＋もっとで6件・食べたことがあるもの先） |
| たんぱく源ティアが横スライドしないと見えない | nutrient-rank.tsx の横 ScrollView 2箇所を撤去し、折り返しチップ＋「食べたもの先頭」＋「+n」展開に再設計 |
| 足りない栄養素を食事タブのダイジェストに出す | logCards に帯 'nutrient' を1本追加（2週続いた事実だけ・週1回・肯定の帯も同枠） |
| 特に取りたい栄養素を設定・目標値（推奨値をサジェスト）・毎日トラッキング | ピン最大6・Auto/Custom/なし・既定値は食事摂取基準2025 から性別×年齢で解決・食事タブ収支カードに「今日のピン1行」（設定でON） |
| 週・月単位で栄養士視点で追う | 数値は日次でも見えるが**判定の最小単位は7日平均**、段階上げは2週、微量栄養素（vd/zn/vc/mg）は28日のみ |
| 2026年9月時点の UI/UX トレンド | 週平均主・日次補助／1行=水平バー＋floor/target/ceiling／開示2階層／small multiples／tabular-nums／赤は上限超えのみ／横スクロール0本 |

### 1.2 判断ゲート（STRATEGY.md §4）への回答

| ゲート | 回答 |
|---|---|
| 迷いを減らすか | 減らす迷いは「何を足せばいいか」の1点。候補は本人がタップした後にだけ、事実（数値）のみで出す |
| 記録の負担を増やさないか | 新しい入力はゼロ。AI解析品目に既に付いている salt〜vc をそのまま読む。マイ食品由来は名寄せで補完し、埋まらない分は欠損として正直に見せる |
| 既存カードと喧嘩しないか | カードは増やさない。帯 'nutrient' 1本のみ、MAX_BANDS=2 内で arbitrateAttention の結果に従う |
| 煽らないか | 日次で判定しない・不足に赤を使わない・病名/断定/サプリ/用量を出さない・単週の食塩超過を言わない・肯定の帯も同枠で出す（減点だけの機能にしない） |
| プレミアム導線として自然か | 「身体理解」（7日ビュー・判定・帯・免責・腎注記）は無料、「次の行動」の深掘り（28日/12週・寄与Top3・Custom目標・候補2件目以降）は standard 以上。安全に関わる情報はゲートしない |

### 1.3 STRATEGY.md への追記（WP10）

判断ゲートに1行追加: **「疾患名・サプリメント・用量（◯mg摂る）の提示をしない」**。

---

## 2. 追う栄養素と既定目標

### 2.1 集合の決め方

- 軸は **items.ts の NUTRIENT_KEYS（salt,fib,sug,k,ca,mg,fe,zn,vd,vc）から選ぶ。軸は増やさない**（parse-food プロンプト変更なし＝QAループ再検証・出力トークン増なし）。
- 図鑑（nutrientDb: p,va,vc,ve,fe,zn,ca,k,fib,n3）との対応は `LOG_TO_NAV` 対応表1か所に閉じ込める（fib,k,ca,fe,zn,vc は同名。vd は WP8 で図鑑に軸追加。salt/mg/sug は図鑑に無い）。
- たんぱく質（p）は既存目標（goals.protein_per_kg × 体重・weekly-review/laws）に任せ、本機能では重複表示しない。

| 区分 | 栄養素 | 週で判定 | 既定ピン | 理由（令和5年 国民健康・栄養調査 20歳以上） |
|---|---|---|---|---|
| Tier 1 | ca カルシウム | ○ | 全員 | 男490/女476mg = 推奨量の61〜65% |
| Tier 1 | fib 食物繊維 | ○ | 全員 | 男19.2/女17.3g（20代女性14.6g）vs 目標20〜22/18g |
| Tier 1 | k カリウム | ○ | 男性既定 | 男2,370/女2,190mg vs 目標量3,000/2,600（腎注記常設） |
| Tier 1 | fe 鉄 | ○ | 女性既定 | 女7.2mg（20代6.5）vs 月経あり10.0〜10.5。男性は充足（8.0 vs 7.0〜7.5） |
| 抑える行 | salt 食塩相当量 | ○（上限型） | 全員（設定でオフ可） | 男10.7/女9.1g vs 目標7.5/6.5未満。唯一の「減らす」方向。ピン枠とは別の行 |
| Tier 2 | vd ビタミンD | ×（28日のみ・判定なし） | 任意 | 目安量（AI）9.0のため「上回れば十分」だけ言う。個人内変動最大（±20%で138日） |
| Tier 2 | zn 亜鉛 | ×（28日） | 任意（bulk 既定） | 平均が推奨量の境界 |
| Tier 2 | vc ビタミンC | ×（28日） | 任意 | 20代のみ低い |
| Tier 2 | mg マグネシウム | ×（28日） | 任意 | 優先度低 |
| 記録のみ | sug 糖類 | 判定しない | 不可 | 日本の基準に目標量が無い。ランキング/寄与のみ |

**既定ピン（性別 × PurposeKey × 生理周期モード、あすけんの「コース連動」方式）**
- 女性: fe, ca, fib, k　／　男性: ca, fib, k
- bulk 目的: fib を zn と入れ替え（zn は月判定なので週ビューではグレー行になる → **既定ピンには入れず、bulk のときだけ「その他の栄養素」の先頭に固定**。ファーストビューに読めない行を置かない veto を優先）
- 生理周期モード ON（CYCLE_ENABLED_KEY='1'）: fe を先頭固定
- 上限: 6本。7個目は disabled。週で判定しない Tier 2 は既定ピンに入れない。

### 2.2 既定目標の算出（content/dri2025.ts）

正本: **「日本人の食事摂取基準（2025年版）」**（使用期間 2025/4〜2030/3）。`DRI_VERSION='2025'` を持つバージョン付き定数。テーブルは `DRI[sex]['15-17'|'18-29'|'30-49'|'50-64'|'65-74'|'75+'][key] = { ear?, rda?, ai?, dg?, dgIsUpper?, ul?, note }`。

解決規則 `resolveTargets(profile:{sex?,age?}, prefs)`:
- target = rda ?? dg ?? ai。floor（少なめの可能性の判定線）= ear（あるときだけ）。ceiling = ul（あるときだけ）。
- 上限型（salt）: target なし・ceiling = dg。0% でも達成扱い。
- 目安量型（vd）: target = ai・floor なし・**判定しない**。
- sex/age 未設定: 男女の低い方の値を採り floor=null（不足を強く言わない）＋「性別と年齢を入れると基準が正確になります」の1行。
- 15〜17歳（LEGAL.md は16歳未満不可＝16〜17歳が存在）: 15-17 帯を持つ。転記が間に合わない場合は 18-29 を流用し**「参考値」注記を必ず付ける**。
- pregnant=true: 全栄養素 null を返す（判定停止・「医療者に相談」の一文のみ）。
- fe（女性）: `menstruating: true|false|null`。null の間は 6.0 で計算し「参考値」＋帯候補外。生理周期モード ON のときはシートに「月経あり」を**提案として初期表示**し、本人が1タップ確認したら保存（年齢だけから推定して既定にしない）。

| 栄養素 | 単位 | 既定値（18–29 / 30–49 / 50–64）男性 | 女性 | 指標 | floor（EAR） | 上限（UL） | 出典 |
|---|---|---|---|---|---|---|---|
| ca | mg | 800 / 750 / 750 | 650 / 650 / 650 | 推奨量 | 男650/650/600・女550 | 2,500 | 厚労省2025年版報告書 https://www.mhlw.go.jp/stf/newpage_44138.html ／ 概要PDF https://www.kenpakusha.co.jp/data/seigo1/005004-05.pdf ／ https://www.tyojyu.or.jp/net/kenkou-tyoju/eiyouso/mineral-ca.html |
| fib | g | 20 / 22 / 22 以上 | 18 以上 | 目標量 | なし（0.8×dg を「少なめが続く」線に代用） | なし | 同上 ／ https://www.tyojyu.or.jp/net/kenkou-tyoju/eiyouso/shokumotsu-seni.html |
| k | mg | 3,000 以上（目安2,500） | 2,600 以上（目安2,000） | 目標量 | なし（0.8×dg 代用） | なし（腎注記常設） | 同上 ／ https://www.tyojyu.or.jp/net/kenkou-tyoju/eiyouso/mineral-k.html |
| fe | mg | 7.0 / 7.5 / 7.0 | 月経なし 6.0 ／ 月経あり 10.0 / 10.5 / 10.5 | 推奨量 | 男5.5/6.0/—・女なし5.0・あり8.5/9.0/9.0（要照合） | なし（2025年版で削除） | 同上 ／ https://www.tyojyu.or.jp/net/kenkou-tyoju/eiyouso/mineral-tetsu.html ／ 削除理由 https://sndj-web.jp/news/003031.php |
| salt | g | 7.5 未満 | 6.5 未満 | 目標量（上限型） | — | 目標量そのもの | 同上 ／ https://www.tyojyu.or.jp/net/kenkou-tyoju/eiyouso/mineral-na.html |
| vd | μg | 9.0 | 9.0 | 目安量（判定なし） | なし | 100 | 同上 ／ https://www.tyojyu.or.jp/net/kenkou-tyoju/eiyouso/vitamin-d.html |
| zn | mg | 9.0 / 9.5 / 9.5 | 7.5 / 8.0 / 8.0 | 推奨量（28日） | rda−約1.5（要照合） | 男40/45/45・女35 | 同上 ／ https://www.tyojyu.or.jp/net/kenkou-tyoju/eiyouso/mineral-zn-cu.html |
| vc | mg | 100 | 100 | 推奨量（28日） | 80 | なし | 同上 |
| mg | mg | 340 / 370 / 370 | 270 / 290 / 290 | 推奨量（28日） | 要照合 | なし（通常食品） | 同上（2020年版と同値・2025報告書と照合） |
| sug | g | — | — | 判定なし | — | — | WHO <10%E は参考のみ |

- 65-74 / 75+ 帯・15-17 帯・各 EAR は WP1 で厚労省報告書 PDF（一次資料）から転記し、**セルごとに出典ページをコメントに残す。未照合の値は参考値扱い**（veto）。
- nutrientDb.NUTRIENT_META.ref（「充足率表示に使わない」と明記された成人固定値）は流用しない。図鑑の「得意な栄養素」判定はそのまま残す。
- 摂取量の平均値（国調）出典: https://www.mhlw.go.jp/content/001435373.pdf

### 2.3 ユーザー設定（NutrientPrefs）

```ts
type NutrientPrefs = {
  v: 1;
  pins: TrackedKey[];                       // 最大6
  saltRow: boolean;                         // 抑える行の表示（既定 true）
  targets: Partial<Record<TrackedKey, { mode: 'auto'|'custom'|'off'; target?: number; ceiling?: number|null }>>;
  menstruating: boolean | null;             // 女性のみ表示
  pregnant: boolean;                        // true で全判定停止
  showTodayOnLog: boolean;                  // 食事タブ収支カードの今日ピン1行（既定 false）
};
```

- Custom は **target のみ編集可**。floor（EAR）は編集不可。ceiling は「UL より下げる」方向のみ許可（空欄=上限なし）。UL を超える target は保存拒否（「上限量を超えています」1行）。
- 入力欄内に単位（mg/μg/g）を固定表示。妥当範囲は NUTRIENT_RANGE_MAX 相当でクランプ。
- 「なぜこの値か」を1タップで開く（指標名・年齢帯・出典）。

---

## 3. データの取り方

### 3.1 役割分担（結論: ハイブリッド・端末内純関数・AI呼び出し0・週次バッチ不要）

| 役割 | 担当 | 備考 |
|---|---|---|
| 一次ソース | logs.items の AI推定10キー | 既に保存済み（quicklog.parseFoodApi が dietFlag だけ剥がして保存）。今日から読める |
| 二次ソース（補完） | nutrientDb `findFood(name)` × グラム推定 | マイ食品・my_meals・旧データ向け。対象は LOG_TO_NAV にある fib/k/ca/fe/zn/vc（＋WP8後 vd）。salt/mg/sug は補完しない＝欠損 |
| 欠損 | null | 0 と混ぜない（features.ts 原則） |
| 判定・総括・帯 | 端末内純関数（lib/nutrientIntake.ts・nutrientAlert.ts） | dailyBrief と同じ「API課金ゼロ・定型文」。LLM 生成は禁止（禁止語を保証できない） |
| AI | 変更なし | parse-food テンプレ・menu-advice・what-to-eat は触らない |
| サーバー週次バッチ | 不要 | — |

### 3.2 品目→栄養値 `itemNutrients(item, db)`

1. **AI値の採用条件**: parse-food は「不明・微量は0」と指示しているため AI の 0 は未知を含む。**品目の10キーが全て 0 または欠損なら「値なし」扱い**（coverage の分子に入れない）。それ以外は `typeof it[key]==='number'` を値ありとして採用（0 も値）。source='ai'。
2. AI値が無ければ `findFood(item.name, db)`。ヒットしたらグラム g を次の優先で推定 → `per100[key] × g / 100`。source='db'。
   - (i) item.kcal>0 かつ per100.kcal>0 → `g = kcal / per100.kcal × 100`（10〜600g にクランプ。本人の記録 kcal と自己整合し、qty '×0.17' 形式にも堅い）
   - (ii) qty に g/ml → その数値
   - (iii) qty に unit.label（個/枚/本…）→ n × unit.g
   - (iv) それ以外 → serving
3. どちらも無い → null。
4. **補完値は logs.items に書き戻さない**（図鑑値と記録値の線引き）。集計結果に source を持たせ、行展開で「出どころ: AI推定 n品・食材辞書 m品・不明 k品」を常設。

### 3.3 日別集計と「評価できる日」

- `deriveNutrientDays(rows, db)` → `{ date, mealCount, kcal, values: Partial<Record<Key, number|null>>, coverage: Record<Key, number>, sources }`。
- `coverage[key] = Σkcal(値ありの品目) / Σkcal(全品目)`。
- **評価できる日 E**: 食事ログ ≥1 かつ coverage[key] ≥ 0.8 かつ（mealCount ≥ 2 または intake ≥ 0.6×目安kcal）。E 以外の日は null（値を出さず平均の分母に入れない＝Cronometer「含める日」の自動版）。

### 3.4 取得・キャッシュ

- クエリは **features.ts の `fetchRaw`（logs.select('date,at,text,items') 90日 limit3000）を export して共用**（二重取得しない）。12週ビューの分母は 84 日で足りる。
- キャッシュ: AsyncStorage `'bl-nutrient-days'` v1・TTL 15分・`invalidateNutrientDays()`（features.ts と同じ流儀）。
- **Phase 1 では DayFeature に列を足さない・CACHE_V を触らない**（correlate/laws の回帰ゼロ）。Phase 2 で法則に載せるときに `FeatureRaw.logs.items` 型と `CACHE_V=2` を同時に上げる。
- nutrient-rank.tsx の独自クエリ `fetchEatenIds`（L41-58）は廃止し、集計済み日別品目から `eatenIds` を導出（クエリ1本減）。

### 3.5 精度の見せ方

- 画面リード: 「記録した食事から推定した摂取量です。日々の値は目安で、週の平均で見ます。」
- 行展開末尾: 「出どころ: AI推定 12品・食材辞書 4品・不明 2品」。
- 評価できた日が 4 未満の週: 全体グレーアウト＋「参考値（記録が少ない週）」。平日と週末の両方が無い週: 「参考値（週末の記録なし）」。
- 数値整形は toLocaleString/Intl を使わず lib/format.ts の `fmtNum`（自前桁区切り）。

### 3.6 DB変更の要否

| 変更 | 要否 | 扱い |
|---|---|---|
| logs | 不要 | items jsonb をそのまま読む |
| my_foods 列追加 | v1 不要 | Phase 2 判断（nutrients jsonb を足して登録時に AI値をコピー） |
| goals.nutrient_prefs jsonb | **任意**（migration-33.sql） | v1 は AsyncStorage `'bl-nutrient-prefs'` を正として SQL 0 で出荷可。列が現れたら DB を正に昇格。保存は PGRST204/列無し検出→端末保存フォールバック必須（GoalPanel L189-198 の流儀） |
| migration-32（remote_content kind 'nutrients'） | 既存・ユーザー実行待ち | migration-33 と束ねて SQL 依頼を1回にする |

---

## 4. 画面仕様（テキストワイヤー）

共通規約: `themed(() => ({...}))`・色は C.* トークンのみ（生 rgba 禁止。半透明の塗り・上限帯は lib/ui.ts の Palette に `tealSoft`/`amberSoft` 等を追加して使う）・`t('日本語')`・fontSize ≥ 11・数値は `fontVariant:['tabular-nums']`（システムフォント）・行はラベルと数値を横並び・行高＝内容高（Fabric×iOS lineHeight 事故回避）・**横 ScrollView 0本**・開示は2階層（一覧→行のインライン展開で終わり。行タップで別画面に飛ばない）。

### 4.1 「わたしの栄養」/nutrients（新規 Stack 画面・title「わたしの栄養」）

```
┌ わたしの栄養 ──────────────────────────────┐
│ 記録した食事から推定した摂取量です。日々の値は目安で、週の平均で見ます。│
│ [ 7日 | 28日 | 12週 ]   ← SegmentedControl はこの1本だけ            │
│ 9/1〜9/7 ・ 評価できた日 5/7                                        │
│ 「食物繊維とカリウムは目安どおり。カルシウムは目安の6割ほどで、       │
│   先週と同じでした。」  ← 定型文・状態語は最大2栄養素、残りは         │
│                           「ほかは目安どおり」に畳む                 │
│                                                                    │
│ カルシウム  推奨量650mg  ▐▓▓▓▓▓▓░░░░│░░▒▒  62%  少なめ傾向   今日 210 │
│ 食物繊維    目標量18g    ▐▓▓▓▓▓▓▓▓▓▓│      95%  目安どおり  今日 8   │
│ カリウム    目標量2,600  ▐▓▓▓▓▓▓▓▓▓░│      88%  目安どおり  今日 1,300│
│ 鉄          推奨量6.0    ▐▓▓▓▓▓▓▓▓▓▓▓│     110%  参考値      今日 4.1 │
│   （月経の有無が未設定のため参考値。設定で変更 →）                  │
│                                                                    │
│ ── 抑える ──                                                       │
│ 食塩相当量  目標量6.5g   ▐▓▓▓▓▓▓▓▓▓▓│▓▓   118%  ▲            今日 4.2│
│                                                                    │
│ ▸ その他の栄養素（4）  28日の平均のみ・バーなし                      │
│                                                                    │
│ 何をどれくらい食べているか（この期間・上位10）                        │
│  🍗 鶏むね肉      5回・合計1,240kcal・P 98g   Ca の 4%             │
│  🥛 牛乳          4回・合計  540kcal・P 26g   Ca の 41%            │
│  …（行タップ → /nutrient-rank?food=名前 の既存置き換え候補）        │
│                                                                    │
│ 食材の図鑑を見る（栄養ランキング・たんぱく源） →                    │
│ 数値は目安です。一般的な健康維持を目的とし、疾病の診断・治療・予防を │
│ 目的としていません。  この数値について →                            │
└────────────────────────────────────────────┘
```

**バー（components/NutrientBar.tsx）**
- track=C.hairline 系、目標位置（100%）に細い縦線、floor（EAR）があれば左側に薄い縦線、ceiling がある ca/zn/vd は右端に薄い上限帯（C.amberSoft）。
- 塗り: 目標未達=C.tealSoft（無彩色寄り）／目標帯内（≥0.9×target）=C.successInk／上限超え継続=C.amber＋▲。**不足に赤を使わない**。130% までクリップせず伸ばす。
- 右端は % ＋ **状態語を必ず文字で併記**（色覚配慮の二重符号化）: 「目安どおり」「少なめ傾向」「少なめが続く」「多め」「参考値」「—（判定なし）」。
- 「今日 ◯」は C.sub・判定色なし（日次は補助）。
- 数値は毎日更新、**状態語・色・総括・帯は週開始日（月曜・WEEK_GOAL_KEY と同じ基準）に確定した窓で1週間固定**（ヒステリシス。日々ちらつかせない）。
- 抑える行（食塩）: 上限内=C.successInk、超過分を C.amber で右に伸ばす。単週超過は「多め」と言わず % と ▲ のみ。

**行タップのインライン展開（2階層目・ここで終わり）**
1. 4週の small multiples（週平均の縦棒4本＋目標線・同一スケール・アニメなし）。12週ビューでは12本。
2. 「この期間にこの栄養素を運んだもの Top3」（自分の記録・foodKey 集約・寄与%。事実の並べ替え、審判しない）。
3. 判定が少なめのときだけ「増やすなら、こんな候補があります」（§4.2）。食塩が「多めが続く」のときだけ「減らすヒント」固定3文（汁物を半分／加工肉・練り製品・即席麺の回数／野菜と果物を合わせる）。
4. 「目標を編集」→ NutrientTargetSheet（設定と同じコンポーネント）。
5. 出どころ1行「AI推定 n品・食材辞書 m品・不明 k品」。
6. k の展開には常設注記「腎臓の治療中の方は医師の指示を優先してください」。fe の展開には nutrientDb note の事実1行「ビタミンC・たんぱく質と一緒で吸収が上がる」。

**期間**
- 7日（既定）: 直近7日移動平均。判定色あり（Tier 1・食塩）。Tier 2 はここに出さない。
- 28日: 直近28日平均。Tier 2（vd/zn/vc/mg）の判定色はここでのみ（vd は判定せず「目安量を上回った日 n/28」）。
- 12週: 各行を週平均12本の small multiples に置き換え、総括は「12週のうち目標帯に入った週 n/12」。
- 28日/12週は standard 以上（王冠 → /paywall?src=nutrients）。

**空状態**: 評価できた日 <4 → バーを描かず「あと n 日記録すると7日の平均が出ます」。マイ食品比率が高く coverage が低い週 → 「マイ食品の栄養データが少ないため参考値」。

**初回**: 上部に1回だけ SpotlightTip「この画面の見方」（週平均で見る・日々は目安・免責リンク）。AsyncStorage 'bl-nutrients-intro'。

**`?focus=<key>`**: 該当行を展開して開く（帯・概要タブから）。

### 4.2 不足→食品サジェスト（lib/nutrientSuggest.ts）

- 出す場所: /nutrients の行展開内のみ。**プッシュ・通知・モーダル・自動で開くシートは禁止**。
- 対象: 判定 'slightlyLow' / 'likelyLow' の栄養素。salt は食品ではなく行動3文。mg は静的候補5品（種実・大豆製品・海藻・玄米・バナナ）を L10n で持つ。sug は候補なし。
- 生成: `LOG_TO_NAV[key]` → `rankByNutrient(nav, 'serving', 20)` →
  1. 直近30日に食べた食材（eatenIds）を先に最大3件「食べたことのあるもの」、次に「他の候補」。既定3件、「もっと」で6件。
  2. レバー類（va ≥ 1000μg/100g）は上位3件に出さず末尾へ。nutrientDb `note` の「ビタミンAが多いので週1回程度が目安」を添える。
  3. 減量目的なら tier.overeat=3 を後ろに。
  4. 各行「絵文字・名前・1食の目安量で ◯mg（目標の◯%ぶん）・kcal」。効能表現なし、数値のみ。サプリ・商品名・用量指示なし。
  5. k の見出し下に腎注記を必ず付ける。
- 「いま食べているものからなら」: `swapsForFood(自分のTop品目, {nutrient, mode})` の先頭1件（既存 smartSwap・FORBIDDEN_WORDS 規約が自動で効く）。
- 無料は候補1件＋王冠。standard 以上で全件。

### 4.3 追いたい栄養素の設定（components/NutrientTargetSheet.tsx）

```
┌ 栄養の目標 ──────────────────────────────┐
│ 追う栄養素（最大6）                                              │
│ [鉄●][カルシウム●][食物繊維●][カリウム●][亜鉛][ビタミンC][ビタミンD][Mg]│
│ 抑える行: 食塩相当量  [ON]                                       │
│ 月経の有無（女性のみ）: [ あり | なし | 未設定 ]                   │
│   生理周期モードがONのため「あり」を提案しています → [この設定にする]│
│ 妊娠・授乳中: [OFF]  ON にすると判定を止め、医療者への相談をご案内します│
│ 食事タブに今日のピンを表示: [OFF]                                 │
│ ── 栄養素ごとの目標 ──                                           │
│ カルシウム  [ 自動 | カスタム | 追わない ]   650 mg  ▸ なぜこの値か │
│   （日本人の食事摂取基準 2025年版・推奨量・18〜29歳女性）           │
│ …                                                                │
│ 性別と年齢を入れると基準が正確になります → プロフィール              │
└──────────────────────────────────────────┘
```

- 入口: GoalPanel(hub) 内 HabitGoals に行「栄養の目標 ›」（現在のピン名を小さく併記）、および /nutrients 各行の「目標を編集」。同一コンポーネント（設定の場所を2つ持たない）。
- 保存: AsyncStorage 'bl-nutrient-prefs' を即時保存 → goals.nutrient_prefs 列があれば upsert（PGRST204 で端末保存に落ちる）。

**毎日の表示（食事タブ）**: showTodayOnLog=true のとき、既存の構造カード「収支」（PFC の下）に1行「ピン: Ca 210mg・繊維 8g・K 1,300mg・塩 4.2g」（C.sub・判定色なし・tabular）。タップで /nutrients。カードは増やさない。既定 OFF（§8 決定事項）。

### 4.4 たんぱく源ティアの再設計（nutrient-rank.tsx → components/ProteinTierTable.tsx / NutrientFoodRank.tsx に抽出）

```
┌ たんぱく源 ────────────────────────────────┐
│ [ 減量の基準 | 増量の基準 ]                                        │
│ あなたのたんぱく源: Aティア以上 72%（直近30日・たんぱく質g加重）     │
│ [食べたものだけ]  ← Chip トグル・AsyncStorage 'bl-tier-mine'         │
│                                                                    │
│ [S] 5品・うち2品を直近30日に                                        │
│  鶏むね肉● まぐろ赤身● 卵白 ささみ 鮭   ← flexWrap 折り返し・食べた物先頭│
│ [A] 8品・うち3品                                                    │
│  木綿豆腐● 納豆● 鮭● 鶏もも(皮なし) さば たら  [+2]                  │
│ [B] …                                                              │
│ ▸ C 6品   ▸ D 4品   ▸ E 3品   ← 本人の食べた物を含まないティアは折り畳み│
│                                                                    │
│ （選択チップの直下に格付け理由 tierReason）                           │
│ わたしの栄養（摂取量の記録） →                                      │
└────────────────────────────────────────────┘
```

- 各ティアは見出し行（バッジ・n品・食べた数・▾）＋ `View{flexDirection:'row', flexWrap:'wrap', gap:6}`。**ScrollView horizontal を撤去**。
- 既定表示: 食べた物（foodChipAte）＋先頭6品、残りは「+n」チップで展開。S/A と本人の食べた物を含むティアは展開、他は折り畳み。
- 理由パネルは選んだチップの直下（画面下に飛ばさない）。
- 「ランキング」タブの栄養素チップ（L149）も flexWrap 2段（vd 追加で11個）。
- タブ構成・既定タブ・`?food=` `?tab=` `?nutrient=` は現状維持（既存導線を壊さない）。SegmentedControl の2段積みを避けるため「わたし」タブは作らず、別画面 /nutrients に住まわせる。

### 4.5 導線

| 起点 | 変更 |
|---|---|
| 概要タブ「食事の傾向」（changes.tsx key 'nutrients'） | 行の枚数・key・ALL_ORDER_DEFAULT・並び替えは不変。CARD_LABELS を「栄養」に、MiniSpark 位置にピン4本のミニバー（数値なし・展開なし）、summaryOf を定型1文（例「今週: Ca 62%・繊維 95%・K 88%」、4日未満は「あと n 日で週の平均が出ます」）。タップ → /nutrients |
| 食事タブ 帯 'nutrient' | タップ → /nutrients?focus=<key> |
| 食事タブ 収支カード「今日のピン1行」 | 設定 ON 時のみ → /nutrients |
| 記録行長押し「置き換え候補を見る」／トレイ「かしこい置き換え」 | 現状維持（/nutrient-rank?food=） |
| ColumnReader「栄養ランキング」 | 現状維持（/nutrient-rank） |
| /nutrient-rank 末尾 | リンク「わたしの栄養 →」 |
| /nutrients 末尾 | リンク「食材の図鑑を見る →」 |
| 週次レビュー | 評価文の下に1行「栄養の週平均を見る →」（WeekGoalKind は増やさない） |
| 設定 GoalPanel(hub) → HabitGoals | 行「栄養の目標 ›」 |

---

## 5. ダイジェストへの帯（logCards 調停・頻度・文面・免責）

### 5.1 logCards.ts

- `AttentionBand = 'badge' | 'firstLaw' | 'nutrient' | 'brief'`
- `BAND_PRIORITY = ['badge','firstLaw','nutrient','brief']`（nutrient は「2週の事実が揃った週に1回」の希少な信号なので毎日の brief より先。badge/firstLaw の日は nutrient か brief のどちらかが落ちる。MAX_BANDS=2 は不変）
- `TODAY_ONLY` に **入れる**（過去日画面に「この2週間」を出さない。logCards 冒頭の思想）。`MORNING_ONLY` には入れない（週平均は時刻非依存）。
- カードは増やさない。arbitrateAttention の結果（`attention.nutrient > 0`）以外で描画しない。uiConvention.test.ts のキー配列に 'nutrient' を追加。

### 5.2 供給元 lib/nutrientAlert.ts（純関数）

- 評価タイミング: 週開始日（月曜 JST）。候補 = ピン済みで週判定の栄養素のうち「2週続く」段階（推奨量型 W14<EAR／目標量型 W14<0.8×dg／食塩 W14>1.3×dg）。優先: 推奨量型 EAR未満 → 食塩 → 目標量型。**1本だけ**（one big thing・最乖離）。
- 肯定の帯: 前週 'likelyLow'/'high' だった栄養素が今週 target 以上（食塩は dg 以下）に入ったら mood:'happy' を1回。減点だけの機能にしない。
- 頻度: AsyncStorage `'bl-nutrient-band'` = `{ key, shownWeek, closedAt }`。同じ栄養素は7日に1回、×で閉じたら同栄養素は28日出さない、栄養素が変われば出せる。fe は menstruating=null の間は候補外。pregnant=true は全停止。
- 無料でも帯は出す（安全に関わる情報をゲートしない）。タップ先の候補2件目以降だけ王冠。

### 5.3 文面（nutrientCopy.ts の定型・LLM 不使用）

| 種別 | title（1行） | body（展開） |
|---|---|---|
| 少なめが続く | 「この2週間、カルシウムは目安の6割ほどでした。候補を見る →」 | 「推奨量650mgに対して平均 410mg（評価できた日 9/14）。牛乳・ヨーグルト・小魚・豆腐など、続けやすいものから。」 |
| 食塩 | 「この2週間、食塩は目標量より多めが続いています。減らすヒント →」 | 「汁物を半分・加工品を減らす・野菜と果物を合わせる、のいずれかから。」 |
| 肯定 | 「今週はカルシウムが目標帯に入りました。」 | 「出どころを見る →」 |

原則: 事実文（〜でした／〜が続いています）＋次の一手1つ。数値は「目安の◯割」に丸める。使わない語: 不足しています・欠乏・病名・診断/治療/予防/改善・サプリ・◯mg摂って・べき・危険・注意・**アラート**（UI 上は「傾向」「目安」に統一。alert はコード識別子のみ）。

### 5.4 免責（docs/LEGAL.md に正本・4点）

1. 一般的な健康維持を目的とし、疾病の診断・治療・予防を目的としない（プログラム医療機器該当性ガイドラインが「望ましい」とする表示）
2. 医療専門家の助言・医療栄養療法の代替ではない
3. 妊娠・授乳中／服薬中／腎疾患など疾患のある人・摂食障害の既往がある人は使用前・使用中に医療者へ相談
4. 栄養計算は食品データベースと入力精度に依存し、正確性・栄養的十分性を保証しない

掲出: /nutrients フット常設短文＋「この数値について」全文、設定シート、初回 SpotlightTip。免責は誤認を治癒しない（FTC）ので本文自体を安全な表現にすることを優先。

---

## 6. 実装パッケージ（並列可能な粒度）

原則: 各 WP は専用 worktree で進め、親が直列マージ（メモリ規約）。共有ファイルは WP ごとに1つに閉じる（nutrient-rank.tsx=WP7、log.tsx=WP6、changes.tsx/weekly-review.tsx=WP10、features.ts=WP2、lib/ui.ts=WP9）。全 WP 共通規約: themed 関数形・C.* のみ・t()・fontSize≥11・横 ScrollView 禁止・Intl/toLocaleString 禁止・null と 0 を混ぜない・禁止語テストを ja/en に当てる。

| ID | タイトル | 対象/新規ファイル | 主な関数・型 | テスト | 依存 |
|---|---|---|---|---|---|
| **WP0** | 共有型・対応表・文言集約（先行・半日） | 新規 `native/src/lib/nutrientTypes.ts`, `native/src/lib/nutrientCopy.ts` | `TrackedKey`（ca,fib,k,fe,salt,vd,zn,vc,mg,sug）, `Judgment = 'ok'|'slightlyLow'|'likelyLow'|'high'|'overCeiling'|'na'`, `NutrientTarget{kind,target,floor?,ceiling?,label,note}`, `NutrientPrefs`, `NutrientDay`, `LOG_TO_NAV`, `NUTRIENT_FORBIDDEN`（ja/en）, `assertSafeCopy(text)`, 全ラベル・状態語・帯文・見出しの t() 定数 | `nutrientTypes.test.ts`: LOG_TO_NAV のキーが items.NUTRIENT_KEYS / NAV_NUTRIENT_KEYS に実在。`nutrientCopy.test.ts`: 全定数に FORBIDDEN_WORDS＋NUTRIENT_FORBIDDEN が含まれない（ja・en） | なし。他 WP はここだけに依存して並列開始 |
| **WP1** | 基準表と目標解決 | 新規 `native/src/content/dri2025.ts`, `native/src/lib/nutrientTargets.ts`, `__tests__/dri2025.test.ts` | `DRI_VERSION`, `DRI[sex][band][key]`, `ageBandOf(age)`, `resolveTargets(profile, prefs)`（pregnant→null, fe 3値, 未設定→低い方＋floor null, 15-17 参考値） | 全セル: rda≥ear・ul>target・上限型に floor なし・非負。境界 17/18, 29/30, 49/50, 64/65, 74/75。fe 3値。pregnant null。未照合セルに `// TODO:照合` が残っていないこと（出荷ゲート） | WP0 |
| **WP2** | 摂取量の日別集計・窓統計・判定 | 新規 `native/src/lib/nutrientIntake.ts`, `__tests__/nutrientIntake.test.ts`；変更 `native/src/lib/features.ts`（`fetchRaw` を export のみ） | `itemNutrients(item, db)`（AI全0→値なし／findFood×グラム推定チェーン／null）, `deriveNutrientDays(rows, db)`, `isEvaluableDay`, `windowStats(days,key,n)`（E日数・平均・平日/週末有無）, `judge(stats, target, prevStats)`, `weekAnchor(todayJST)`（月曜固定）, `weeklySummaryText`（最大2栄養素＋「ほかは目安どおり」）, `topFoods(days,10)`, `contributors(days,key,3)`, `eatenIdsFrom(days)`, `sourceBreakdown`。キャッシュ 'bl-nutrient-days' v1・TTL15分・`invalidateNutrientDays()` | 欠損のみの日→null／AI全0品目→値なし／0値→0／coverage 0.79→評価外／E<4→'na'／7日 EAR 未満でも 'likelyLow' にならず14日で昇格／目標量型 0.8dg 境界／食塩 単週>dg は 'ok'＋over フラグ、W14>1.3dg で 'high'／vd 常に 'na'／pregnant 全 'na'／週末なし→参考値フラグ／kcal逆算 10〜600 クランプ／qty '×0.17' の扱い／summary 禁止語。features.test の回帰（export のみ） | WP0（型）。WP8 完了前は vd 補完なしで動く |
| **WP3** | 設定の保存とシート | 新規 `native/src/lib/nutrientPrefs.ts`, `native/src/components/NutrientTargetSheet.tsx`, `supabase/migration-33.sql`, `__tests__/nutrientPrefs.test.ts`；変更 `native/src/components/HabitGoals.tsx`（行追加のみ） | `defaultPins(sex, purpose, cycleOn)`, `loadPrefs()`（AsyncStorage→goals 列があれば DB を正）, `savePrefs()`（端末即時→upsert onConflict user_id→PGRST204/列無しで端末のみ）, `clampTarget`, `rejectAboveUL` | 既定ピンが sex/purpose/cycle で変わる／7個目拒否／UL 超え拒否／ceiling は下げる方向のみ／列無しフォールバック（supabase モック）／JSON 破損→既定／往復。シートを screens.test に登録。themeConvention/uiConvention | WP0, WP1 |
| **WP4** | 画面 /nutrients とバー部品 | 新規 `native/src/app/nutrients.tsx`, `native/src/components/NutrientBar.tsx`, `native/src/components/WeekMultiples.tsx`；変更 `__tests__/screens.test.tsx` | ワイヤー §4.1。`?focus=` で行展開。期間 Segmented 1本。行展開（multiples・Top3・候補・目標編集・出どころ・腎注記）。gated('nutrients') で 28日/12週・Top3・候補2件目以降に王冠。免責フット。SpotlightTip 初回 | screens.test（空／参考値／上限超え／pregnant／focus）。NutrientBar スナップショット（3状態＋上限帯＋抑える行 0%=成功色）。uiConvention（fontSize・horizontal 不在）。Intl/toLocaleString 不在 | WP0, WP1, WP2, WP3（Sheet）, WP5, WP9 |
| **WP5** | 食品サジェストと帯の選定（純関数） | 新規 `native/src/lib/nutrientSuggest.ts`, `native/src/lib/nutrientAlert.ts`, `native/src/content/nutrientHints.ts`, `__tests__/nutrientSuggest.test.ts`, `__tests__/nutrientAlert.test.ts` | `suggestFoods(key, eatenIds, mode, limit=3|6)`（レバー末尾＋note・食べた物先・overeat 後送り・1食で目標の◯%）, `saltHints()`, `mgStaticCandidates`, `swapFromOwn(topFood, key, mode)`, `pickBand(judgments, prevJudgments, prefs, store, todayJST)`（1本 or null・happy 変換・7日/28日ルール・fe null 除外・pregnant 停止） | 全栄養素×全 judgment×属性の全出力に禁止語（ja/en）。レバーが上位3件に来ない。k 注記必須。候補 ≤6・重複なし。pickBand: 候補0/1/複数で最乖離1つ・×後28日 null・同軸7日1回・happy・pregnant null | WP0, WP2（型）, WP8（vd 候補。未完なら vd は静的8品で代替） |
| **WP6** | 食事タブの帯と収支カードの今日ピン | 変更 `native/src/lib/logCards.ts`, `native/src/app/(tabs)/log.tsx`, `__tests__/logCards.test.ts`, `__tests__/uiConvention.test.ts`；新規 `native/src/components/NutrientBand.tsx`（DailyBrief.tsx の帯レイアウトを props 拡張して流用可） | `AttentionBand` に 'nutrient'、`BAND_PRIORITY`、`TODAY_ONLY` 追加。log.tsx: candidates に `nutrient: band?1:0`、`attention.nutrient>0` で描画、×で closedAt、タップ /nutrients?focus=。収支カード showTodayOnLog 行 | logCards.test: badge+firstLaw で nutrient/brief が落ちる・過去日で出ない・beforeWake でも出る。uiConvention のキー配列に 'nutrient'。既存8キー不変 | WP2, WP5, WP0 |
| **WP7** | nutrient-rank.tsx 横スクロール撤去・ティア再設計 | 変更 `native/src/app/nutrient-rank.tsx`；新規 `native/src/components/ProteinTierTable.tsx`, `native/src/components/NutrientFoodRank.tsx`；変更 `__tests__/uiConvention.test.ts`（horizontal 禁止の機械チェック: nutrient-rank.tsx・両コンポーネント・nutrients.tsx） | §4.4。`tierShareOf` の1行、'bl-tier-mine' トグル、食べた物先頭、+n 展開、折り畳み、栄養素チップ wrap、fetchEatenIds → `eatenIdsFrom(days)`（WP2）に差し替え、末尾リンク | screens.test（tiers タブ・eaten あり/なし）。horizontal grep 0件。foodNav.test の ≥80 品維持 | WP2（eatenIdsFrom。未完なら暫定で既存 fetchEatenIds を lib に移して後差し替え） |
| **WP8** | nutrientDb に vd 軸と note フィールド | 変更 `native/src/content/nutrientDb.ts`, `native/src/lib/remoteContent.ts`, `__tests__/foodNav.test.ts`, `docs/REMOTE-CONTENT.md` | NavNutrient に 'vd'（μg・decimals 1・ref 9.0）、`NUTRIENT_RANGE_MAX.vd=100`、`validateNutrientFood` の 0 埋め・note?: L10n 検証、NAV_NUTRIENTS 末尾、約15〜20品に vd 値（鮭33・さんま16・いわし32・さば5.1・しらす61・ぶり8・卵3.8・乾しいたけ17・まいたけ4.9・きくらげ85 等・八訂）、レバーに note | vd 範囲内・rankByNutrient('vd') 上位に魚/きくらげ・remote 欠け→0・note が {ja,en}。「約80品」表記を実数に揃える（テスト ≥80 維持） | なし（独立） |
| **WP9** | 数値整形とテーマトークン（小・先行） | 変更 `native/src/lib/format.ts`（`fmtNum` 自前桁区切り）, `native/src/lib/ui.ts`（Palette/C に `tealSoft`, `amberSoft` 等・型とキー一致）；置換 `nutrientDb.fmtAmount` L112・`HabitGoals` L65・`dailyBrief` L100 の toLocaleString | `fmtNum(n, decimals)` | format.test（桁区切り・小数）。themeConvention（Palette と C のキー一致）。置換3箇所の既存テスト回帰 | なし（独立・WP4/6/7 が使う） |
| **WP10** | 概要/週次レビュー配線・ドキュメント・i18n | 変更 `native/src/app/(tabs)/changes.tsx`（CARD_LABELS・summaryOf 動的化・ミニバー・遷移先。行の枚数/key/並び替えは不変）, `native/src/app/weekly-review.tsx`（1行リンク）, `docs/FEATURES.md`, `docs/STRATEGY.md`, `docs/LEGAL.md`, `docs/INSIGHTS-ENGINE.md`, `native/src/content/i18n/*.ts` | scripts/i18n-keys.js → translate-loop.mjs → dedup-dict.js。en は 'may help maintain' 系に留め 'deficiency'/'prevent'/'should' を禁止語テスト | dicts.test（プレースホルダ・日本語残り）。en 禁止語テスト。docs の「約80品」残存 0件。weekly-review の禁止語テストに1行を含める | WP4, WP6（画面と帯が存在すること） |

**依存グラフ（並列レーン）**
```
WP0 ─┬─ WP1 ─┬─ WP3 ─┐
     ├─ WP2 ─┼─ WP5 ─┼─ WP4 ─┐
     │       └─ WP6 ──┼──────┼─ WP10
     ├─ WP7（WP2 の eatenIdsFrom を後差し替え可）
     ├─ WP8（独立）──→ WP5 の vd 候補
     └─ WP9（独立）──→ WP4/WP6/WP7
```
- 1日目に並列開始できるもの: WP0（半日）→ WP1・WP2・WP7・WP8・WP9。
- 2日目以降: WP3・WP5 → WP4・WP6 → WP10。

---

## 7. テストと検証

| 段階 | 内容 |
|---|---|
| 型 | `cd native && npx tsc --noEmit`（全 WP マージ後） |
| 単体 | `npx jest` 全緑。新規: dri2025 / nutrientIntake / nutrientPrefs / nutrientSuggest / nutrientAlert / nutrientTypes / nutrientCopy / format。既存回帰: logCards.test・uiConvention.test（'nutrient' 追加・8キー不変）・themeConvention.test（Palette 追加トークン）・screens.test（nutrients.tsx・NutrientTargetSheet・nutrient-rank tiers）・foodNav.test（≥80 品・vd）・dicts.test・features.test・weeklyReview.test・dailyBrief.test |
| 禁止語 | smartSwap.FORBIDDEN_WORDS ＋ NUTRIENT_FORBIDDEN を「全栄養素×全 judgment×属性」の総当たり出力に当てる（ja）。en 辞書に 'deficiency' / 'deficient' / 'prevent' / 'should' / 'cure' / 'treat' / 'anemia' / 'osteoporosis' の禁止語テスト |
| 規約 | uiConvention に「nutrients.tsx・nutrient-rank.tsx・ProteinTierTable.tsx・NutrientFoodRank.tsx に `horizontal` を含む ScrollView が無い」／新規ファイルに `toLocaleString`・`Intl.` が無い／fontSize ≥ 11／`arbitrateAttention(` と `attention.nutrient` 参照 |
| i18n | `node native/scripts/i18n-keys.js` で未登録 0 → `node scripts/translate-loop.mjs`（本番 /api/translate-qa・QA_SECRET）→ `node native/scripts/dedup-dict.js` |
| 実機 | iPhone SE 幅でピン6本＋抑える行＋展開が縦1列に収まる／ダーク・ライト両方でバーの視認性（テキスト 4.5:1）／Fabric×iOS の lineHeight 事故が行に出ない |
| Android smoke | docs/ANDROID.md の手順で: 食事タブ→帯 'nutrient' 表示（テスト用に閾値を満たすシード）→タップ→/nutrients?focus= で行展開→候補→目標を編集→保存→たんぱく源ティア折り返し→概要タブ行→週次レビュー1行。Intl 不使用の確認（Hermes で桁区切りが崩れない） |
| 露出観測 | 実機で1週間、logCards の帯2枠に nutrient がどの頻度で入ったかをログで確認（brief を恒常的に押し出していないか） |
| 自己検閲 | メモリの手順（ペルソナ洗い出し→UX監査→バグ洗い出し→再発防止）。ペルソナ: 初心者／トレーニー／生理周期モード利用者／閉経後女性／腎疾患既往／マイ食品中心の利用者／妊娠中 |

---

## 8. 熊田さんの決定事項

| # | 論点 | 統合案の推奨 | 代替 |
|---|---|---|---|
| D1 | **SQL 実行** | v1 は SQL 0 で出荷（prefs は AsyncStorage）。migration-33.sql（`alter table public.goals add column if not exists nutrient_prefs jsonb;`）は migration-32（kind 'nutrients'）と束ねて **1回**で実行を依頼。実行先: https://supabase.com/dashboard/project/rhyfspqxsfpdogzmizic/sql/new 。列が現れたら DB を正に昇格 | 列を作らず端末内のみ（複数端末で目標が同期しない） |
| D2 | **AI コスト** | v1 は新規 AI 呼び出しゼロ・parse-food テンプレ不変（va/ve/n3 を返させない）。総括文・帯文は定型 | Phase 2 で my_foods.nutrients jsonb を足し登録時に AI 値をコピー（migration＋foods.ts 拡張） |
| D3 | **プレミアム範囲** | 無料: 7日ビュー・判定・帯・免責・腎注記・候補1件・概要タブ行。standard 以上: 28日/12週・寄与Top3・Custom 目標・候補2件目以降。新 GatedFeature 'nutrients'、/paywall?src=nutrients | 既存 'eating' に相乗り |
| D4 | 食事タブ収支カードの「今日のピン1行」既定 | **OFF**（日次に一喜一憂させない）。設定で ON 可 | ON 既定 |
| D5 | 帯の優先順位 | `['badge','firstLaw','nutrient','brief']`（週1回の希少信号を brief より先） | brief の後ろ（badge の日は nutrient がほぼ出ない） |
| D6 | 女性の鉄・月経の有無 | 設定シートで任意入力。生理周期モード ON なら「あり」を提案し1タップ確認。未確認は 6.0 仮置き＋参考値＋帯候補外 | 初回に1問聞く |
| D7 | 既定ピン | 女性 fe/ca/fib/k、男性 ca/fib/k、bulk は zn を「その他」先頭固定、生理周期 ON は fe 先頭。最大6 | 男性にも fe を入れる（充足しているので非推奨） |
| D8 | vd の図鑑軸追加（WP8） | 含める（約15〜20品転記・半日）。含めない場合は vd 候補を静的8品（鮭・さんま・いわし・さば・しらす・きくらげ・しいたけ・卵）で代替 | — |
| D9 | 65-74 / 75+ / 15-17 帯の転記 | v1 に含める（報告書 PDF から転記・出典ページをコメント）。間に合わない帯は隣接帯流用＋「参考値」必須 | — |
| D10 | 概要タブ行の形 | 行の枚数・key・並び替え不変で、MiniSpark 位置にミニバー4本＋定型1文（ReorderableCards を触らない） | インラインカード化（行高変化で並び替え座標に影響） |
| D11 | リリース形態 | 全てコード変更＝App Store 審査を通すアップデート。feat ブランチで独立、パッチ Ver 上げ、承認時に vX.Y.Z タグ＋release ブランチ（リリース管理メモ） | 次パッチ版に同梱 |
| D12 | 品目数表記 | 「約80品」を実数（98＋WP8 追加分）に統一。テストは ≥80 維持 | — |

---

## 9. やらないこと（veto）と理由

| やらない | 理由 |
|---|---|
| 日次の値で過不足を判定・着色・帯化する | 個人内変動が個人間変動の1.3〜27倍。真の平均±20%に必要な日数は繊維7日・Ca10日・VC21日・亜鉛30日・VD138日（日本人栄養士28日研究）。判定の最小単位は7日平均（E≥4）、段階上げは2週、vd/zn/vc/mg は28日 |
| 目安量（AI）しか無い栄養素（vd・k の目安量側）を下回って「少なめ」と言う | NASEM: AI は「上回れば十分」だけが言える。vd は「目安量を上回った日 n/28」のみ |
| 7日だけで「可能性が高め」「多めが続いている」と言う／単週・単日の食塩超過を言う | 国調平均が目標の1.4倍で単週基準はほぼ全員に毎週点く＝煽り。食塩は W14>1.3×dg でだけ |
| 病名・診断/治療/予防/改善・「不足しています」「欠乏」・サプリ・商品名・「◯mg摂って」・べき・危険・注意・「アラート」を UI に出す | 日本: プログラム医療機器該当性・健康増進法誇大表示。米国: FDA device 扱い・FTC 実証義務。net impression 対策で語彙自体を「傾向」「目安」に統一。ja/en 両辞書に禁止語テスト |
| LLM に判定文・総括文・帯文を生成させる | 禁止語と断定回避を保証できない。定型テンプレ＋テストで固定 |
| 女性の鉄で月経の有無を年齢から推定して既定にする | 無月経・子宮摘出・早期閉経の利用者に恒常的な「少なめ」を出す。本人確認なしの属性推定は安全側でない |
| 妊娠・授乳中に通常基準の充足率バーや候補（特にレバー）を出す | 基準が大きく変わる。全判定停止＋「医療者に相談」の一文のみ |
| カリウムの候補・判定表示から腎注記を省く | 腎機能低下者は制限が必要 |
| Custom target を UL 超えで保存する／floor・ceiling をユーザーに編集させる | 誤設定で「少なめの可能性」を誤発火。ceiling は下げる方向のみ |
| 上限量を持つ栄養素（ca/zn/vd）で上限側を隠す／上限しか無い栄養素を「未達」色にする | Cronometer の弱点。食塩は 0% でも達成扱い |
| 不足に赤を使う／色だけに意味を持たせる | 赤は上限超えだけ。状態語または▲で二重符号化（色覚配慮） |
| プッシュ通知・モーダル・自動で開くシートで不足を知らせる／食事タブにカードを増やす／MAX_BANDS=2 を超える | Yazio の失敗例。logCards の枠を守る。候補はタップ後にだけ |
| null と 0 を混ぜる／AI の 0 を無条件に「値あり」とする／coverage 未達の日を平均に入れる | features.ts の設計原則。parse-food は「不明・微量は0」と指示しており 0 は未知を含む。品目10キー全 0/欠損は値なし |
| nutrientDb の補完値を logs.items に書き戻す | 図鑑値（±20〜30%目安・正本ではない）と記録値の線引きを崩す |
| 免責・腎注記・上限表示・7日ビューの判定を有料ゲートや 'bl-brief-off' の裏に隠す | 安全に関わる情報は無料側に置く |
| 食品候補に効能表現（〜に効く・〜を防ぐ）／レバーを注記なしで上位3件に出す | 数値（1食で目標の◯%）だけ。VA 上限 2,700μgRAE との衝突 |
| 糖類（sug）に目標や判定を付ける | 日本の基準に目標量が無い。摂食障害配慮 |
| dri2025.ts の値を一次資料と照合せずに出荷する | セルごとに出典ページをコメント。未照合は参考値 |
| 横スクロール（ScrollView horizontal）を栄養関連画面に新設・残存させる | 熊田さんの指摘＋small multiples 研究＋Fabric×iOS 事故。uiConvention で機械的に再発防止 |
| SegmentedControl を2段積みする（タブ＋期間） | ファーストビューが操作部で埋まる。「わたし」は別画面 /nutrients、期間切替1本 |
| 3階層目（行タップで別画面）を作る／ファーストビューに既定でグレー行を置く | NN/g（開示は2階層）。Tier 2 は既定ピンに入れない |
| /nutrient-rank の既定タブ・`?food=` `?tab=` ・ColumnReader 導線を変える | 既存導線を壊さない |
| 過去日の食事タブに「この2週間」の帯を出す／MORNING_ONLY に入れる | TODAY_ONLY に入れる（logCards の思想）。週平均は時刻非依存 |
| Phase 1 で DayFeature に列を足す／CACHE_V を触らない列追加 | 旧キャッシュ混入で全軸 null。Phase 1 は独立キャッシュ 'bl-nutrient-days'、Phase 2 で型と CACHE_V=2 を同時に |
| parse-food プロンプト変更（va/ve/n3 追加）・新規 AI 呼び出し | /api/parse-food-qa と一字一句同一維持・QA ループ再検証・出力トークン増 |
| SQL 未実行環境で保存が失敗するリリース | PGRST204/列無し検出→端末保存フォールバック必須 |
| StyleSheet.create（lib/ui.ts 以外）・生 rgba/色リテラル・fontSize<11・lineHeight 縦積み・Intl/toLocaleString の新規使用 | themeConvention / uiConvention / docs/ANDROID.md L370 |

---

### 参考（一次資料）
- 日本人の食事摂取基準（2025年版）: https://www.mhlw.go.jp/stf/newpage_44138.html ／ 概要PDF https://www.kenpakusha.co.jp/data/seigo1/005004-05.pdf
- 令和5年 国民健康・栄養調査 第1部: https://www.mhlw.go.jp/content/001435373.pdf
- NASEM DRI 個人評価: https://www.ncbi.nlm.nih.gov/books/NBK222891/
- 日本人女性栄養士 28日秤量記録（必要日数）: https://pmc.ncbi.nlm.nih.gov/articles/PMC10468340/
- プログラム医療機器該当性ガイドライン（PMDA）: https://www.pmda.go.jp/files/000240233.pdf
- FDA General Wellness: https://www.fda.gov/media/90652/download ／ FTC Health Products Compliance Guidance: https://www.ftc.gov/business-guidance/resources/health-products-compliance-guidance
- MacroFactor Nutrient Explorer（floor/target/ceiling）: https://macrofactor.com/micronutrients-nutrient-explorer/ ／ NN/g progressive disclosure: https://www.nngroup.com/articles/progressive-disclosure/
