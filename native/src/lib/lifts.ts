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
  { id: 'push_up', canon: '腕立て伏せ', part: 'chest' },
  { id: 'dips', canon: 'ディップス', part: 'chest' },
  // 背中
  { id: 'deadlift', canon: 'デッドリフト', part: 'back' },
  { id: 'lat_pulldown', canon: 'ラットプルダウン', part: 'back' },
  { id: 'pull_up', canon: '懸垂', part: 'back' },
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

// ===== ユーザーが追加した種目（端末内に保存） =====
const CUSTOM_KEY = 'bl-custom-lifts';

let customLifts: string[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export async function loadCustomLifts(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(CUSTOM_KEY);
    const v = raw ? (JSON.parse(raw) as string[]) : [];
    if (Array.isArray(v)) customLifts = v.filter((x) => typeof x === 'string' && x.trim().length > 0);
  } catch { /* 空のまま */ }
  emit();
}

/** 種目を追加する。基本種目と同じ名前は足さない */
export async function addCustomLift(name: string): Promise<boolean> {
  const nm = name.trim();
  if (!nm) return false;
  if (LIFTS.some((l) => l.canon === nm)) return false;   // 基本種目に既にある
  if (customLifts.includes(nm)) return false;            // 追加済み
  customLifts = [...customLifts, nm];
  emit();
  try { await AsyncStorage.setItem(CUSTOM_KEY, JSON.stringify(customLifts)); } catch { /* 表示は既に増えている */ }
  return true;
}

export async function removeCustomLift(name: string): Promise<void> {
  customLifts = customLifts.filter((x) => x !== name);
  emit();
  try { await AsyncStorage.setItem(CUSTOM_KEY, JSON.stringify(customLifts)); } catch { /* 無視 */ }
}

export function getCustomLifts(): string[] { return customLifts; }

export function useCustomLifts(): string[] {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    getCustomLifts,
    getCustomLifts,
  );
}
