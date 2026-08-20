// 記録できる運動の種類。
//
// METsは Compendium of Physical Activities (2011) の代表値。
// 強度によって実際は上下するので、アプリ内では「約○kcal」と目安として示す。
// 消費kcal = METs × 体重kg × 時間h × 1.05
//
// 【重要】canon はDBに書く名前で、翻訳してはいけない。
// 以前は表示名（翻訳済み）をそのままlogs.textへ保存していたため、
// 英語で使うと「Walk 30分」と混在し、言語を戻すと別の種目として集計が分断された。
// 表示は name（翻訳あり）、保存は canon（日本語固定）を使う。
import { t } from './i18n';

export type Activity = {
  id: string;        // 安定した識別子。頻度スコアと選択状態のキーに使う
  e: string;         // 絵文字
  canon: string;     // DBに書く名前（日本語固定・翻訳禁止）
  mets: number;
  /** 距離を入れると精度が上がる種目（1kgあたり1kmの消費kcal） */
  perKgKm?: number;
};

// 表示名は id から引く（t()はモジュール読み込み時に評価すると言語切替に追従しないため関数で包む）
export function activityName(id: string): string {
  const map: Record<string, string> = {
    walk_dog: t('犬の散歩'), walk: t('散歩'), walk_fast: t('ウォーキング'), run: t('ランニング'),
    run_fast: t('ジョギング（速め）'), bike: t('自転車'), bike_fast: t('自転車（速め）'),
    bike_static: t('エアロバイク'), swim: t('水泳'), swim_hard: t('水泳（速め）'),
    yoga: t('ヨガ・ストレッチ'), pilates: t('ピラティス'), housework: t('家事・掃除'),
    cooking: t('料理'), shopping: t('買い物・外出'), childcare: t('子どもと遊ぶ'),
    garden: t('庭仕事'), stairs: t('階段のぼり'), commute: t('通勤の徒歩'), standing: t('立ち仕事'),
    hiking: t('登山・ハイキング'), dance: t('ダンス'), aerobics: t('エアロビクス'),
    jumprope: t('縄跳び'), elliptical: t('クロストレーナー'), rowing: t('ローイング'),
    stepper: t('ステッパー'), hiit: t('HIIT'), circuit: t('サーキットトレーニング'),
    calisthenics: t('自体重トレーニング'),
    soccer: t('サッカー'), basketball: t('バスケットボール'), baseball: t('野球'),
    tennis: t('テニス'), badminton: t('バドミントン'), tabletennis: t('卓球'),
    volleyball: t('バレーボール'), futsal: t('フットサル'), golf: t('ゴルフ'),
    bouldering: t('ボルダリング'), surf: t('サーフィン'), ski: t('スキー'),
    snowboard: t('スノーボード'), skate: t('スケート'), martial: t('格闘技・武道'),
    boxing: t('ボクシング'), kendo: t('剣道'), judo: t('柔道'), karate: t('空手'),
    fishing: t('釣り'), bowling: t('ボウリング'), horse: t('乗馬'), kayak: t('カヤック'),
    sports: t('スポーツ（その他）'),
  };
  return map[id] ?? id;
}

/** グループ分け。選ぶときに探しやすくする */
export const ACTIVITY_GROUPS: { key: string; label: string; ids: string[] }[] = [
  { key: 'daily', label: '日常の動き', ids: ['walk_dog', 'walk', 'walk_fast', 'commute', 'stairs', 'housework', 'cooking', 'shopping', 'childcare', 'garden', 'standing'] },
  { key: 'cardio', label: '有酸素', ids: ['run', 'run_fast', 'bike', 'bike_fast', 'bike_static', 'swim', 'swim_hard', 'hiking', 'elliptical', 'rowing', 'stepper', 'jumprope'] },
  { key: 'studio', label: 'スタジオ・自宅', ids: ['yoga', 'pilates', 'dance', 'aerobics', 'hiit', 'circuit', 'calisthenics'] },
  { key: 'ball', label: '球技', ids: ['soccer', 'futsal', 'basketball', 'baseball', 'volleyball', 'tennis', 'badminton', 'tabletennis', 'golf', 'bowling'] },
  { key: 'outdoor', label: 'アウトドア', ids: ['surf', 'ski', 'snowboard', 'skate', 'bouldering', 'fishing', 'horse', 'kayak'] },
  { key: 'martial', label: '格闘技', ids: ['martial', 'boxing', 'kendo', 'judo', 'karate'] },
  { key: 'other', label: 'その他', ids: ['sports'] },
];

export const ACTIVITIES: Activity[] = [
  // 日常の動き
  { id: 'walk_dog', e: '🐕', canon: '犬の散歩', mets: 3.0, perKgKm: 0.55 },
  { id: 'walk', e: '🚶', canon: '散歩', mets: 3.0, perKgKm: 0.55 },
  { id: 'walk_fast', e: '🥾', canon: 'ウォーキング', mets: 4.3, perKgKm: 0.6 },
  { id: 'commute', e: '🏙️', canon: '通勤の徒歩', mets: 3.5, perKgKm: 0.55 },
  { id: 'stairs', e: '🪜', canon: '階段のぼり', mets: 8.8 },
  { id: 'housework', e: '🧹', canon: '家事・掃除', mets: 3.3 },
  { id: 'cooking', e: '🍳', canon: '料理', mets: 2.5 },
  { id: 'shopping', e: '🛒', canon: '買い物・外出', mets: 2.3 },
  { id: 'childcare', e: '👶', canon: '子どもと遊ぶ', mets: 3.5 },
  { id: 'garden', e: '🌱', canon: '庭仕事', mets: 3.8 },
  { id: 'standing', e: '🧍', canon: '立ち仕事', mets: 2.3 },
  // 有酸素
  { id: 'run', e: '🏃', canon: 'ランニング', mets: 8.0, perKgKm: 1.05 },
  { id: 'run_fast', e: '💨', canon: 'ジョギング（速め）', mets: 11.0, perKgKm: 1.05 },
  { id: 'bike', e: '🚴', canon: '自転車', mets: 6.0, perKgKm: 0.35 },
  { id: 'bike_fast', e: '🚵', canon: '自転車（速め）', mets: 10.0, perKgKm: 0.4 },
  { id: 'bike_static', e: '🚲', canon: 'エアロバイク', mets: 6.8 },
  { id: 'swim', e: '🏊', canon: '水泳', mets: 6.0 },
  { id: 'swim_hard', e: '🌊', canon: '水泳（速め）', mets: 9.8 },
  { id: 'hiking', e: '⛰️', canon: '登山・ハイキング', mets: 6.0, perKgKm: 0.8 },
  { id: 'elliptical', e: '🎚️', canon: 'クロストレーナー', mets: 5.0 },
  { id: 'rowing', e: '🚣', canon: 'ローイング', mets: 7.0 },
  { id: 'stepper', e: '🪫', canon: 'ステッパー', mets: 9.0 },
  { id: 'jumprope', e: '🪢', canon: '縄跳び', mets: 11.8 },
  // スタジオ・自宅
  { id: 'yoga', e: '🧘', canon: 'ヨガ・ストレッチ', mets: 2.5 },
  { id: 'pilates', e: '🤸', canon: 'ピラティス', mets: 3.0 },
  { id: 'dance', e: '💃', canon: 'ダンス', mets: 5.0 },
  { id: 'aerobics', e: '🎶', canon: 'エアロビクス', mets: 7.3 },
  { id: 'hiit', e: '⚡', canon: 'HIIT', mets: 8.0 },
  { id: 'circuit', e: '🔁', canon: 'サーキットトレーニング', mets: 7.0 },
  { id: 'calisthenics', e: '🤾', canon: '自体重トレーニング', mets: 3.8 },
  // 球技
  { id: 'soccer', e: '⚽', canon: 'サッカー', mets: 7.0 },
  { id: 'futsal', e: '🥅', canon: 'フットサル', mets: 7.0 },
  { id: 'basketball', e: '🏀', canon: 'バスケットボール', mets: 6.5 },
  { id: 'baseball', e: '⚾', canon: '野球', mets: 5.0 },
  { id: 'volleyball', e: '🏐', canon: 'バレーボール', mets: 4.0 },
  { id: 'tennis', e: '🎾', canon: 'テニス', mets: 7.3 },
  { id: 'badminton', e: '🏸', canon: 'バドミントン', mets: 5.5 },
  { id: 'tabletennis', e: '🏓', canon: '卓球', mets: 4.0 },
  { id: 'golf', e: '⛳', canon: 'ゴルフ', mets: 4.3 },
  { id: 'bowling', e: '🎳', canon: 'ボウリング', mets: 3.0 },
  // アウトドア
  { id: 'surf', e: '🏄', canon: 'サーフィン', mets: 3.0 },
  { id: 'ski', e: '🎿', canon: 'スキー', mets: 5.3 },
  { id: 'snowboard', e: '🏂', canon: 'スノーボード', mets: 5.3 },
  { id: 'skate', e: '🛼', canon: 'スケート', mets: 7.0 },
  { id: 'bouldering', e: '🧗', canon: 'ボルダリング', mets: 7.0 },
  { id: 'fishing', e: '🎣', canon: '釣り', mets: 3.5 },
  { id: 'horse', e: '🐴', canon: '乗馬', mets: 5.5 },
  { id: 'kayak', e: '🛶', canon: 'カヤック', mets: 5.0 },
  // 格闘技
  { id: 'martial', e: '🥋', canon: '格闘技・武道', mets: 10.3 },
  { id: 'boxing', e: '🥊', canon: 'ボクシング', mets: 7.8 },
  { id: 'kendo', e: '🎋', canon: '剣道', mets: 7.0 },
  { id: 'judo', e: '🤼', canon: '柔道', mets: 10.3 },
  { id: 'karate', e: '👊', canon: '空手', mets: 10.3 },
  // その他
  { id: 'sports', e: '🏆', canon: 'スポーツ（その他）', mets: 7.0 },
];

const BY_ID = new Map(ACTIVITIES.map((a) => [a.id, a]));

export function activityById(id: string): Activity | undefined {
  return BY_ID.get(id);
}

/** 既定で表示する種目（初回はよく使うものだけを出し、増えた種目に埋もれさせない） */
export const DEFAULT_VISIBLE = [
  'walk', 'walk_fast', 'run', 'bike', 'yoga', 'swim', 'housework', 'sports',
];

/** 消費kcalを計算する。距離が入っていれば距離ベースに切り替える（精度が上がる） */
export function activityKcal(a: Activity, weightKg: number, minutes: number, km?: number | null): number {
  if (km != null && km > 0 && a.perKgKm != null) {
    return Math.round(a.perKgKm * weightKg * km);
  }
  return Math.round(a.mets * weightKg * (minutes / 60) * 1.05);
}
