# 自己監査 1.1（App Store 提出前・2026-09-02）

手順は熊田さん指定の順（①ペルソナ洗い出し → ②UX監査 → ③バグ洗い出し → ④再発防止）。
対象は native/（Expo SDK 57・iOS/Android）。本日入った大改修（＋ボタン→2段シート・筋トレ全画面・運動記録シート・
目標統合・週間収支・気づきアラート・法則記事・マイ食品AI・ヘルスケア自動同期・新パレット・招待・生理周期・
フィードバック・バイタル・広告枠）の**相互作用**を重点に、コード上でシナリオを追跡した。
ブランチ `fix/self-audit-1.1b`（main へのマージは親が行う）。バージョンは触っていない。

検証: `cd native && npx tsc --noEmit` → 0 ／ `npx jest --silent` → 0（68 suites・1,082 tests）／ルート `npm test`（vitest）→ 0（18 files・250 tests）／
`node scripts/i18n-keys.js` → 未登録 0 件。

---

## 1. アプリの特長とペルソナ

### 特長（docs/FEATURES.md から）
- 入力は「右下の＋ → 何を記録するか（食事／運動／体の写真／体重）→ どう入力するか（マイ食品／テキスト／写真／撮影）」の2段（Appleヘルスケア式）。
  AIがテキスト・写真からカロリーとPFCを出し、トレイ→✓保存で確定。マイ食品（単品・セット）は1タップ。
- ヒーロー「あと食べられる量」（超過は3段階・増量は反転）＋週と月の収支（体重は週・月の合計で決まる）。
- 個人ビッグデータ: 日次特徴量→相関エンジン→「あなたの法則」→法則駆動の気づきアラート（caution／positive）・法則の解説記事（7節・出典つき）。
- 筋トレは全画面の記録画面（レスト／セット／±kgダイアル）・全機能無料。運動は種目シート＋時間ダイアル。ヘルスケアは一度許可したら変更イベント駆動で恒久同期。
- 非審判のトーン（過食・空白・穴埋めのすべてで責めない）・食事の制約（推定であり安全確認には使えない免責）・王冠は「見えるけど開かない」（課金列車と同時点火）。

### ペルソナ5（いつ・どこで・どう使うか）

| # | ペルソナ | いつ／どこで | 使い方の核 | 1日の利用シナリオ（起床→就寝） |
|---|---|---|---|---|
| P1 | **減量したい30代会社員**（男性・BMI27・目標−6kg/4か月・平日デスクワーク） | 平日: 通勤電車（7:40）・昼休みのコンビニ前（12:10）・帰宅後ソファ（21:30）。土日: 昼過ぎにまとめて | ＋→食事→テキスト（「牛丼並とサラダ」）／写真を選ぶ。ヒーローの残量で夜の量を決める。週間収支で「今週は戻せる」を確認 | 起床: 体重（＋→体重）→朝の気分1タップ。朝食: 電車で「おにぎり2個と缶コーヒー」。昼: コンビニ写真を撮影→トレイ→✓保存、残量ストリップで夜のぶんを見る。夜: 帰宅後に外食メニュー撮影→「これにする」。就寝前: ひとこと帯を読む・週間収支のドット確認。**前日入れ忘れ→翌朝の穴埋めカード**で±0。 |
| P2 | **筋トレ民**（20代後半・週4ジム・増量期 bulk・たんぱく質重視） | 平日 19:30–21:00 ジム（地下・圏外あり）。朝は自宅でプロテイン | 運動タブ→「筋トレを記録する」全画面（レスト常時・＋セット・±kg）。食事はマイ食品（セット「朝プロテイン」）1タップ。P達成率が主役 | 起床: マイ食品セット長押しで即記録。昼: 弁当写真。ジム: 記録画面でセットを積む（圏外→端末に保存・復帰後同期）→保存で RMフィードバック。夜: 増量ノルマ「あと食べる620kcal」に従って追加。就寝: 概要→筋トレの成長で e1RM。 |
| P3 | **中高年の健康管理**（58歳女性・高血圧・医師から減量指示・iPhone文字サイズ「大」） | 朝食後の食卓（8:00）・夕方の散歩後（17:30）。ヘルスケアで歩数・体重計連携 | 大きい文字で残量と歩数を見る。バイタル記録・医師向けPDF。ヘルスケア自動同期（体重は体重計から）。通知は「記録がない日だけ」 | 起床: 体重計→ヘルスケア→自動取込（何もしない）。朝食: ＋→食事→撮影。昼: マイ食品「いつもの定食」。夕方: 運動タブで歩数と「あと約N歩」。夜: バイタル（血圧）を入力。就寝前: 概要の詳細ページを読む。**ダイナミックタイプ**でヒーローが崩れないか、11px 未満の文字が無いかが命。 |
| P4 | **周期の影響が大きい女性**（30代・PMS期に過食・生理周期ON・気分記録を毎朝） | 毎朝 7:00 ベッドの中（気分）・昼休み・夜 22:00 | 朝の気分カード・生理周期カード・過食リスク／気づきアラート（「生理の前後」「前日の気分が低め」がそろった日）→「+200kcal緩める」 | 起床: 気分1タップ→周期カードで「水分が増える時期」。朝食: テキスト。昼: 写真。夕方: caution カード「条件が2つそろっています」→+200kcal緩める→法則の解説を読む。夜: 食べすぎても「準備のサイン」の文言で記録を続ける。就寝: ポジティブ気づき（7時間眠れた→明日のトレ）。 |
| P5 | **食事制約のある人**（40代男性・グルテンフリー＋えび不可・英語UI・海外在住） | 朝 6:30（時差あり・JST 固定の日付境界に注意）・外食が多い夜 | 設定→食事の制約（同意ゲート）→トレイの警告行（high/maybe）・免責常設・外食メニューおすすめで「対象の可能性」注記。英語UIの翻訳漏れに最も敏感 | 起床: 英語UIで体重入力。朝食: マイ食品。昼: 写真解析→「しょうゆ」が maybe（アンバー）で警告→自分で判断して保存（ブロックしない）。夜: メニュー撮影→注記つきおすすめ。就寝: 設定でアカウント削除の説明を読む（"Delete" と打って通ること）。 |

---

## 2. UI/UX の指摘（画面:箇所／問題／根拠（原則名）／対処）

凡例: ✅対処済み（このブランチ） ／ 📝記録のみ（§5 未対応と理由）／ ✔問題なし（確認済み）

| # | 画面:箇所 | 問題 | 根拠（原則） | 対処 |
|---|---|---|---|---|
| U1 | 食事:ヒーロー直下 | ひとこと帯・最初の法則の帯・バッジ帯・チェックリスト・穴埋め・caution・positive×2・気分 が**それぞれ独立に自分を出す**。全部そろうと「今日の記録」まで最大11ブロック | Nielsen #8 美的で最小限のデザイン／認知負荷 | ✅ 調停関数 `lib/logCards.ts arbitrateAttention`（§4）。カード最大2・帯最大2・優先順位固定 |
| U2 | 食事:ヒーロー直下 | 過去日を表示中でも「今日は食べすぎが起きやすい」「いまの気分は？」「昨日の穴埋め」が出る | Nielsen #1 システム状態の可視化／正直さ | ✅ TODAY_ONLY を候補から外す（調停） |
| U3 | 食事:帯 | 「最初の法則」の帯はヘッダー直下、バッジ帯はヒーロー下＝同じ「帯」文法が2か所に散在 | 一貫性と標準（Nielsen #4） | ✅ 同じ位置・同じ文法へ統合 |
| U4 | 食事:メッセージ欄 | ✓保存でシートが閉じた直後の「保存しました。」がフィードと広告の**下**＝記録が多い日は画面外 | Nielsen #1 状態の可視化／フィードバック | ✅ フィード直上へ移動 |
| U5 | 食事:体重クイック入力 | 「体重の値を確認してください」がカードから遠いメッセージ欄に出る | ゲシュタルト近接／エラーは発生場所で（Nielsen #9） | ✅ カード内に表示（wErr） |
| U6 | ＋シート:体重の段 | 画面下端のシートに autoFocus の入力欄→**キーボードがシートごと隠す**（入力欄も「体重を記録」も見えない） | HIG 入力欄は常に見える | ✅ KeyboardAvoidingView |
| U7 | 食事:保存直後の案内 | マイ食品の登録案内／食事の制約の案内（透過Modal）が、閉じかけの pageSheet の兄弟に出る→iOSで表示されないことがある | iOS Modal 制約（兄弟Modal禁止） | ✅ `queueTip` → 入力シートの onDismiss 後（Android はタイマー） |
| U8 | 食事・運動:日付跨ぎ | 夜開いたまま翌朝戻ると表示日が昨日のまま。入力シートが「9/1(月) の記録」（アンバー）、「いま」チップ無し→**朝食が昨日の12:00で保存** | Nielsen #1／現実との一致 | ✅ `lib/rollover.ts useTodayRollover`（§3 B3） |
| U9 | ウィジェット | 過去日を表示中の残量を「今日の残り」として配信 | 正直さ | ✅ 今日を表示中のみ setDayStatus |
| U10 | 全体:文字サイズ | 9.5〜10.5px が5か所（NEWピル・ひとことのヒント・グラフ脚注・PR日付・気分ドット） | HIG 最小可読 11pt／ダイナミックタイプ | ✅ 11へ＋機械チェック |
| U11 | 全体:翻訳漏れ | t() 未包装の日本語 15 か所（相談履歴の空状態・体写真の許可/撮り直す・KPI「/ 回」「kg·回」・オンボのデモ吹き出し・ガイドのデモ回答3行・マイ食品削除確認・購入失敗・「ほかn品」「運動 {ex}」・「▴ とじる」・穴埋め概算・通知センターの動的文言） | 一貫性（英語UIに日本語混入） | ✅ すべて t()。通知センターは生成側（lib/todos.ts）で t() |
| U12 | 設定:アカウント削除 | 英語UIで placeholder どおり "Delete" と打ってもボタンが有効にならない（原文「削除」との完全一致） | Nielsen #9 行き止まり | ✅ `deleteConfirmMatches` |
| U13 | 全体:王冠 | AI_LIMITS_ENABLED=false（全機能無料）のまま課金有効ビルドを出すと王冠＝「課金すれば開く」の嘘 | 正直さ（課金導線が嘘をつかない） | ✅ `isGated` に上限フラグ・鏡の一致を jest で固定 |
| U14 | 帯・ひとことの × | accessibilityLabel 無し（VoiceOver で「×」） | アクセシビリティ（HIG） | ✅ バッジ帯・法則帯・ひとこと帯に付与（他画面は 📝） |
| U15 | 食事:フィード空状態 | 「右下の＋から1回分ずつ」と入口を明示 | 空状態のガイダンス | ✔ 問題なし |
| U16 | ＋シート:運動タイル | 運動タブへ**タブ移動**して着地（食事タブから離れる） | 期待とのズレの可能性（Nielsen #2） | 📝 設計判断（FEATURES 記載どおり）。実機で違和感が出れば「運動記録シートを食事タブ内に開く」を検討 |
| U17 | 食事:体重の入口が2つ | 体重クイック入力カード と ＋→体重 | 一貫性 | 📝 意図的（カードは⊖で隠せる） |
| U18 | 食事:AdBanner 互換シム | 新設置は `<AdSlot placement>` 直呼びの規約と食い違う | 一貫性（コード） | 📝 動作は同一。次の log.tsx 改修で AdSlot 直呼びへ |
| U19 | 全タブ:広告枠 | 位置は「閲覧領域の境目」（食事=フィード直下／運動=きょうの動き直下／相談=最上部／概要=カード境目）で記録ボタン直上には無い | 誤タップ防止 | ✔ 問題なし |
| U20 | 全体:日付境界 | todayJST 固定（海外在住 P5 は現地日付とズレる） | 正直さ | 📝 設計前提（DB の date が JST）。将来は端末TZ化を検討 |
| U21 | ＋ボタン:Android | `bottom: insets.bottom + 12` は iOS の透過タブバー前提 | Android 差分 | 📝 Android のネイティブタブは内容領域がタブバーの上で終わるため隠れない見込み。実機確認項目に追加 |
| U22 | スティッキーヘッダー | StatusBarMask と二重にならない（3タブは TabHeader が覆う・HeaderGear は marginRight 38 の席） | 一貫性 | ✔ 問題なし |
| U23 | 筋トレ記録画面:Modal | SetDial／RestDial／PlateCalc／LiftPicker は同時に開かない（1つが画面を覆う） | iOS Modal 制約 | ✔ 問題なし |
| U24 | 運動タブ:＋シート「運動」着地 | `ts` ノンスで同じ選択を続けても開き直す | 発見性 | ✔ 問題なし |
| U25 | 食事:ヒーロー「目標を調整 ›」 | 12px・アクセント色。発見性の補助として妥当 | — | ✔ 問題なし |

---

## 3. バグ・不具合（原因／修正／再発防止テスト）

### 静的走査（tsc --noUnusedLocals・grep・自作スキャナ）

| # | 箇所 | 問題 | 修正 | 再発防止 |
|---|---|---|---|---|
| B1 | components/{themed-text,themed-view,hint-row,ui/collapsible,app-tabs.web,external-link,animated-icon.web,animated-icon.module.css,Placeholder}, constants/theme.ts, hooks/{use-theme,use-color-scheme,use-color-scheme.web}, global.css | Expo テンプレート残骸14ファイル。どこからも到達せず themed() 規約にも乗っていない | 削除 | uiConvention.test「テンプレ残骸が復活していない」 |
| B2 | changes.tsx GoalPanel／log.tsx PFC_SHORT・analyzing／onboarding.tsx ActivityIndicator・AsyncStorage／BarcodeScanner Pressable／ComebackSheet・GuideTour AsyncStorage／SpotlightTip t | 未使用 import・未使用 state | 除去 | `npx tsc --noEmit --noUnusedLocals --noUnusedParameters`（node_modules の2件と `hadComeback(_, today)`・`lawLinkForAlert(alert,…)` の未使用引数は公開シグネチャのため残置）※tsconfig に恒久化すると node_modules 内 .tsx で落ちるため手順として docs に残す |
| B3 | log.tsx / training.tsx viewDate | **日付跨ぎ**: 表示日が「昨日」に取り残される（U8） | `useTodayRollover`（フォーカス時・前景復帰時に `rolloverDate`） | rollover.test（4件）＋uiConvention「食事・運動タブは useTodayRollover を持つ」「viewDate === todayJST() を直接書かない」 |
| B4 | log.tsx setDayStatus | 依存配列なしで毎レンダー実行・過去日表示中の数字を「今日」として配信 | 依存配列＋ `viewDate === todayKey` ガード | uiConvention（todayKey 統一） |
| B5 | log.tsx その日1回系の effect（過食リスク・ひとこと・穴埋め・気分の既読） | `[]`／`[profile]` 依存で日付が変わっても組み直されない | `todayKey` を依存に追加 | 同上 |
| B6 | 15か所の t() 未包装（U11） | 英語UIに日本語 | t() 化＋translate-loop で10言語へ追記（未登録0件） | uiConvention「lib/todos.ts の title/detail は t()」＋ `scripts/i18n-keys.js` |
| B7 | 5か所の fontSize < 11（U10） | 最小可読未満 | 11 | uiConvention「fontSize は 11 以上」 |
| B8 | settings.tsx confirmDelete | 英語UIで確認語が通らない（U12） | `guard.ts deleteConfirmMatches` | guard.test（3件）＋uiConvention「原文比較を画面に書かない」 |
| B9 | gate.ts gated() | 上限未点火でも王冠（U13） | `isGated(active, unlimited, plan, AI_LIMITS_ENABLED)`・native/src/lib/calc.ts に鏡の定数 | gate.test（5件・サーバー lib/calc.ts と値の一致を読んで固定） |
| B10 | lib/todos.ts | テンプレート文字列の動的文言を消費側 `t(todo.title)` で訳そうとしていた（キーにならず永久に日本語） | 生成側で t() ＋ プレースホルダ | uiConvention |
| B11 | lib/feed.ts logTitle | 「ほか{n}品」「運動 {ex}」が日本語固定（フィード・削除確認Alertに出る） | t() | i18n-keys |
| B12 | lib/purchases.ts | 購入失敗の既定文言が日本語固定（paywall の Alert に出る） | t() | i18n-keys |

### 動的（机上）追跡

| # | シナリオ | 結果 | 対処 |
|---|---|---|---|
| D1 | JST 日付跨ぎ（P1 が 23:50 に開いて 0:10 に保存） | ✗ 表示日が昨日のまま・朝食が昨日12:00（B3） | ✅ |
| D2 | 過去日表示中の保存 | ✔ 「いま」を出さず既定12:00・`buildAtJST(viewDate)`・シート見出しがアンバー。ただし「今日は〜」カードが出る（U2） | ✅ 調停 |
| D3 | オフライン | ✔ 筋トレ・運動はオフラインキュー／食事解析はジョブ永続化＋失敗行（再試行/破棄）／マイ食品セット削除失敗は文言。my_meals 等のテーブル未作成は空扱い | ✔ |
| D4 | HealthKit null（Watch無し・Android・Expo Go） | ✔ `resolveBurnKcal({measured:null})` → 歩数推定 → 記録のみ。`healthAvailable()` false で全 no-op | ✔ |
| D5 | migration-24〜31 未適用 | ✔ my_meals（24）・diet 3列（26）・feedback（29）・my_foods.items（31・PGRST204 で内訳を落として再登録）・vitals・cycle_logs はいずれも読み失敗＝空／保存失敗＝文言 | ✔ |
| D6 | 翻訳未登録 | ✔ `t()` は原文フォールバック。未登録は 0 件に | ✅ |
| D7 | 王冠ゲート | ✗ 上限未点火で王冠（B9）。広告は「広告なし」が本当の差なので独立に点灯 | ✅ |
| D8 | ＋シートと入力シートの重なり（iOS 兄弟Modal） | ✔ PlusSheet は閉じ切ってから onAction（onDismiss／タイマー・二重発火は ref）。✗ 保存直後のスポットライトは閉じかけの pageSheet の兄弟（U7） | ✅ queueTip |
| D9 | スティッキーヘッダーと StatusBarMask | ✔ 食事・運動・概要の一覧は TabHeader が insets.top を覆い StatusBarMask を置かない。概要の詳細だけ従来の StatusBarMask | ✔ |
| D10 | ＋シート「体重」でキーボード | ✗ シートがキーボードの下（U6） | ✅ KAV |
| D11 | 保存直後のフィードバック | ✗ 「保存しました。」が画面外（U4） | ✅ 位置変更 |
| D12 | ダーク／新パレット | ✔ 生HEXは PlusSheet の暗幕（理由コメント付き例外）と塗り面上の '#fff' のみ。themeConvention.test が守る | ✔ |
| D13 | 通知量 | ✔ 朝の気づき通知は smart のときだけ1日1件・caution のみ・3日連続で休む。記録リマインダー3モード | ✔ |

---

## 4. カード調停の設計（`native/src/lib/logCards.ts`）

- **入力**: `{ isToday, candidates: { caution, backfill, checklist, mood, positive(n), badge, firstLaw, brief } }`（各画面部品は「出したいか」だけを申告）
- **出力**: 各キーの許可枚数。画面は `attention.mood > 0` のように読むだけ
- **上限**: カード（面のあるブロック）最大 **2**、帯（1行）最大 **2** → ヒーロー直下の追加ブロックは最大4（以前は最大11）
- **優先順位**: カード `caution`（今日の準備に直結）> `backfill`（放置すると収支がズレる）> `checklist`（新規14日の道しるべ）> `mood` > `positive`（無くても困らない）／帯 `badge` > `firstLaw` > `brief`
- **過去日**: `TODAY_ONLY = {caution, backfill, mood, positive, brief}` は候補から外す。バッジ・最初の法則・チェックリストは日付に依存しないので出る
- **対象外**: ヒーロー・週と月の収支・今日の記録・前の食事・体重入力・広告枠（構造カード。⊖/⊕で本人が管理、または位置固定）。スポットライト（Modal）は保存直後に1枚・排他
- **StartChecklist**: 判定（14日以内・未完了・6項目）は子が続け、`onVisible` で候補を申告・`suppressed` で枠が無い回は描かない
- **テスト**: logCards.test（8件: 上限・優先順位・過去日・不正値・優先表の網羅）＋ uiConvention「log.tsx の各条件が attention.* を参照」

---

## 5. 再発防止一覧

| 仕組み | 守るもの |
|---|---|
| `__tests__/uiConvention.test.ts`（新設） | fontSize ≥ 11（ShareSticker 例外）／テンプレ残骸14ファイルの復活禁止／ヒーロー直下は attention.* を通す／食事・運動は useTodayRollover／`viewDate === todayJST()` 直書き禁止／削除確認語は deleteConfirmMatches／保存直後の案内は queueTip・onDismiss／PlusSheet に KAV／lib/todos.ts は生成側 t() |
| `lib/__tests__/logCards.test.ts`（新設・8件） | 調停の上限・優先順位・過去日除外 |
| `lib/__tests__/rollover.test.ts`（新設・4件） | 日付跨ぎの規則 |
| `lib/__tests__/gate.test.ts`（新設・5件） | 王冠の条件＋ AI_LIMITS_ENABLED のサーバー/アプリ一致 |
| `lib/__tests__/guard.test.ts`（追記・3件） | 削除確認語 |
| `scripts/i18n-keys.js`（既存） | 未登録キー 0 件 |
| `__tests__/themeConvention.test.ts`（既存） | themed()・トークン色 |
| 手順（docs）: `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` を提出前に1回 | 未使用 import／変数 |

---

## 6. 未対応と理由

| 項目 | 理由・次の一手 |
|---|---|
| U16 ＋→運動がタブ移動する | 設計判断（FEATURES 記載）。実機βで違和感が出たら食事タブ内に運動記録シートを開く案へ |
| U17 体重の入口が2つ | 意図的（カードは⊖で隠せる） |
| U18 AdBanner 互換シム | 動作同一。次の log.tsx 改修で `<AdSlot placement="log" />` 直呼びに置換 |
| U20 JST 固定 | DB の `date` が JST 前提。端末TZ化はデータ移行を伴うので 1.1 では触らない |
| U21 Android の＋ボタン位置 | Android ネイティブタブは内容領域がタブバー上で終わるため隠れない見込み。**実機確認項目**に追加（docs/ANDROID.md 手順で内部テスト時に確認） |
| U14 他画面の × の accessibilityLabel | 今回は食事タブの帯3種のみ。全数スイープは別ブランチ（対象: トレイ×・サムネ×・ColumnReader 等） |
| B2 `hadComeback(_, today)`・`lawLinkForAlert(alert, …)` の未使用引数 | 公開シグネチャ・既存テストの呼び出しがあるため残置 |
| tsconfig への `noUnusedLocals` 恒久化 | node_modules 直下の .tsx（react-native-view-shot）が include に入り落ちるため、手順として運用 |
| translate-loop の訳文の目視 | 32件×10言語を機械追記（プレースホルダ壊れは自動で不採用）。英語UIの実機確認を提出前に |

---

## 7. 変更ファイル（要約）

- 削除14: `native/src/components/{themed-text,themed-view,hint-row,ui/collapsible,app-tabs.web,external-link,animated-icon.web,animated-icon.module.css,Placeholder}`, `constants/theme.ts`, `hooks/{use-theme,use-color-scheme,use-color-scheme.web}`, `global.css`
- 新規: `lib/logCards.ts`, `lib/rollover.ts`, `__tests__/uiConvention.test.ts`, `lib/__tests__/{logCards,rollover,gate}.test.ts`
- 変更: `app/(tabs)/log.tsx`（調停・日付跨ぎ・msg位置・queueTip・setDayStatus）, `app/(tabs)/training.tsx`（日付跨ぎ）, `components/{PlusSheet,StartChecklist,DailyBrief,GuideTour,ColumnReader,InteractiveChart,LiftingProgress,MoodFace,BodyPhotosCard,OnboardingIntro,NotificationCenter,BarcodeScanner,ComebackSheet,SpotlightTip}.tsx`, `app/{settings,onboarding}.tsx`, `app/(tabs)/{changes,coach}.tsx`, `lib/{gate,guard,calc,feed,todos,purchases}.ts`, `content/i18n/*.ts`（10言語）, `docs/FEATURES.md`
