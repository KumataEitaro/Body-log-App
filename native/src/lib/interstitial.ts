// インタースティシャル広告（全画面）の「出す／出さない」の純関数。
//
// 背景（2026-09-04）: 概要タブのメニュー行から詳細（自分の体の記録など）へドリルダウンする
// 瞬間に、全画面広告を1枚はさむ。バナーは「そこにあるだけ」で eCPM が低く、無料プランの
// 収益がほぼ立たない一方、全画面広告は単価が桁で違う。ただし全画面は体験を殴る力も強いので、
// **出す条件をここに全部集め、jest で式を固定する**（画面側は結果に従うだけ）。
//
// ここに書いた条件は「AdMob のポリシー」と「アプリへの信頼」の両方から来ている:
//  - AdMob は「予期しない全画面広告」「操作を邪魔する広告」をポリシー違反として扱う。
//    ドリルダウン＝ユーザーが自分で次の画面へ進む区切り（natural transition point）なので、
//    Google 自身が推奨する挿入位置に当たる（逆に「起動直後」「戻るボタンの直後」は禁止例）
//  - 頻度は「同一セッション1回・前回から10分・1日3回」の三重の上限。どれか1つでも足りない
//    設計にすると、概要タブを行き来する人（＝アプリをよく使う人＝いちばん失いたくない人）に
//    連続で全画面が出る。よく使う人ほど広告が増える、を仕組みで禁止する
//  - 起動から30秒は出さない。起動直後の全画面はレビューで頻出のリジェクト理由で、
//    かつユーザー体験としても「開いた瞬間に広告」はアンインストールに直結する
//
// **絶対にやらないこと**（コード上の担保は lib/interstitialAd.ts と changes.tsx 側）:
//  1. 遷移をブロックして広告のロードを待たせない（事前ロード済みのときだけ出す。
//     遷移は必ず先に進む＝広告が無ければ何も起きなかったのと同じ）
//  2. 記録・保存・課金（ペイウォール遷移）の直後には出さない
//  3. 重要な読み物・手続きの前には出さない（法則の解説記事・受診用PDF・アカウント削除・
//     栄養ランキング図鑑など）。INTERSTITIAL_TARGETS で明示的に外す
//  4. 閉じるボタンが出る前に裏で何かを進めない（遷移は広告の前に完了しているので、
//     閉じたときにはもう目的の画面が下にある）
import { jstYmd } from './jst';
import { shouldShowAd } from './ads';

/** AsyncStorage のキー（`{date, count, lastMs}` の1レコード） */
export const INTERSTITIAL_STORE_KEY = 'bl-interstitial';

/** 前回表示からの最低間隔（10分）。概要タブを行き来しても連続で出ない */
export const INTERSTITIAL_MIN_GAP_MS = 10 * 60 * 1000;

/** 1日の上限（JST日付でリセット）。1日3回まで */
export const INTERSTITIAL_MAX_PER_DAY = 3;

/** アプリ起動からこの時間は出さない（30秒）。起動直後の全画面は審査でもUXでも禁じ手 */
export const INTERSTITIAL_WARMUP_MS = 30 * 1000;

/**
 * 概要タブのどのドリルダウンで全画面広告を出すか（1か所の定数表）。
 *
 * 線引きの理由 — 「その画面を開く動機が、広告1枚をはさんでも損なわれないか」で決めている。
 * 数字のふりかえり（自分の記録を眺めに行く）は、途中に広告が入っても目的が変わらない。
 * 一方、医療・機微・読み物は「いま読みたい／いま見せたい」が目的そのものなので、
 * 広告をはさむと機能の価値を壊す（＝課金してほしい機能の印象まで下げる）。
 *
 * - body（体の記録）: 出す。体重・グラフ・表の振り返り。最も開かれる行で、収益の主戦場
 * - volume（運動の量）: 出す。週の運動量の振り返り。開く動機は「眺める」
 * - strength（筋トレの成長）: 出す。自己ベスト・挙上重量の推移。同上
 * - week（週のふりかえり）: 出す。週1回の振り返り画面。頻度が低いので体験を壊しにくい
 * - eating（食べ方の分析）: 出さない。過食の引き金カードを含む＝「なぜ食べすぎたか」を
 *   見に来る人の心理状態に全画面広告をぶつけない（L4=優しさ）
 * - vitals（バイタル）: 出さない。血圧・体温など医療的文脈。健康の数字を見る前に広告は不適切
 * - cycle（生理周期）: 出さない。機微情報。開くこと自体がプライベートな行為
 * - photos（体の写真）: 出さない。機微情報＋撮影フロー（＝操作の途中）に入る導線でもある
 * - nutrients（栄養ランキング）: 出さない。図鑑＝読み物。laws と同じ扱い
 * - laws（あなたの法則）: 出さない。法則の解説記事＝読み物（明示的に false で意思を残す）
 * - health（歩数・睡眠）: 出さない。HealthKit 連携の許諾ダイアログが出ることがあり、
 *   全画面広告と重なると何を許諾しているのか分からなくなる
 * - bulkguard / cycles: 出さない。表示条件が限定的（増量中・2サイクル以上）で母数が小さく、
 *   出しても収益にならないのに「見るたびに広告」の印象だけが残る
 *
 * 未知のキー（将来追加する行）は既定で **出さない**（isInterstitialTarget が false を返す）。
 * 新しい行に広告を出したいときは、ここに明示的に true を書く＝意思を持って足す。
 */
export const INTERSTITIAL_TARGETS: Readonly<Record<string, boolean>> = {
  body: true,
  volume: true,
  strength: true,
  week: true,
  eating: false,
  vitals: false,
  cycle: false,
  photos: false,
  nutrients: false,
  laws: false,
  health: false,
  bulkguard: false,
  cycles: false,
};

/** この詳細キーへのドリルダウンで全画面広告を出す対象か（未知キーは false＝出さない） */
export function isInterstitialTarget(key: string | null | undefined): boolean {
  if (!key) return false;
  return INTERSTITIAL_TARGETS[key] === true;
}

/** 端末に残す表示履歴（AsyncStorage `bl-interstitial`） */
export type InterstitialHistory = {
  /** 最後に表示した日のJST日付（YYYY-MM-DD）。日が変わったら count を0に戻す */
  date: string;
  /** その日に表示した回数 */
  count: number;
  /** 最後に表示した時刻（epoch ms）。0＝まだ一度も出していない */
  lastMs: number;
};

export const EMPTY_INTERSTITIAL_HISTORY: InterstitialHistory = { date: '', count: 0, lastMs: 0 };

/**
 * AsyncStorage の生文字列を履歴へ。壊れた値・旧形式は「まだ一度も出していない」扱い
 * （throw しない＝広告のために画面を落とさない）。
 */
export function parseInterstitialHistory(raw: string | null | undefined): InterstitialHistory {
  if (!raw) return EMPTY_INTERSTITIAL_HISTORY;
  try {
    const v = JSON.parse(raw) as Partial<InterstitialHistory>;
    if (!v || typeof v !== 'object') return EMPTY_INTERSTITIAL_HISTORY;
    const date = typeof v.date === 'string' ? v.date : '';
    const count = typeof v.count === 'number' && Number.isFinite(v.count) ? Math.max(0, Math.floor(v.count)) : 0;
    const lastMs = typeof v.lastMs === 'number' && Number.isFinite(v.lastMs) ? Math.max(0, Math.floor(v.lastMs)) : 0;
    return { date, count, lastMs };
  } catch {
    return EMPTY_INTERSTITIAL_HISTORY;
  }
}

/**
 * 「今日」の表示回数。履歴の日付が今日でなければ0（日が変わったのでリセット）。
 * 端末の日付が過去へ戻された場合も date が一致しないので0になる＝上限を回避されるが、
 * 全画面広告は「出しすぎない」側に倒すほうが害が小さいので、これ以上の防御はしない。
 */
export function todayInterstitialCount(h: InterstitialHistory, todayYmd: string): number {
  return h.date === todayYmd ? h.count : 0;
}

/** canShowInterstitial の入力（すべて呼び出し側が測った値。この関数は時計にも端末にも触らない） */
export type InterstitialCheck = {
  /** 課金基盤が有効なビルドか（useGate().active） */
  active: boolean;
  /** いまのプラン（null/'free' が無料。有料には出さない） */
  plan: string | null | undefined;
  /** 現在時刻（epoch ms） */
  nowMs: number;
  /** このセッション（アプリのプロセス）で既に1回出したか */
  sessionShown: boolean;
  /** 前回表示の時刻（epoch ms・0＝未表示） */
  lastShownMs: number;
  /** 今日すでに出した回数（todayInterstitialCount の結果） */
  todayCount: number;
  /** アプリ起動時刻（epoch ms） */
  appStartedMs: number;
  /** 事前ロード済みか（false のときは絶対に出さない＝遷移を待たせない） */
  adLoaded: boolean;
};

/**
 * 全画面広告を出してよいか（純関数・すべての条件をここで満たす必要がある）。
 *
 * 条件（AND）:
 *  1. shouldShowAd(active, plan)＝課金有効ビルド × 無料プラン（有料には広告を出さない）
 *  2. 事前ロード済み（adLoaded）。ロード待ちで遷移を止めないための最重要条件
 *  3. アプリ起動から INTERSTITIAL_WARMUP_MS（30秒）以上たっている
 *  4. このセッションでまだ1回も出していない
 *  5. 前回表示から INTERSTITIAL_MIN_GAP_MS（10分）以上たっている
 *  6. 今日の表示回数が INTERSTITIAL_MAX_PER_DAY（3回）未満
 *
 * 「対象の詳細キーか」（isInterstitialTarget）はここでは見ない＝呼び出し側で先に弾く。
 * 頻度の判定と行き先の判定を混ぜないほうが、表を差し替えたときの影響が読める。
 */
export function canShowInterstitial(c: InterstitialCheck): boolean {
  if (!shouldShowAd(c.active, c.plan)) return false;
  if (!c.adLoaded) return false;
  if (c.nowMs - c.appStartedMs < INTERSTITIAL_WARMUP_MS) return false;
  if (c.sessionShown) return false;
  if (c.lastShownMs > 0 && c.nowMs - c.lastShownMs < INTERSTITIAL_MIN_GAP_MS) return false;
  if (c.todayCount >= INTERSTITIAL_MAX_PER_DAY) return false;
  return true;
}

/**
 * 表示した事実を履歴へ反映した新しい履歴を返す（純関数・保存は呼び出し側）。
 * 日付が変わっていれば count を1から数え直す。
 */
export function recordInterstitialShown(prev: InterstitialHistory, nowMs: number, todayYmd?: string): InterstitialHistory {
  const day = todayYmd ?? jstYmd(nowMs);
  const count = todayInterstitialCount(prev, day) + 1;
  return { date: day, count, lastMs: nowMs };
}
