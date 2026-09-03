// 広告枠（AdSlot）の純関数。表示可否と「畳んで消える」状態遷移をここに閉じ込め、
// UI（components/AdSlot.tsx）は描画とアニメだけを担う。jestで挙動を固定する。
//
// 方針（docs/ADS.md）:
// - 1画面に最大1枠。アンカー型アダプティブバナーのみ（インタースティシャル・リワード不使用）
// - 表示は「課金基盤が有効なビルド（active）× 無料プラン（plan が null/'free'）」のときだけ
// - 課金が通った瞬間は、枠を高さアニメで畳んでから unmount する（レイアウトが跳ねない）
// - 読み込み前は高さを確保しない（空白の枠を見せない）ので、読み込み前に課金されたら即 unmount

/** 広告枠の設置場所。計測・将来のユニット出し分けに使う（現在は全枠で同一ユニットID） */
export type AdPlacement = 'log' | 'training' | 'coach' | 'changes';
export const AD_PLACEMENTS: readonly AdPlacement[] = ['log', 'training', 'coach', 'changes'];

/** 畳むアニメの長さ（ms）。180ms・easeOut＝「消えた」と気づく最短の長さ */
export const AD_COLLAPSE_MS = 180;

/**
 * この端末・このプランで広告を出すべきか。
 * active=false（RCキー未設定ビルド）では誰にも出さない＝「広告なし」を売る前に広告を見せない。
 * plan は null（未取得・未設定）も無料扱い。lite/standard/premium は広告なし
 * （既存ライト購入者は降格させない＝ライトにも出さない）。
 */
export function shouldShowAd(active: boolean, plan: string | null | undefined): boolean {
  if (!active) return false;
  return plan == null || plan === 'free';
}

/**
 * 枠の状態。
 * - hidden: 何も描かない（高さ0）
 * - loading: BannerAd をマウントして読み込み中。高さはまだ確保しない（ラベル非表示）
 * - shown: 読み込み完了。ラベル＋導線＋バナーが見えている
 * - collapsing: 課金完了などで消える途中（高さアニメ中。終わったら hidden）
 */
export type AdSlotState = 'hidden' | 'loading' | 'shown' | 'collapsing';

/**
 * 枠に起きる出来事。
 * - eligible / ineligible: shouldShowAd の結果が変わった（課金完了は ineligible）
 * - loaded / failed: AdMob SDK のコールバック
 * - collapsed: 畳むアニメが終わった
 */
export type AdSlotEvent = 'eligible' | 'ineligible' | 'loaded' | 'failed' | 'collapsed';

/** 状態遷移（純関数）。想定外の組は現状維持＝落とさない */
export function nextAdSlotState(state: AdSlotState, ev: AdSlotEvent): AdSlotState {
  switch (state) {
    case 'hidden':
      return ev === 'eligible' ? 'loading' : 'hidden';
    case 'loading':
      if (ev === 'loaded') return 'shown';
      // 読み込み前に消える理由が出たら、高さを持っていないので即 hidden（畳む対象がない）
      if (ev === 'failed' || ev === 'ineligible') return 'hidden';
      return 'loading';
    case 'shown':
      // 見えている枠が消えるときだけ畳む（課金完了・再読み込み失敗）
      if (ev === 'ineligible' || ev === 'failed') return 'collapsing';
      return 'shown';
    case 'collapsing':
      if (ev === 'collapsed') return 'hidden';
      // 畳んでいる最中に再び対象になった（復元の取り消し等・実運用ではほぼ無い）→ 読み込みからやり直す
      if (ev === 'eligible') return 'loading';
      return 'collapsing';
    default:
      return state;
  }
}

/** この状態で BannerAd をマウントしておくべきか（collapsing 中はアニメのため残す） */
export function bannerMounted(state: AdSlotState): boolean {
  return state !== 'hidden';
}

// ============================================================================
// 広告 → 課金の導線（2026-09-04）
// ============================================================================
// 「広告をなくしませんか？」の誘導は、広告そのものより繊細に扱う必要がある。
// 誇張すれば嘘になり、罪悪感を誘えば戦略（docs/STRATEGY.md の「静かな伴走者」）に反する。
// そこで扱うのは**事実（見た回数）だけ**にし、判定と数え方をここに閉じ込める。
//
// **やらないこと**（レビューでも自己監査でも繰り返し確認する）:
//  - 「あと◯回で…」のような煽り／回数に応じて文言を強めるエスカレーション
//  - 「我慢」「邪魔」「うんざり」「しつこい」など、広告を悪者にして罪悪感を誘う言葉
//  - 広告ビューの上に × や閉じるボタンを重ねること（AdMob違反＝配信停止リスク）
//  - 広告が実際に出ていない状態（shouldShowAd=false）で誘導を出すこと（＝嘘）

/** 日ごとの回数（`{date, count}`）。JST日付でリセットする素朴な形 */
export type DayCount = { date: string; count: number };

/** 広告インプレッション履歴の AsyncStorage キー（直近7日ぶんの DayCount 配列） */
export const AD_IMPRESSION_STORE_KEY = 'bl-ad-impressions';

/** 「広告なしで使えます」の提示回数の AsyncStorage キー（DayCount 1件） */
export const AD_PITCH_STORE_KEY = 'bl-ad-pitch';

/** 履歴として持つ日数（1週間ぶん。これ以上は使わないので捨てる＝端末に残さない） */
export const AD_IMPRESSION_DAYS = 7;

/**
 * 回数行（「この1週間で広告を{n}回見ています」）を出す最低回数。
 * 1〜2回で「たくさん見ています」と言うと嘘っぽくなり、かえって信用を失う。
 * 3回＝週に数回は目に入っている、が事実として成立する下限。
 */
export const AD_PITCH_MIN_IMPRESSIONS = 3;

/**
 * 「広告なしで使えます」を1日に出す上限。
 * 全画面広告は1日3回まで出るが、そのたびに課金の話をされるのは「静かな伴走者」ではない。
 * 2回に絞る＝広告は出ても、勧誘は必ず広告より少ない。
 */
export const AD_PITCH_MAX_PER_DAY = 2;

/** 同じ枠のインプレッションを二重に数えない最低間隔（ms）。タブ往復・再マウントの重複対策 */
export const AD_IMPRESSION_MIN_GAP_MS = 30 * 1000;

/** JST日付文字列（YYYY-MM-DD）に n 日足す。純粋な文字列演算（TZに触らない） */
function shiftYmd(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map((v) => Number(v));
  if (!y || !m || !d) return ymd;
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

/** 生文字列 → インプレッション履歴。壊れた値は空配列（throw しない） */
export function parseImpressions(raw: string | null | undefined): DayCount[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return v.flatMap((row): DayCount[] => {
      if (!row || typeof row !== 'object') return [];
      const r = row as Partial<DayCount>;
      if (typeof r.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) return [];
      const count = typeof r.count === 'number' && Number.isFinite(r.count) ? Math.max(0, Math.floor(r.count)) : 0;
      return [{ date: r.date, count }];
    });
  } catch {
    return [];
  }
}

/**
 * 今日の広告表示を1回ぶん足した履歴を返す（純関数）。
 * 直近 AD_IMPRESSION_DAYS 日より古い行は落とす（使わないデータを端末に残さない）。
 * 並びは日付の昇順に正規化する。
 */
export function bumpImpression(prev: DayCount[], todayYmd: string, n = 1): DayCount[] {
  const oldest = shiftYmd(todayYmd, -(AD_IMPRESSION_DAYS - 1));
  const kept = prev.filter((r) => r.date >= oldest && r.date <= todayYmd && r.date !== todayYmd);
  const today = prev.find((r) => r.date === todayYmd);
  const add = Math.max(0, Math.floor(n));
  const rows = [...kept, { date: todayYmd, count: (today?.count ?? 0) + add }];
  return rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * 直近1週間（今日を含む AD_IMPRESSION_DAYS 日）の広告表示回数（純関数）。
 * 未来日付（端末の時計をいじった等）は数えない＝水増しされた数字を見せない。
 */
export function weeklyImpressions(rows: DayCount[], todayYmd: string): number {
  const oldest = shiftYmd(todayYmd, -(AD_IMPRESSION_DAYS - 1));
  return rows.reduce((a, r) => (r.date >= oldest && r.date <= todayYmd ? a + r.count : a), 0);
}

/** 生文字列 → DayCount 1件（提示回数の履歴）。壊れた値は「未提示」 */
export function parseDayCount(raw: string | null | undefined): DayCount {
  if (!raw) return { date: '', count: 0 };
  try {
    const v = JSON.parse(raw) as Partial<DayCount> | null;
    if (!v || typeof v !== 'object') return { date: '', count: 0 };
    const date = typeof v.date === 'string' ? v.date : '';
    const count = typeof v.count === 'number' && Number.isFinite(v.count) ? Math.max(0, Math.floor(v.count)) : 0;
    return { date, count };
  } catch {
    return { date: '', count: 0 };
  }
}

/** その日の回数（日付が違えば0＝日が変わったのでリセット） */
export function dayCountOf(v: DayCount, todayYmd: string): number {
  return v.date === todayYmd ? v.count : 0;
}

/** 1回ぶん足した DayCount（日が変わっていれば1から） */
export function bumpDayCount(prev: DayCount, todayYmd: string): DayCount {
  return { date: todayYmd, count: dayCountOf(prev, todayYmd) + 1 };
}

/** shouldPitchAdRemoval の入力（すべて呼び出し側が測った値） */
export type AdPitchCheck = {
  /** 課金基盤が有効なビルドか（useGate().active） */
  active: boolean;
  /** いまのプラン（null/'free' が無料） */
  plan: string | null | undefined;
  /** 直近1週間の広告表示回数（weeklyImpressions の結果） */
  impressions7d: number;
  /** 今日すでに「広告なしで使えます」を出した回数（dayCountOf の結果） */
  shownTodayCount: number;
};

/**
 * 「広告なしで使えます」の誘導を出してよいか（純関数）。
 *
 * 条件（AND）:
 *  1. shouldShowAd(active, plan)＝**広告が実際に出る状態**。RCキー未設定の現運用では常に false
 *     ＝広告が1枚も出ていない人に「広告を消せます」と言わない（嘘をつかない・最重要）
 *  2. 課金者ではない（1と同じ判定に含まれる。lite/standard/premium には出さない）
 *  3. 直近1週間で広告を1回以上見ている（見ていない人に「消せます」は意味を持たない）
 *  4. 今日の提示回数が AD_PITCH_MAX_PER_DAY（2回）未満＝勧誘は広告より必ず少ない
 */
export function shouldPitchAdRemoval(c: AdPitchCheck): boolean {
  if (!shouldShowAd(c.active, c.plan)) return false;
  if (c.impressions7d < 1) return false;
  if (c.shownTodayCount >= AD_PITCH_MAX_PER_DAY) return false;
  return true;
}

/**
 * ペイウォールに「この1週間で広告を{n}回見ています。」の行を出すか（純関数）。
 * AD_PITCH_MIN_IMPRESSIONS（3回）未満では出さない＝小さい数字で大げさに言わない。
 * 広告が出ない状態（shouldShowAd=false）でも出さない。
 */
export function shouldShowImpressionCount(c: Omit<AdPitchCheck, 'shownTodayCount'>): boolean {
  if (!shouldShowAd(c.active, c.plan)) return false;
  return c.impressions7d >= AD_PITCH_MIN_IMPRESSIONS;
}
