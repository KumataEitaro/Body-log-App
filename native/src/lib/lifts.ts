// 筋トレの種目。
//
// 基本種目は一覧から選べるようにし、無いものはユーザーが自由に足せる。
// 追加した種目は端末内に保存し、次からは一覧に並ぶ（使うほど自分用の一覧になる）。
//
// 【重要】DBに書くのは canon（日本語固定）。既存の履歴テキストは
// 「🏋️ ベンチプレス 80kg×8×3」の形式で、RM換算の解析がこの文字列に依存している。
// 表示名を保存すると言語切替で解析が壊れるため、翻訳名は画面表示だけに使う。
import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { t } from './i18n';

export type Lift = {
  id: string;
  canon: string;    // DBに書く名前（日本語固定・翻訳禁止）
  part: string;     // 部位グループのキー
  /**
   * 自重が負荷になる種目の、体重に対する負荷の割合。
   * 懸垂やディップスは体を全部持ち上げるので1.0、腕立て伏せは腕にかかるのが
   * 体重の約64%（Ebben et al. 2011の実測値）。
   * これがある種目は入力するkgを「加重」として扱い、実負荷 = 体重×bw + 加重 で見る。
   */
  bw?: number;
};

/** 部位。選ぶときに探しやすくする */
export const LIFT_PARTS: { key: string; label: string }[] = [
  { key: 'chest', label: '胸' },
  { key: 'back', label: '背中' },
  { key: 'legs', label: '脚' },
  { key: 'shoulder', label: '肩' },
  { key: 'arm', label: '腕' },
  { key: 'core', label: '体幹' },
  { key: 'full', label: '全身' },
];

/** 表示名（t()はモジュール読み込み時に評価すると言語切替に追従しないため関数で包む） */
export function liftName(id: string): string {
  const map: Record<string, string> = {
    bench: t('ベンチプレス'), bench_incline: t('インクラインベンチプレス'),
    bench_dumbbell: t('ダンベルプレス'), chest_fly: t('チェストフライ'),
    push_up: t('腕立て伏せ'), chest_press: t('チェストプレス'), dips: t('ディップス'),
    deadlift: t('デッドリフト'), lat_pulldown: t('ラットプルダウン'),
    pull_up: t('懸垂'), row_barbell: t('ベントオーバーロウ'), row_dumbbell: t('ダンベルロウ'),
    row_seated: t('シーテッドロウ'), back_ext: t('バックエクステンション'), shrug: t('シュラッグ'),
    squat: t('スクワット'), squat_front: t('フロントスクワット'), leg_press: t('レッグプレス'),
    leg_ext: t('レッグエクステンション'), leg_curl: t('レッグカール'),
    lunge: t('ランジ'), bulgarian: t('ブルガリアンスクワット'),
    calf_raise: t('カーフレイズ'), hip_thrust: t('ヒップスラスト'), rdl: t('ルーマニアンデッドリフト'),
    shoulder_press: t('ショルダープレス'), side_raise: t('サイドレイズ'),
    front_raise: t('フロントレイズ'), rear_raise: t('リアレイズ'), upright_row: t('アップライトロウ'),
    curl: t('アームカール'), hammer_curl: t('ハンマーカール'),
    triceps_ext: t('トライセプスエクステンション'), triceps_push: t('トライセプスプレスダウン'),
    kickback: t('キックバック'), wrist_curl: t('リストカール'),
    plank: t('プランク'), crunch: t('クランチ'), leg_raise: t('レッグレイズ'),
    russian_twist: t('ロシアンツイスト'), ab_roller: t('アブローラー'), side_plank: t('サイドプランク'),
    clean: t('クリーン'), snatch: t('スナッチ'), thruster: t('スラスター'),
    burpee: t('バーピー'), kettlebell_swing: t('ケトルベルスイング'),
  };
  return map[id] ?? id;
}

/** 基本種目（47種）。無いものはユーザーが足せる */
export const LIFTS: Lift[] = [
  // 胸
  { id: 'bench', canon: 'ベンチプレス', part: 'chest' },
  { id: 'bench_incline', canon: 'インクラインベンチプレス', part: 'chest' },
  { id: 'bench_dumbbell', canon: 'ダンベルプレス', part: 'chest' },
  { id: 'chest_fly', canon: 'チェストフライ', part: 'chest' },
  { id: 'chest_press', canon: 'チェストプレス', part: 'chest' },
  { id: 'push_up', canon: '腕立て伏せ', part: 'chest', bw: 0.64 },
  { id: 'dips', canon: 'ディップス', part: 'chest', bw: 1 },
  // 背中
  { id: 'deadlift', canon: 'デッドリフト', part: 'back' },
  { id: 'lat_pulldown', canon: 'ラットプルダウン', part: 'back' },
  { id: 'pull_up', canon: '懸垂', part: 'back', bw: 1 },
  { id: 'row_barbell', canon: 'ベントオーバーロウ', part: 'back' },
  { id: 'row_dumbbell', canon: 'ダンベルロウ', part: 'back' },
  { id: 'row_seated', canon: 'シーテッドロウ', part: 'back' },
  { id: 'back_ext', canon: 'バックエクステンション', part: 'back' },
  { id: 'shrug', canon: 'シュラッグ', part: 'back' },
  // 脚
  { id: 'squat', canon: 'スクワット', part: 'legs' },
  { id: 'squat_front', canon: 'フロントスクワット', part: 'legs' },
  { id: 'leg_press', canon: 'レッグプレス', part: 'legs' },
  { id: 'leg_ext', canon: 'レッグエクステンション', part: 'legs' },
  { id: 'leg_curl', canon: 'レッグカール', part: 'legs' },
  { id: 'lunge', canon: 'ランジ', part: 'legs' },
  { id: 'bulgarian', canon: 'ブルガリアンスクワット', part: 'legs' },
  { id: 'calf_raise', canon: 'カーフレイズ', part: 'legs' },
  { id: 'hip_thrust', canon: 'ヒップスラスト', part: 'legs' },
  { id: 'rdl', canon: 'ルーマニアンデッドリフト', part: 'legs' },
  // 肩
  { id: 'shoulder_press', canon: 'ショルダープレス', part: 'shoulder' },
  { id: 'side_raise', canon: 'サイドレイズ', part: 'shoulder' },
  { id: 'front_raise', canon: 'フロントレイズ', part: 'shoulder' },
  { id: 'rear_raise', canon: 'リアレイズ', part: 'shoulder' },
  { id: 'upright_row', canon: 'アップライトロウ', part: 'shoulder' },
  // 腕
  { id: 'curl', canon: 'アームカール', part: 'arm' },
  { id: 'hammer_curl', canon: 'ハンマーカール', part: 'arm' },
  { id: 'triceps_ext', canon: 'トライセプスエクステンション', part: 'arm' },
  { id: 'triceps_push', canon: 'トライセプスプレスダウン', part: 'arm' },
  { id: 'kickback', canon: 'キックバック', part: 'arm' },
  { id: 'wrist_curl', canon: 'リストカール', part: 'arm' },
  // 体幹
  { id: 'plank', canon: 'プランク', part: 'core' },
  { id: 'crunch', canon: 'クランチ', part: 'core' },
  { id: 'leg_raise', canon: 'レッグレイズ', part: 'core' },
  { id: 'russian_twist', canon: 'ロシアンツイスト', part: 'core' },
  { id: 'ab_roller', canon: 'アブローラー', part: 'core' },
  { id: 'side_plank', canon: 'サイドプランク', part: 'core' },
  // 全身
  { id: 'clean', canon: 'クリーン', part: 'full' },
  { id: 'snatch', canon: 'スナッチ', part: 'full' },
  { id: 'thruster', canon: 'スラスター', part: 'full' },
  { id: 'burpee', canon: 'バーピー', part: 'full' },
  { id: 'kettlebell_swing', canon: 'ケトルベルスイング', part: 'full' },
];

/**
 * 自重が負荷になる種目なら体重に対する割合、そうでなければ0を返す。
 * ユーザーが自分で足した種目は判断材料がないので0（入力したkgをそのまま負荷とみなす）。
 */
export function bwRatioOf(canonName: string): number {
  const nm = canonName.trim();
  const base = LIFTS.find((l) => l.canon === nm)?.bw;
  if (base != null) return base;
  // ユーザー追加の懸垂タイプ（宣言は関数の巻き上げで後方の定義を参照できる）
  return customBwOf(nm);
}

/** 加重して行う種目か（入力欄の見せ方を変えるため） */
export function isBodyweightLift(canonName: string): boolean {
  return bwRatioOf(canonName) > 0;
}

/**
 * 種目名から部位キーを引く。基本47種以外（ユーザー追加）は 'other'。
 * 部位別の履歴フィルタと週間ボリューム統計が使う。
 */
export function liftPartOf(canonName: string): string {
  const nm = canonName.trim();
  return LIFTS.find((l) => l.canon === nm)?.part ?? 'other';
}

/** 部位キーの表示名（t()に通す前の日本語）。'other' はユーザー追加種目の受け皿 */
export function liftPartLabel(key: string): string {
  return LIFT_PARTS.find((p) => p.key === key)?.label ?? 'その他';
}

// ===== ユーザーが追加した種目（端末内に保存） =====
// 保存形式は {n: 名前, bw?: 1}。以前は文字列の配列だったので、読み込み時に旧形式も受ける
const CUSTOM_KEY = 'bl-custom-lifts';

type CustomLift = { n: string; bw?: number };

let customLifts: CustomLift[] = [];
let customNames: string[] = [];   // useSyncExternalStore用（毎回新配列を作ると無限再描画になる）
const listeners = new Set<() => void>();
const emit = () => { customNames = customLifts.map((c) => c.n); listeners.forEach((l) => l()); };

export async function loadCustomLifts(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(CUSTOM_KEY);
    const v = raw ? (JSON.parse(raw) as unknown[]) : [];
    if (Array.isArray(v)) {
      customLifts = v
        .map((x) => (typeof x === 'string' ? { n: x } : (x as CustomLift)))
        .filter((x) => x && typeof x.n === 'string' && x.n.trim().length > 0);
    }
  } catch { /* 空のまま */ }
  emit();
}

async function persist(): Promise<void> {
  try { await AsyncStorage.setItem(CUSTOM_KEY, JSON.stringify(customLifts)); } catch { /* 表示は既に反映済み */ }
}

/** 種目を追加する。基本種目と同じ名前は足さない。bodyweight=懸垂タイプ（体重が負荷） */
export async function addCustomLift(name: string, bodyweight = false): Promise<boolean> {
  const nm = name.trim();
  if (!nm) return false;
  if (LIFTS.some((l) => l.canon === nm)) return false;   // 基本種目に既にある
  if (customLifts.some((c) => c.n === nm)) return false; // 追加済み
  customLifts = [...customLifts, bodyweight ? { n: nm, bw: 1 } : { n: nm }];
  emit();
  await persist();
  return true;
}

export async function removeCustomLift(name: string): Promise<void> {
  customLifts = customLifts.filter((x) => x.n !== name);
  emit();
  await persist();
}

export function getCustomLifts(): string[] { return customNames; }

/** カスタム種目の自重係数（懸垂タイプなら1、通常は0） */
export function customBwOf(name: string): number {
  return customLifts.find((c) => c.n === name.trim())?.bw ?? 0;
}

export function useCustomLifts(): string[] {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    getCustomLifts,
    getCustomLifts,
  );
}
