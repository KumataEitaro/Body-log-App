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
export const AI_DAILY_LIMIT = 15; // AI解析の1人1日あたり回数
// 全ユーザー合計の1日上限（課金の安全弁＝これ以上は誰が使っても止まる。1日の最大コストを固定する本当の天井）
export const GLOBAL_AI_DAILY_CAP = 200;

// AI回数無制限のアカウント（管理者）。上限チェックのみスキップし、使用回数の記録など他の挙動は全ユーザー共通
export const UNLIMITED_EMAILS = ['gotcha429@gmail.com'];
export function isUnlimited(email?: string | null): boolean {
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
