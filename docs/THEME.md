# テーマ（配色）の仕組みと、5回再発した「まだら」の決着

> 熊田さん（2026-09-17・スクリーンショット）
> 「何がおかしいかわかる? 色だよね。しかも概要は問題ない。運動タブは問題ある。」

運動タブのヘッダーが白いまま、「きょうの動き」カードは**白い背景に白い見出し**、
中の箱だけ暗い ——**1枚のカードの中で2つのパレットが同居**していた。

---

## 1. 結論（真因）

**React Compiler が `themeGeneration()` を「一度だけ計算する定数」に畳んでいた。**

`app.json` の `experiments.reactCompiler: true` により、実機は React Compiler で
変換されたコードを動かしていた。コンパイルされた `TabHeader` はこうなる:

```js
var t1;
if ($[1] === Symbol.for("react.memo_cache_sentinel")) { t1 = themeGeneration(); $[1] = t1; }
else { t1 = $[1]; }          // ← 2回目以降は初回の値を返すだけ
var gen = t1;
```

`themeGeneration()` は引数もリアクティブな依存も無い呼び出しなので、コンパイラは
「毎回同じ値」と判断してキャッシュする。**これは不具合ではなく仕様**で、
React Compiler は「モジュールスコープの値はレンダー中に変わらない」ことを前提にしている。
このアプリはその前提を破っていた（`C` を書き換えて `generation` を進める方式）。

結果、テーマの防御が3層とも死んでいた:

| 層 | 仕組み | コンパイラ下での実際 |
| --- | --- | --- |
| 1 | 各画面が `useThemeRefresh()` で再描画 | 再描画はされるが、JSX もスタイル読み取りも**メモ化から出てこない** |
| 2 | `TabHeader` の `key={theme-${gen}}` | `gen` が固定 → **一度も作り直されない** |
| 3 | `ThemeRemount`（壁）の `key={theme-${gen}}` | 同上。**壁が一度も立たない** |

### なぜ「混ざる」のか

コンパイラのメモ化は**JSXの塊ごと**に別のキャッシュ枠を持つ。
依存（props・state）が変わった枠だけが作り直され、変わらない枠は初回の色のまま残る。
起動直後はまだ `loadTheme()`（AsyncStorage・非同期）が終わっておらず**ライト**なので、
「初回の色＝ライト」が凍り、あとからデータが届いて作り直された枠だけダークになる。
概要タブが無事だったのは、データで作り直される枠が多かったから。

### なぜテストで捕まらなかったのか

**jest-expo が babel へ渡す caller に `supportsReactCompiler` が無い。**
つまり ——

> テストは、実機に載るのとは**別のプログラム**を検証していた。

`tabHeader.test.tsx` / `themeRemount.test.tsx` / `themeRender.test.tsx` は
素の変換では合格する。3回ぶんの再発防止テストが、全部その穴を通り抜けていた。

---

## 2. やったこと

### ① 変換をひとつにした（これが本丸）

`native/jest.config.js` を新設し、**app.json を読んで babel の caller を決める**。
package.json の `jest` キーは廃止。以後どちらへ倒しても食い違わない。

```js
const appUsesReactCompiler = app.expo?.experiments?.reactCompiler === true;
caller: { ...options.caller, supportsReactCompiler }
```

### ② React Compiler を無効にした

`app.json` → `experiments.reactCompiler: false`。

**判断の理由**: このアプリのスタイルは「モジュールスコープの可変オブジェクト `C`」を土台に
84ファイル・約200コンポーネントが組み上がっている。これは React Compiler の前提と
**構造的に両立しない**。片方を選ぶしかなく、正しさを選んだ。
（`npm run test:rc` で強制的に有効化して走らせると、色だけでなく
**食事タブと相談タブがそもそもマウントできない**ことも分かった。）

### ③ それでも壁が立つようにした（将来コンパイラを戻す布石）

`lib/ui.ts` に **フック**を追加し、`TabHeader` / `ThemeRemount` を移した。

| API | 用途 |
| --- | --- |
| `useThemeGeneration()` | 世代を**購読して**返す。フックの戻り値はリアクティブなので、コンパイラも畳めない |
| `useThemedSheet(SHEET)` | `themed()` のシートを世代連動の**別参照**にして返す |
| `themeGeneration()` | React の外専用。`.tsx` からの呼び出しはテストで禁止 |

> ⚠️ ここで1つ踏んだ罠: `useMemo(() => ({...sheet}), [sheet, gen])` と書いたら、
> **コンパイラが「中で使っていない gen」を依存から削除した**。人工的な依存では騙せない。
> `spreadForGeneration(sheet, gen)` のように**引数として本当に使う**こと。

### ④ Modal を持つ部品 30個に購読を足した

Modal は壁（ThemeRemount）の**外**に出る仕様（作り直すと iOS で古いモーダルが残るため）。
つまり壁に守ってもらえないのに、**どれも自分では購読しておらず**、親が再描画してくれることに
賭けていた。実際 `GuideTour` のウェルカムは古い色のまま残っていた。全部に
`useThemeRefresh()` を入れた。

---

## 3. 再発防止（機械で見張るもの）

| 検査 | 何を守るか |
| --- | --- |
| **`__tests__/themePalette.test.tsx`** | **症状そのもの**。11画面を描画して明暗を反転し、前のパレットの色が1つでも残っていたら落ちる。手口（memo・Animated・コンパイラ・将来の何か）を問わない |
| `__tests__/themeTransform.test.ts` | テストの変換が app.json と一致していること。コンパイラを戻すなら全ファイルが `useThemedSheet` 経由であること |
| `__tests__/themeSafety.test.ts` | Modal を出す部品は自分で購読する／`.tsx` から素の `themeGeneration()` を呼ばない／壁が4タブにある／memo・FlatList の抜け道 |
| `__tests__/themeConvention.test.ts` | `themed(() => ...)` の書き方・`StyleSheet.create` 禁止・ハードコード色の禁止 |
| `.github/workflows/native-check.yml` | 上の検査が**必ず実行される**こと（それまで CI では走っていなかった） |

`themePalette.test.tsx` は失敗時に「どの色が・どの要素に残ったか」を出す:

```
"#111827": ["Modal>View>View>View.backgroundColor", "View>View>View>Text(\"ガイドを始める\").color"]
```

---

## 4. 書くときの規約

1. スタイルは `themed(() => ({ ... }))`。`StyleSheet.create` は `lib/ui.ts` 以外で禁止。
2. 画面（ルート）は先頭で `useThemeRefresh()`。
3. **`<Modal>` を出す部品は、自分で `useThemeRefresh()` を呼ぶ**（壁の外なので）。
4. 4タブのスクロール本体は `ThemeRemount` で包む。Modal・シート・FAB は壁の外。
5. `.tsx` から `themeGeneration()` を直接呼ばない。`useThemeGeneration()` を使う。
6. 色は必ず `C` のトークンから。生の HEX は `lib/ui.ts` と `lib/theme.ts` だけ。

## 5. React Compiler を戻したくなったら

1. `npm run test:rc` を走らせる（強制的に有効化したテスト）。
2. 落ちたところが「コンパイラの前提を破っている場所」そのもの。
3. 全コンポーネントの `const s = themed(...)` 直読みを `useThemedSheet(SHEET)` へ移し、
   インラインの `C.xxx` もフック由来の値にする（84ファイル規模）。
4. `test:rc` が緑になってから `app.json` を `true` に戻す。
   戻した瞬間に通常の `npm test` も同じ変換になる＝もう食い違わない。
