// 筋トレの種目。
//
// 基本種目は一覧から選べるようにし、無いものはユーザーが自由に足せる。
// 追加した種目は端末内に保存し、次からは一覧に並ぶ（使うほど自分用の一覧になる）。
//
// 【重要】DBに書くのは canon（日本語固定）。既存の履歴テキストは
// 「🏋️ ベンチプレス 80kg×8×3」の形式で、RM換算の解析がこの文字列に依存している。
// 表示名を保存すると言語切替で解析が壊れるため、翻訳名は画面表示だけに使う。
//
// 【ユーザー追加種目の属性（2026-09-24）】名前だけでなく
//   ・part … 対象部位（部位別ボリューム統計・履歴の部位フィルタに入る）
//   ・bw   … 自重が負荷になる種目か（kg欄が「加重/補助」になる）
//   ・db   … ダンベル種目か（重さを**片側**で入力する。保存テキストには `片側20kg` と書く）
// を端末内に持つ。属性は端末ローカルなので、記録テキストの解釈は属性に依存させない
// （片側かどうかはテキスト側の `片側` マーカーで決まる。lib/liftLog.ts）。
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
  /**
   * ダンベル種目（重さは片側＝片手ぶんで入力する）。
   * 記録は `片側20kg×8×3` と書き、ボリュームは両側ぶん（×2）で数える。
   * 明らかに両手にダンベルを持つ種目だけ true。バーベルでもダンベルでもやる種目
   * （アームカール・ショルダープレス・シュラッグ等）は付けない＝入力した重さをそのまま負荷とみなす。
   */
  db?: boolean;
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

/** 部位グループの受け皿（基本7部位に当てはまらない種目・部位未設定のユーザー追加種目） */
export const OTHER_PART = 'other';

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

/**
 * 基本種目（47種）。無いものはユーザーが足せる。
 * db: true（片側入力のダンベル種目）は次の7種。ダンベル以外でもやる種目には付けない（型の説明を参照）
 *   ダンベルプレス・ダンベルロウ・サイドレイズ・フロントレイズ・リアレイズ・ハンマーカール・キックバック
 */
export const LIFTS: Lift[] = [
  // 胸
  { id: 'bench', canon: 'ベンチプレス', part: 'chest' },
  { id: 'bench_incline', canon: 'インクラインベンチプレス', part: 'chest' },
  { id: 'bench_dumbbell', canon: 'ダンベルプレス', part: 'chest', db: true },
  { id: 'chest_fly', canon: 'チェストフライ', part: 'chest' },
  { id: 'chest_press', canon: 'チェストプレス', part: 'chest' },
  { id: 'push_up', canon: '腕立て伏せ', part: 'chest', bw: 0.64 },
  { id: 'dips', canon: 'ディップス', part: 'chest', bw: 1 },
  // 背中
  { id: 'deadlift', canon: 'デッドリフト', part: 'back' },
  { id: 'lat_pulldown', canon: 'ラットプルダウン', part: 'back' },
  { id: 'pull_up', canon: '懸垂', part: 'back', bw: 1 },
  { id: 'row_barbell', canon: 'ベントオーバーロウ', part: 'back' },
  { id: 'row_dumbbell', canon: 'ダンベルロウ', part: 'back', db: true },
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
  { id: 'side_raise', canon: 'サイドレイズ', part: 'shoulder', db: true },
  { id: 'front_raise', canon: 'フロントレイズ', part: 'shoulder', db: true },
  { id: 'rear_raise', canon: 'リアレイズ', part: 'shoulder', db: true },
  { id: 'upright_row', canon: 'アップライトロウ', part: 'shoulder' },
  // 腕
  { id: 'curl', canon: 'アームカール', part: 'arm' },
  { id: 'hammer_curl', canon: 'ハンマーカール', part: 'arm', db: true },
  { id: 'triceps_ext', canon: 'トライセプスエクステンション', part: 'arm' },
  { id: 'triceps_push', canon: 'トライセプスプレスダウン', part: 'arm' },
  { id: 'kickback', canon: 'キックバック', part: 'arm', db: true },
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
 * ユーザーが自分で足した種目は、追加時に「体重が負荷になる」を選んでいれば1、それ以外は0
 * （入力したkgをそのまま負荷とみなす）。
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
 * 重さを片側（片手ぶん）で入力するダンベル種目か。
 * 基本種目は db フラグ、ユーザー追加種目は追加時の「ダンベル種目」の選択で決まる。
 * **入力画面の見せ方と保存時のマーカー付与にだけ使う**。過去の記録の解釈は
 * テキストの `片側` マーカーで決まる（端末のフラグが変わっても履歴の意味が変わらないように）。
 */
export function isPerSideLift(canonName: string): boolean {
  const nm = canonName.trim();
  const base = LIFTS.find((l) => l.canon === nm);
  if (base) return base.db === true;
  return customLifts.find((c) => c.n === nm)?.db === true;
}

/**
 * 種目名から部位キーを引く。基本47種はカタログの部位、ユーザー追加種目は追加時に選んだ部位。
 * どちらにも無ければ 'other'。部位別の履歴フィルタと週間ボリューム統計が使う。
 */
export function liftPartOf(canonName: string): string {
  const nm = canonName.trim();
  const base = LIFTS.find((l) => l.canon === nm)?.part;
  if (base) return base;
  const custom = customLifts.find((c) => c.n === nm)?.part;
  return custom && isPartKey(custom) ? custom : OTHER_PART;
}

/** 部位キーとして受け付けるか（基本7部位＋'other'） */
export function isPartKey(key: string): boolean {
  return key === OTHER_PART || LIFT_PARTS.some((p) => p.key === key);
}

/** 部位キーの表示名（t()に通す前の日本語）。'other' はユーザー追加種目の受け皿 */
export function liftPartLabel(key: string): string {
  return LIFT_PARTS.find((p) => p.key === key)?.label ?? 'その他';
}

// ===== ユーザーが追加した種目（端末内に保存） =====
// 保存形式は {n: 名前, bw?: 1, part?: 部位キー, db?: true}。
// 以前は文字列の配列 → {n, bw} だったので、読み込み時に旧形式も受ける
const CUSTOM_KEY = 'bl-custom-lifts';

export type CustomLift = {
  n: string;
  bw?: number;      // 1 = 体重が負荷になる（懸垂タイプ）
  part?: string;    // 部位キー（LIFT_PARTS のいずれか、または 'other'）。無ければ 'other' 扱い
  db?: boolean;     // true = ダンベル種目（重さは片側で入力）
};

/** addCustomLift のオプション。以前の第2引数（bodyweight: boolean）も受ける */
export type CustomLiftOpts = { bodyweight?: boolean; part?: string | null; dumbbell?: boolean };

let customLifts: CustomLift[] = [];
let customNames: string[] = [];   // useSyncExternalStore用（毎回新配列を作ると無限再描画になる）
const listeners = new Set<() => void>();
const emit = () => { customNames = customLifts.map((c) => c.n); listeners.forEach((l) => l()); };

/** 保存されていた1件を今の形にそろえる。名前の無いものは null */
function normalizeCustom(x: unknown): CustomLift | null {
  if (typeof x === 'string') return x.trim() ? { n: x.trim() } : null;
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  if (typeof o.n !== 'string' || !o.n.trim()) return null;
  const c: CustomLift = { n: o.n.trim() };
  if (typeof o.bw === 'number' && o.bw > 0) c.bw = o.bw;
  if (typeof o.part === 'string' && isPartKey(o.part)) c.part = o.part;
  if (o.db === true) c.db = true;
  return c;
}

export async function loadCustomLifts(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(CUSTOM_KEY);
    const v = raw ? (JSON.parse(raw) as unknown[]) : [];
    if (Array.isArray(v)) {
      customLifts = v.map(normalizeCustom).filter((x): x is CustomLift => x != null);
    }
  } catch { /* 空のまま */ }
  emit();
}

async function persist(): Promise<void> {
  try { await AsyncStorage.setItem(CUSTOM_KEY, JSON.stringify(customLifts)); } catch { /* 表示は既に反映済み */ }
}

/**
 * 種目を追加する。基本種目と同じ名前は足さない。
 * @param opts bodyweight=懸垂タイプ（体重が負荷）／part=対象部位／dumbbell=ダンベル種目（片側入力）。
 *             boolean を渡すと以前どおり bodyweight の指定として扱う
 */
export async function addCustomLift(name: string, opts: CustomLiftOpts | boolean = {}): Promise<boolean> {
  const nm = name.trim();
  if (!nm) return false;
  if (LIFTS.some((l) => l.canon === nm)) return false;   // 基本種目に既にある
  if (customLifts.some((c) => c.n === nm)) return false; // 追加済み
  const o: CustomLiftOpts = typeof opts === 'boolean' ? { bodyweight: opts } : opts;
  const c: CustomLift = { n: nm };
  if (o.bodyweight) c.bw = 1;
  if (o.part && isPartKey(o.part)) c.part = o.part;
  if (o.dumbbell) c.db = true;
  customLifts = [...customLifts, c];
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

/** 追加した種目を属性ごと返す（一覧で部位グループに振り分ける・タグを出すため） */
export function getCustomLiftDefs(): CustomLift[] { return customLifts; }

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

/**
 * 追加した種目（属性つき）を購読する。
 * 統計カード（部位別ボリューム・履歴の部位フィルタ）は liftPartOf を描画中に呼ぶので、
 * 端末から読み終わったときに描き直されるようにこれを購読しておく。
 */
export function useCustomLiftDefs(): CustomLift[] {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    getCustomLiftDefs,
    getCustomLiftDefs,
  );
}
