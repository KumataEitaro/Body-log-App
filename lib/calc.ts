// カロリーモデル v5（トラッカーからの移植）
// 目安kcal = BMR × 生活係数 + 運動追加kcal + 補正kcal

export const EX_LEVELS = ['オフ', '軽い', '通常', '高', '特大'] as const;
export type ExLevel = (typeof EX_LEVELS)[number];

// 控えめな運動追加kcal（実体験ベース: 筋トレ1時間で250は盛りすぎ→150）
// 1日複数記録は加算式（例: 昼筋トレ150 + 夜ラン400 = +550）
export const EX_ADD: Record<ExLevel, number> = {
  オフ: 0,
  軽い: 30,
  通常: 150,
  高: 400,
  特大: 800,
};

export const LIFE_FACTOR_DEFAULT = 1.3;
export const FAT_KCAL_PER_KG = 7700;
export const WEEKLY_STD = -3500; // 週の標準進捗（-500/日）
export const AI_DAILY_LIMIT = 15; // AI解析の1人1日あたり回数（AI_LIMITS_ENABLED=false の間は使われない）
// 全ユーザー合計の1日上限（課金の安全弁＝これ以上は誰が使っても止まる。1日の最大コストを固定する本当の天井）
export const GLOBAL_AI_DAILY_CAP = 200;

// ===== AI利用上限のマスタースイッチ =====
// false = 個人上限も全体上限も無効（＝実質無制限）。
// 【注意】Gemini APIの請求は開発者持ちのため、これをfalseにしている間は
// 1日あたりの最大コストに天井が無い。公開後の請求が読めるようになったら true に戻す。
// 使用回数の記録（ai_usage）は false でも続けるので、実績を見てから判断できる。
export const AI_LIMITS_ENABLED = false;

// AI回数無制限のアカウント（管理者）。上限チェックのみスキップし、使用回数の記録など他の挙動は全ユーザー共通
export const UNLIMITED_EMAILS = ['gotcha429@gmail.com'];

/**
 * **AI利用上限の免除**だけを判定する（認可には使わない）。
 * AI_LIMITS_ENABLED=false の間は全員が上限免除＝ここは true を返す。
 *
 * 【重要】この関数を「管理者か」の判定に流用しないこと。
 * 上限撤廃中の短絡（`if (!AI_LIMITS_ENABLED) return true`）が、たまたま同じ関数を
 * 認可に使っていた `/api/admin/overview` を全ログインユーザーに開けていた（QA P0-1・2026-09-10）。
 * 管理者判定は下の isAdmin() を使う。tests/adminAuth.test.ts が両者の分離を固定している。
 */
export function isUnlimited(email?: string | null): boolean {
  if (!AI_LIMITS_ENABLED) return true;   // 上限撤廃中は全員が無制限
  return !!email && UNLIMITED_EMAILS.includes(email.toLowerCase());
}

/**
 * 管理者か（管理コンソール・管理APIの認可）。UNLIMITED_EMAILS の照合のみで、
 * **AI_LIMITS_ENABLED による短絡を持たない**＝上限の点火状態に一切依存しない。
 *
 * 注: UNLIMITED_EMAILS の値は公開ページ（app/privacy/page.tsx）にも載るため、
 * 「誰が管理者か」は公知になる。身元そのものはSupabaseのセッションで担保している。
 * 将来はサーバー専用の環境変数（ADMIN_EMAILS）かDBのロール列へ寄せる（QA P0-1 修正案2）。
 */
export function isAdmin(email?: string | null): boolean {
  return !!email && UNLIMITED_EMAILS.includes(email.toLowerCase());
}

// JSTの今日 (YYYY-MM-DD)
export function todayJST(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());
}

// Mifflin-St Jeor
export function mifflinBMR(sex: 'male' | 'female', weightKg: number, heightCm: number, age: number): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return Math.round((sex === 'male' ? base + 5 : base - 161) * 10) / 10;
}

export function targetKcal(bmr: number, lifeFactor: number, ex: ExLevel, adj: number): number {
  return Math.round((bmr * lifeFactor + (EX_ADD[ex] ?? 0) + (adj || 0)) * 10) / 10;
}

export type Verdict = 'OK' | '▲' | '×' | 'NG' | '不足注意';

export function judge(diff: number): Verdict {
  if (diff >= 101) return 'NG';
  if (diff >= -100) return '×';
  if (diff >= -299) return '▲';
  if (diff >= -500) return 'OK';
  return '不足注意';
}

export function verdictClass(v: Verdict | null | undefined): string {
  switch (v) {
    case 'OK': return 'OK';
    case '▲': return 'tri';
    case '×': return 'x';
    case 'NG': return 'NG';
    case '不足注意': return 'low';
    default: return '';
  }
}
