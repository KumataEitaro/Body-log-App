// デザイントークン。テーマ変更で「アクセントだけ」でなく、背景・枠線・文字・面の色まで
// まとめて差し替わるよう、全色をこのオブジェクトに集約している。
import { Platform, StatusBar, StyleSheet } from 'react-native';
import type { ImageStyle, TextStyle, ViewStyle } from 'react-native';

/** シート（pageSheetモーダル）の上端パディング。
 *  iOS: pageSheetはOSが上を空けるので素の値をそのまま返す＝iOSの見た目は完全に不変。
 *  Android: presentationStyleは無視されて全画面になり、さらにSDK 57はエッジツーエッジ既定で
 *  コンテンツがステータスバーの下に潜るため、時計とヘッダーが重ならないよう高さを足す。 */
export function sheetTopPad(base: number): number {
  return Platform.OS === 'android' ? base + (StatusBar.currentHeight ?? 24) : base;
}

// ===== 寸法のトークン（2026-09-02 統一） =====
// 新アイコン（水色地・白い皿）に合わせてUIを見直したとき、同じ役割の寸法が画面ごとに
// 違っていることが分かった（カードの角丸 16/18/20、カード余白 14/16/18、
// 画面タイトル 26/600・26/800・21/800、アイコン 12/13/15/16/17/18/19 の混在）。
//
// **数値は現状の多数派をそのまま採っている**。目的は今後のばらつきを止めることで、
// 見た目を作り変えることではない（少数派だけを多数派へ寄せる＝アプリの印象は保つ）。
// 新しい画面・部品は必ずこのトークンから選ぶ。無い寸法が要るときは、まずここへ足す。

/** 角丸。役割ごとに1つだけ持つ（円・バー・サムネの幾何的な角丸は各所の実数のまま） */
export const RADIUS = {
  card: 20,   // 画面直下の大カード（食事・運動・概要のcardが20）
  panel: 16,  // カード内のパネル・行タイル・吹き出し
  tile: 14,   // 情報ボックス・帯・トレイ・大きめのボタン
  input: 12,  // 入力欄・小さなバナー
  chip: 999,  // チップ・ピル・丸ボタン（全体で最多の値）
} as const;

/** 余白。画面のスクロール余白は全画面で16で例外が無かったので、それを正とする */
export const SPACE = {
  screen: 16, // 画面のスクロール余白
  card: 16,   // カードの内側余白（padding全体でも16が最多）
} as const;

/** lucideアイコンの寸法。既存の役割ぶんの段を残している（1段に潰すと印象が変わる） */
export const ICON = {
  xs: 13,        // 注記・警告行の中の小さな印
  sm: 15,        // チップや行内の補助
  md: 16,        // 標準（本文行・カード見出し・ドックの補助）
  lg: 18,        // シート見出し・一覧の矢印
  xl: 19,        // 設定の行頭・入力欄のシェブロン
  hero: 22,      // 空状態・お祝いの見せ場
  stroke: 2.5,   // 既定の線幅
  strokeBold: 3, // 塗り面の上に載る白いアイコン
} as const;

/** 見出しの段。fontWeightはTextStyleに渡せる文字列リテラルとして固定する */
export const HEAD = {
  page: { fontSize: 26, fontWeight: '600' },      // 画面タイトル（食事・運動・相談・概要が26/600）
  section: { fontSize: 21, fontWeight: '800' },   // 画面内の節
  sub: { fontSize: 18, fontWeight: '800' },       // 節の中の小見出し
  card: { fontSize: 17, fontWeight: '800' },      // カードの見出し（h2相当）
} as const;

// ===== 色のトークン（2026-09-02 新アイコンに合わせて刷新） =====
//
// 新アイコン（アクア地 #C8FAFB・白い皿・鮮やかな食材）に合わせ、配色の基準を次の10色に置いた。
//   Dark Navy   #0B1220  ダークの地(bg) ／ ライトの文字色(ink)
//   Card Gray   #111827  ダークのカード面(panel)。Navyと近いが「地」と「面」の2階調として必要なペア
//   Electric    #4D7CFF  新アクセント（塗り面・選択）。白地の小さい文字には使わない（3.7:1でAA未達）
//   Electric Ink #2F5FE6 白地の文字・リンク用に一段濃くしたアクセント（5.4:1）
//   Aqua        #C7F5F6  背景トーン「アクア」＋ヒーロー等の強調面（全面の地には使わない）
//   Leaf Green  #34B36A  達成・成功
//   Citrus      #FFA62B  注意
//   Berry       #E43D5B  超過・警告
//   Clean White #FFFFFF  ライトのカード面
//   Soft Gray   #A2AAB3  ヒント文字(faint)だけ。補助文字(sub)は #6B7580（A2AAB3は白地で2.4:1と薄すぎる）
//
// 【トークンの使い分け規約】
//   - 塗り面・選択の印・枡の枠線 → teal（アクセント。歴史的なキー名だが実体はテーマ色）
//   - 白いカードや地の上に載る**文字・リンク** → accentInk（AAを満たすまで自動で濃くした派生。lib/contrast.ts）
//   - アクセント塗り面の上の白文字 → '#fff' のまま（追従してはいけない固定色。理由コメント付き）
//   - 達成・成功の文字 → successInk、達成の塗り（バー・ドット） → success
//   - 注意の文字・枠 → amber（Citrusを3:1まで濃くした値。原色 #FFA62B は白地で2:1しかなく文字に使えない）
//   - 超過・警告 → coral（Berry。白地で4.1:1。文字は太字で使う）
//   - 面(panel)と地(bg)以外に生のHEXを書かない。色は必ずこのトークン経由
export type Palette = {
  bg: string;           // 画面の背景
  panel: string;        // カードの面
  ink: string;          // 主要な文字
  sub: string;          // 補助文字（白地で4.5:1以上を保つ）
  faint: string;        // 最も薄い文字（ヒント・プレースホルダ専用。本文には使わない）
  line: string;         // 罫線・枠線
  teal: string;         // アクセント（歴史的な名前。実体はテーマ色）。塗り面・選択の印に使う
  accentInk: string;    // 白地・カード面の上の文字とリンク用アクセント。AA(4.5:1)を満たすまで濃くした派生値
  accentHi: string;     // アクセントの明るい端（グラデーション #4D7CFF→#6AA3FF のプレミアム縁・ヒーロー強調）
  tealWeak: string;     // アクセントの薄い面
  accentSoft: string;   // 強調カードの背景（アクセントのごく薄い面）
  accentBadge: string;  // バッジ・選択中セルの背景
  accentBorder: string; // アクセント寄りの枠線
  aqua: string;         // ヒーロー等の強調面（アイコンの地の色）。全面の背景には使わない
  track: string;        // プログレスバーの溝
  chipBg: string;       // チップ・未選択面
  segTrack: string;     // セグメントコントロールの溝
  pressed: string;      // 押下時の面
  calorieBar: string;   // 合計カロリーのバー（P/F/Cとは必ず別色にする）
  hairline: string;     // カード外周のごく薄い縁取り（面とほぼ同色の1px）
  shadow: string;       // 影の色（shadowColor専用。明暗で濃さの効き方が違う）
  success: string;      // 達成・成功の塗り（Leaf Green）
  successInk: string;   // 達成・成功の文字（白地でAAを満たすまで濃くした派生値）
  successWeak: string;  // 達成の薄い面
  coral: string;        // 超過・警告（Berry Red）
  coralWeak: string;    // 超過の薄い面
  amber: string;        // 注意（Citrus。文字にも使うため白地で3:1を満たす濃さ）
};

// 既定は「エレクトリック」ライト（新アイコンの配色）。実行時は theme.ts の applyPalette で差し替わる。
// 値は theme.ts の PALETTES.electric（白背景トーン）と一致させる
export const C: Palette = {
  bg: '#fbfbfa',
  panel: '#ffffff',
  ink: '#0b1220',
  sub: '#6b7580',
  faint: '#a2aab3',
  line: '#eff3ff',
  teal: '#4d7cff',
  accentInk: '#2f5fe6',
  accentHi: '#6aa3ff',
  tealWeak: '#eaefff',
  accentSoft: '#f6f8ff',
  accentBadge: '#edf2ff',
  accentBorder: 'rgba(77,124,255,0.3)',
  aqua: '#c7f5f6',
  track: '#f1f5ff',
  chipBg: '#f7f9ff',
  segTrack: '#f3f6ff',
  pressed: '#f4f7ff',
  calorieBar: '#3b4a63',
  hairline: 'rgba(14,17,22,0.08)',  // 8%の近黒はNavy由来でも旧ink由来でも見分けがつかないため値を据え置く（既存テストとも整合）
  shadow: '#0b1220',
  success: '#34b36a',
  successInk: '#278650',
  successWeak: '#e7f6ed',
  coral: '#e43d5b',
  coralWeak: '#fce8eb',
  amber: '#cc8522',
};

/** '#rrggbb' を 'rgba(r,g,b,a)' に変換（テーマ色から透過色を作るため） */
export function rgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ===== テーマに追従するスタイル定義 =====
//
// 【なぜこの形なのか】2026-09-02 の「まだらバグ」の根治
//
// 以前は StyleSheet.create にモンキーパッチを当てて生成物を控えておき、テーマ変更時に
// 「旧い色文字列 → 新しい色文字列」を全スタイルに遡って置換していた。値ベースの置換には
// 構造的な欠陥が4つあり、これが「画面の一部だけ色が変わる／触ると一部だけ白くなる」の正体だった。
//
//   1) **同じ値を持つ別トークンを区別できない**。たとえばライトの panel は '#ffffff' で、
//      白文字として書かれた '#ffffff' と見分けがつかない。ダークへ切り替えると
//      「白文字のはずの箇所」までカード面の暗色へ置換され、逆に3桁の '#fff' は
//      対応表に載らず置換されない。**置換される要素と、されない要素が同じ画面に混在する**。
//   2) **加工された色が対応表に載らない**。`rgba(C.teal, 0.3)` のように計算で作った色は
//      パレットのどのトークンとも文字列一致しないため、永久に旧テーマのまま残る。
//   3) **後から初めて評価されるモジュールを取りこぼす**。expo-routerは画面を遅延読込するため、
//      テーマ変更後に初めて開いた画面の StyleSheet.create は applyPalette が走り終わった後に
//      実行される。控えるだけの実装では、その回の差分が当たらない経路が残る。
//   4) **オブジェクトを「中身だけ」書き換えても画面に届かない**。Reactはstyleプロパティを
//      参照の同一性で差分判定するため、同じオブジェクトを破壊的に書き換えても
//      「変化なし」と見なされ、ネイティブビューへ新しい色が送られない。既にマウント済みの
//      要素は旧色のまま残り、再マウントされた要素だけが新色になる＝まだら。
//
// 【新方式】色の置換をやめ、**テーマが変わったらスタイルを作り直す**。
// 定義を「オブジェクト」ではなく「オブジェクトを作る関数（factory）」で受け取り、
// テーマ世代（generation）が変わったら factory を再実行して**新しいオブジェクト**を作る。
//   - factory は毎回その時点の C を読むので、`rgba(C.teal, .3)` も派生値も正しく追従する（2の解決）
//   - 遅れて初めて評価されたシートも、生成時点の最新テーマで作られる（3の解決）
//   - トークン名で解決するので値の衝突が起きない（1の解決）
//   - 世代が変わると**参照が変わる**ので、Reactが差分を検知してネイティブへ色が届く（4の解決）
//
// 返すのはProxyで、プロパティを読んだ瞬間に世代を確認して必要なら作り直す（遅延生成）。
// 開いていない画面のスタイルを作り直す無駄がなく、モジュールスコープに
// `const s = themed(() => ({ ... }))` と書けるので既存の書き方をほぼ変えずに済む。
//
// 【書き方の規約】スタイル定義は必ず `themed(() => ({ ... }))` で書くこと。
// StyleSheet.create の直接使用は禁止（このファイル以外での使用はテストで落とす）。

// RN本体の StyleSheet.create と同じ形の制約。これがないと 'row' などのリテラル型が
// string へ広がってしまい ViewStyle に代入できなくなる（＝全画面で型エラーになる）
type NamedStyles<T> = { [P in keyof T]: ViewStyle | TextStyle | ImageStyle };

// テーマの世代番号。applyPalette のたびに増える
let generation = 0;

/** 現在のテーマ世代。Reactツリーの再マウントキーやテストで使う */
export function themeGeneration(): number { return generation; }

/**
 * テーマに追従するスタイルシートを定義する。
 * 使い方: `const s = themed(() => ({ card: { backgroundColor: C.panel } }));`
 * factoryはテーマが変わった後の最初のアクセスで再実行される（＝常に現在の色になる）。
 */
export function themed<T extends NamedStyles<T> | NamedStyles<Record<string, unknown>>>(
  factory: () => T & NamedStyles<Record<string, unknown>>,
): T {
  let gen = -1;
  let sheet = {} as T;
  // 現在の世代のスタイルを返す。世代が変わっていれば作り直す（遅延生成）
  const live = (): Record<string | symbol, unknown> => {
    if (gen !== generation) {
      sheet = StyleSheet.create(factory());
      gen = generation;
    }
    return sheet as Record<string | symbol, unknown>;
  };
  return new Proxy({} as T, {
    get: (_t, key) => live()[key],
    has: (_t, key) => key in live(),
    ownKeys: () => Reflect.ownKeys(live()),
    // ownKeys を返す以上、対応する記述子も返さないとProxyの不変条件で例外になる。
    // ターゲットは空オブジェクトなので configurable: true を必ず立てる
    getOwnPropertyDescriptor: (_t, key) => {
      const d = Object.getOwnPropertyDescriptor(live(), key);
      return d ? { ...d, configurable: true } : undefined;
    },
  });
}

/**
 * パレットを丸ごと差し替える。
 * C を書き換えてから世代を進めるだけ。既存スタイルは次に読まれた時点で作り直される。
 * （画面へ届けるにはコンポーネントの再描画が要る。各ルートが useThemeRefresh()（lib/theme.ts）で
 *   世代を購読して再描画するので、切替直後の1フレームで揃う。以前の「Stack を key で再マウント」は
 *   開いている Modal まで作り直して iOS で古いモーダルが残ったため 2026-09-04 に廃止）
 */
export function applyPalette(next: Palette): void {
  // 実際に変化があるときだけ世代を進める（無駄な再生成を避ける）
  const changed = (Object.keys(next) as (keyof Palette)[]).some((k) => C[k] !== next[k]);
  if (!changed) return;
  Object.assign(C, next);
  generation += 1;
}
