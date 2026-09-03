// あなたの法則（法則図鑑・B-6）＋Day12「最初の法則」（B-7）
//
// 役割: 既存のローカル分析（insights / bingeAnalysis / weekdayRhythm / itemLog /
// achievements）の結果を「一人称の発見文」に翻訳してカード化する層。
// 新しい統計はここで発明しない（統計の正しさは各分析ライブラリが担保する）。
//
// 設計:
//  ・id は翻訳非依存の生値で作る（例 'food_up:ラーメン'）。言語を切り替えても同じ法則。
//  ・図鑑には「id → 発見日＋文章生成用の生値」を保存する。文章は表示のたびに
//    いまの言語で組み立て直す（訳文を保存すると言語切替で図鑑が化けるため）。
//  ・一度見つかった法則は、データが変わって条件から外れても図鑑に残る（＝コレクション）。
//  ・閾値はノイズを出さない側に倒す。「当たっていない法則」を1枚見せると図鑑全体の
//    信頼が死ぬので、データ不足時は黙って空を返す。
//  ・分析は全て端末内で完結する（サーバへは何も送らない）。
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { t } from './i18n';
import { getRemoteContent, pickL10n, type RemoteLawText } from './remoteContent';
import { todayJST, mifflinBMR, targetKcal, type ExLevel } from './calc';
import { foodWeightEffects, buildItemDays, type ItemDay, type WeightPoint } from './insights';
import { analyzeBinge, type AnalysisDay } from './bingeAnalysis';
import { hadComeback } from './achievements';
import { slotOf } from './itemLog';
import { healthAvailable, readActivitySummary } from './health';
import { weekdayRhythm } from '@/components/WeekdayHeatmapCard';
import { buildDayFeatures, readCachedDayFeatures, summarizeRecent, type DayFeature } from './features';
import { mineRules, riskRatio, conditionLabel, MIN_DAYS as ENGINE_MIN_DAYS } from './correlate';
import { PROTEIN_PER_KG_DEFAULT } from './goal';
import { getPurpose } from './purpose';
import { getNutrientDb, foodName } from '@/content/nutrientDb';
import { tierShareOf } from '@/content/proteinTiers';

// ===== 型 =====

// 法則の種類。既存分析から「確実に計算できるもの」だけ（新しい統計は増やさない）
export type LawKind =
  | 'food_up'        // 食べた翌日に体重が増えやすい食材（foodWeightEffects上位）
  | 'food_safe'      // 食べた翌日に体重が下がりやすい食材（同・下位）
  | 'weekday'        // 崩れやすい曜日（weekdayRhythm）／全曜日安定
  | 'binge_trigger'  // 過食の引き金1位（analyzeBinge.triggers[0]）
  | 'timeslot'       // 食べる時間帯の偏り（夜シェア・slotOf）
  | 'recover'        // お守り: 食べすぎ後に体重が戻るまでの日数（analyzeBinge.after）
  | 'comeback'       // 復帰パターン: 途切れてもまた30日つないだ（hadComeback）
  | 'sleep_factor'   // 21時以降に食べた日は当夜の睡眠が短い/長い（B-14b・HealthKitの睡眠×食事時刻）
  // ---- インサイト・エンジン（docs/INSIGHTS-ENGINE.md §3・lib/features.ts の日次特徴量 × lib/correlate.ts）----
  | 'sleep_debt_binge'    // 睡眠負債5h以上の日〜翌日に食べすぎが◯倍（リスク比）
  | 'mood_lag_binge'      // 気分3日平均が低い日の k日後に食べすぎが◯倍（ラグ1〜3のリスク比・最大のもの）
  | 'wheat_vs_rice_mood'  // 小麦中心の日 vs 米中心の日で翌日の気分が◯違う
  | 'salmon_master'       // 30日でサーモン◯g（週◯回）— 良い面と多様性の視座
  | 'chicken_heavy'       // 30日で鶏肉◯kg・魚が少ない — たんぱく源の偏り（病名は出さない）
  | 'lift_sleep'          // 7h以上寝た日のトレはボリューム±◯%
  | 'lift_protein_pr'     // たんぱく質が目標に届いた週は自己ベスト更新が◯倍
  | 'lift_mood'           // トレした日の気分は平均±◯
  | 'multi_binge'         // 多要素ルール（mineRules 上位3件を動的に法則化。id は因子の組で決定的）
  // ---- 食材ナビ（content/proteinTiers.ts・直近30日の品目名 × たんぱく源ティア）----
  | 'protein_tier';       // たんぱく源のAティア以上の割合＋Cティア以下→Sティアの置き換えで1食あたり−◯kcal

// 文章生成に使う生値（数値・食材名など）。翻訳せずにこのまま保存する
export type LawParams = Record<string, string | number>;

export type Law = {
  id: string;         // 安定キー（翻訳非依存。例 'food_up:ラーメン', 'weekday:5'）
  kind: LawKind;
  p: LawParams;       // 生値（保存して言語切替に耐える）
  title: string;      // 一人称の発見文（表示言語で生成済み）
  sub: string;        // 根拠の一言
  foundAt: string;    // 発見日 YYYY-MM-DD
};

// detectLawsへの入力。全てDB行から機械的に組める形にして、純関数のテストを可能にする
export type LawInput = {
  today: string;                                             // YYYY-MM-DD
  days: AnalysisDay[];                                       // 日次特徴量（昇順）
  itemDays: ItemDay[];                                       // 品目名×日（insights.buildItemDays）
  weights: WeightPoint[];                                    // 体重系列
  itemHours: { date: string; hour: number | null; kcal: number }[]; // 品目×時刻（直近4週）
  recordedDates: string[];                                   // 記録があった日（昇順）
  // 日別の睡眠時間（HealthKit readActivitySummary由来・「起きた日」に計上）。
  // entriesに睡眠列は無いためHealthKitが唯一のソース。hk無し環境では未指定/空＝sleep_factorはスキップ
  sleepDays?: { date: string; sleepH: number }[];
  // 日次特徴量（lib/features.ts・昇順・密）。エンジン系の法則はこれだけを見る。未指定/14日未満ならスキップ
  features?: DayFeature[];
  // たんぱく質目標（体重1kgあたりg。goals.protein_per_kg。未指定なら既定2.0）— lift_protein_pr の「目標」
  proteinPerKg?: number | null;
  // ダイエット目的（lib/purpose のキー）。'bulk' なら protein_tier の格付けを増量基準に切り替える。未指定は減量基準
  purposeKey?: string | null;
};

// 図鑑の「未発見枠」を出すための全種類リスト（表示順）
export const LAW_KINDS: LawKind[] = [
  'food_up', 'food_safe', 'weekday', 'binge_trigger', 'timeslot', 'recover', 'comeback', 'sleep_factor',
  'sleep_debt_binge', 'mood_lag_binge', 'multi_binge', 'wheat_vs_rice_mood', 'lift_sleep', 'lift_protein_pr', 'lift_mood',
  'salmon_master', 'chicken_heavy', 'protein_tier',
];

const PROTEIN_TIER_MIN_N = 10;      // 直近30日でたんぱく源として数えられた品目が10未満なら protein_tier は出さない
const PROTEIN_TIER_MIN_KCAL = 10;   // 置き換えの1食あたり差が10kcal未満なら「替えると−◯kcal」は言わない

// ===== エンジン系の閾値（correlate.ts の安全弁に加えて、法則として口に出す最低ライン） =====
const ENGINE_MIN_LIFT = 1.5;        // 「◯倍起きやすい」は1.5倍以上のときだけ（bingeAnalysis の1.4よりわずかに厳しく）
const ENGINE_MIN_GROUP = 4;         // リスク比の両群の最低日数
const MOOD_GROUP_MIN = 5;           // 気分の群比較: 各群5日以上
const MOOD_MIN_DIFF = 0.5;          // 気分差（5段階）0.5未満は法則と呼ばない
const LIFT_MOOD_MIN_DIFF = 0.4;     // トレ日の気分差は0.4以上（トレ効果は文献上も小〜中程度なので少し緩く）
const LIFT_GROUP_MIN = 4;           // トレ日の群比較: 各群4日以上
const LIFT_VOL_MIN_PCT = 10;        // ボリューム差10%未満は日々の揺れ
const SALMON_MIN_DAYS = 4;          // 30日で4日以上（週1回相当）食べていれば「サーモン好き」
const CHICKEN_HEAVY_G = 2000;       // 30日で2kg以上（≒毎日70g）
const CHICKEN_FISH_RATIO = 0.25;    // かつ魚が鶏の1/4未満なら「偏り」
const PR_WEEKS_MIN = 6;             // 週単位の比較は6週以上のトレ週があるときだけ
const PR_GROUP_MIN = 2;             // 各群2週以上
const PROTEIN_MET_RATIO = 0.9;      // 「目標に届いた」＝週平均が目標の9割以上（毎日ぴったりは現実的でない）
const MULTI_TOP = 3;                // 多要素ルールは上位3件まで図鑑に載せる

const STORE_KEY = 'bl-laws';         // { [id]: { at, kind, p } } 一度見つけた法則の永続化
const SEEN_KEY = 'bl-laws-seen';     // string[] 祝祭を見せ終わったid（freshの判定に使う）
const DAY12_DONE_KEY = 'bl-day12-done';     // '1' = Day12演出は実施済み（一度きり）
const DAY12_BANNER_KEY = 'bl-day12-banner'; // '1' = 食事タブの帯がまだ未消化

// ===== 閾値（ノイズを出さない側に倒す） =====
const FOOD_MIN_N = 3;          // 食材系: 体重差が取れた「食べた日」の最低数
const FOOD_MIN_EFFECT = 0.3;   // 食材系: ±0.3kg未満の差は法則と呼ばない
const FOOD_MAX_PER_DIR = 2;    // 食材系: 上げ/下げ 各2枚まで（羅列は発見感を薄める）
const NIGHT_MIN_DAYS = 14;     // 時間帯: 時刻つき記録がこれ未満なら判定しない
const NIGHT_MIN_SHARE = 0.3;   // 時間帯: 夜(21時〜)が30%以上で「偏り」と呼ぶ
const RECOVER_MIN_BINGES = 3;  // お守り: 食べすぎがこれ未満なら平均に意味がない
const RECOVER_MAX_DAYS = 4;    // お守り: 4日以内に戻る人にだけ「戻る」と言う
const SLEEP_MIN_GROUP = 5;     // 睡眠×夜食: 「食べた日」「食べない日」それぞれ最低5日
const SLEEP_MIN_DIFF_H = 0.5;  // 睡眠×夜食: 差が30分未満は法則と呼ばない

// ===== 文章生成（表示のたびに現在の言語で組み立てる） =====

const DOW_JA = ['日', '月', '火', '水', '木', '金', '土'];

// ===== 文言のリモート差し替え（lib/remoteContent・kind 'laws_text'） =====
// 法則の**検出**は統計計算＝コードなので新しい法則はアップデートが要る。ここで差し替えられるのは
// 図鑑の文言（発見文 title・根拠 sub・未発見ヒント hint）だけ。
// id は 'kind' または 'kind:variant'。variant は分岐のある種類だけ持つ:
//   weekday → 'stable' | 'default'、sleep_factor → 'long' | 'short'

/** 種類＋生値 → 文言のvariant（分岐の無い種類は 'default'） */
export function lawVariant(kind: LawKind, p: LawParams): string {
  if (kind === 'weekday') return p.d === 'stable' ? 'stable' : 'default';
  if (kind === 'sleep_factor') return p.dir === 'long' ? 'long' : 'short';
  // エンジン系で向きのある種類: wheat_vs_rice_mood → 'wheat_low' | 'rice_low'、lift_sleep / lift_mood → 'up' | 'down'
  if (kind === 'wheat_vs_rice_mood') return p.dir === 'rice_low' ? 'rice_low' : 'wheat_low';
  if (kind === 'lift_sleep' || kind === 'lift_mood') return p.dir === 'down' ? 'down' : 'up';
  // protein_tier → 'swap'（Cティア以下→Sの置き換えが言える）| 'default'
  if (kind === 'protein_tier') return Number(p.kcal) >= PROTEIN_TIER_MIN_KCAL && p.food ? 'swap' : 'default';
  return 'default';
}

/** リモートの文言定義を探す（'kind:variant' → 'kind' の順） */
function remoteLawText(kind: LawKind, variant?: string): RemoteLawText | undefined {
  const list = getRemoteContent().lawsText;
  if (list.length === 0) return undefined;
  return (variant ? list.find((x) => x.id === `${kind}:${variant}`) : undefined) ?? list.find((x) => x.id === kind);
}

/**
 * 差し込み変数。生値をそのまま渡し、表示加工が要るもの（曜日名・引き金ラベルの翻訳・
 * kcalの桁区切り）だけ上書きする。リモート文言は {food} {kg} {n} {d} {kcal} {x} {lift} {pct}
 * {days} {binges} {min} {late} {off} を使える
 */
export function lawVars(kind: LawKind, p: LawParams): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [k, v] of Object.entries(p)) vars[k] = String(v);
  if (kind === 'weekday' && p.d !== 'stable' && p.d != null) vars.d = t(DOW_JA[Number(p.d)] ?? '');
  if (kind === 'weekday' && p.kcal != null) vars.kcal = Number(p.kcal).toLocaleString();
  if (kind === 'binge_trigger' && p.label != null) vars.x = t(String(p.label));
  // 多要素ルール: 因子キー 'a+b' → 「ラベル」「ラベル」（correlate.conditionLabel で現在の言語に）
  if (kind === 'multi_binge' && p.f != null) vars.a = multiFactorText(String(p.f));
  return vars;
}

function multiFactorText(f: string): string {
  return f.split('+').filter(Boolean).map((k) => `「${conditionLabel(k)}」`).join('');
}

/** {k} を差し込む（t()の変数展開と同じ規則。未知の {k} はそのまま残す） */
export function fillVars(s: string, vars: Record<string, string>): string {
  let out = s;
  for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(v);
  return out;
}

/** 未発見シルエットに薄く見せる「種類のヒント」（リモートの hint があればそれを優先） */
export function lawKindHint(kind: LawKind): string {
  const ov = remoteLawText(kind);
  if (ov?.hint) { const h = pickL10n(ov.hint); if (h) return h; }
  return lawKindHintBuiltin(kind);
}

function lawKindHintBuiltin(kind: LawKind): string {
  switch (kind) {
    case 'food_up': return t('食べものと翌日の体重のこと');
    case 'food_safe': return t('体に優しい食べもののこと');
    case 'weekday': return t('曜日のリズムのこと');
    case 'binge_trigger': return t('食べすぎの引き金のこと');
    case 'timeslot': return t('食べる時間帯のこと');
    case 'recover': return t('立ち直りの早さのこと');
    case 'comeback': return t('途切れたあとのこと');
    case 'sleep_factor': return t('夜食と睡眠のこと');
    case 'sleep_debt_binge': return t('睡眠不足と食べすぎのこと');
    case 'mood_lag_binge': return t('気分の波と食べすぎのこと');
    case 'wheat_vs_rice_mood': return t('主食と翌日の気分のこと');
    case 'salmon_master': return t('よく食べる魚のこと');
    case 'chicken_heavy': return t('たんぱく源のバランスのこと');
    case 'lift_sleep': return t('睡眠とトレの手応えのこと');
    case 'lift_protein_pr': return t('たんぱく質と自己ベストのこと');
    case 'lift_mood': return t('トレと気分のこと');
    case 'multi_binge': return t('いくつかの条件が重なる日のこと');
    case 'protein_tier': return t('たんぱく源の選び方のこと');
  }
}

/**
 * kind＋生値 → 一人称の発見文。保存済みの法則もこれで毎回組み立て直す。
 * リモートの文言（title / sub）があれば、それに生値を差し込んで優先する。
 * 片方だけの差し替えも可（無い側は同梱の文言）
 */
export function lawText(kind: LawKind, p: LawParams): { title: string; sub: string } {
  const base = lawTextBuiltin(kind, p);
  const ov = remoteLawText(kind, lawVariant(kind, p));
  if (!ov || (!ov.title && !ov.sub)) return base;
  const vars = lawVars(kind, p);
  const title = ov.title ? fillVars(pickL10n(ov.title), vars) : '';
  const sub = ov.sub ? fillVars(pickL10n(ov.sub), vars) : '';
  return { title: title || base.title, sub: sub || base.sub };
}

function lawTextBuiltin(kind: LawKind, p: LawParams): { title: string; sub: string } {
  switch (kind) {
    case 'food_up':
      return {
        title: t('あなたは「{food}」の翌日、体重が増えやすい（平均+{kg}kg）', { food: String(p.food), kg: String(p.kg) }),
        sub: t('食べた日{n}日ぶんの傾向から', { n: Number(p.n) }),
      };
    case 'food_safe':
      return {
        title: t('あなたは「{food}」の翌日、体重が下がりやすい（平均-{kg}kg）', { food: String(p.food), kg: String(p.kg) }),
        sub: t('食べた日{n}日ぶんの傾向から', { n: Number(p.n) }),
      };
    case 'weekday':
      if (p.d === 'stable') {
        return { title: t('あなたはどの曜日も安定して食べられている'), sub: t('直近8週の記録から') };
      }
      return {
        title: t('あなたは{d}曜日に崩れやすい（平均+{n}kcal）', { d: t(DOW_JA[Number(p.d)]), n: Number(p.kcal).toLocaleString() }),
        sub: t('直近8週の記録から'),
      };
    case 'binge_trigger':
      return {
        // ラベルは bingeAnalysis の日本語原文をそのまま保存し、表示時に翻訳する
        title: t('あなたの食べすぎは「{x}」ときに{n}倍起きやすい', { x: t(String(p.label)), n: String(p.lift) }),
        sub: t('記録{n}日ぶんの傾向から', { n: Number(p.n) }),
      };
    case 'timeslot':
      return {
        title: t('あなたのカロリーの{p}%は夜（21時以降）に集中している', { p: Number(p.pct) }),
        sub: t('直近4週の食事記録から'),
      };
    case 'recover':
      return {
        title: t('あなたは食べすぎても、平均{n}日で体重が戻る', { n: String(p.days) }),
        sub: t('過去の食べすぎ{n}回のあとの体重から', { n: Number(p.binges) }),
      };
    case 'comeback':
      return { title: t('あなたは一度途切れても、また戻ってこられる'), sub: t('記録の空白と再開の履歴から') };
    case 'sleep_factor':
      // MFPが有料で売っている「食事×睡眠の洞察」の無料版。dirは翻訳非依存の生値
      return {
        title: p.dir === 'long'
          ? t('あなたは21時以降に食べた日、睡眠が平均{n}分長い', { n: Number(p.min) })
          : t('あなたは21時以降に食べた日、睡眠が平均{n}分短い', { n: Number(p.min) }),
        sub: t('食べた日{a}日・食べなかった日{b}日の睡眠から', { a: Number(p.late), b: Number(p.off) }),
      };
    // ---- インサイト・エンジン（§3）。文言は「〜のとき〜が起きやすい」。断定・因果・診断の語は使わない ----
    case 'sleep_debt_binge':
      return {
        title: t('あなたは睡眠不足が5時間たまると、その日から翌日にかけて食べすぎが{x}倍起きやすい', { x: String(p.x) }),
        sub: t('睡眠データのある{n}日の傾向から（該当{h}日）', { n: Number(p.n), h: Number(p.h) }),
      };
    case 'mood_lag_binge':
      return {
        title: t('あなたは気分が3日つづけて落ちると、{k}日後に食べすぎが{x}倍起きやすい', { k: Number(p.k), x: String(p.x) }),
        sub: t('気分と食事の記録{n}日ぶんの傾向から', { n: Number(p.n) }),
      };
    case 'wheat_vs_rice_mood':
      return {
        title: p.dir === 'rice_low'
          ? t('あなたは米中心の日の翌日、気分が平均{d}低い（小麦中心の日と比べて）', { d: String(p.d) })
          : t('あなたは小麦中心の日の翌日、気分が平均{d}低い（米中心の日と比べて）', { d: String(p.d) }),
        sub: t('小麦中心{a}日・米中心{b}日の翌日の気分から', { a: Number(p.a), b: Number(p.b) }),
      };
    case 'salmon_master':
      return {
        title: t('あなたはこの30日でサーモンを約{g}g（週{w}回）食べている', { g: Number(p.g).toLocaleString(), w: String(p.w) }),
        sub: t('オメガ3の摂り方として良い流れ。魚の種類を変えると栄養の幅も広がる'),
      };
    case 'chicken_heavy':
      // 病名・プリン体の話はここでは出さない（詳細記事側 E1b に委ねる）
      return {
        title: t('あなたはこの30日で鶏肉を約{kg}kg食べている', { kg: String(p.kg) }),
        sub: t('たんぱく源が偏っています。魚・卵・大豆も混ぜると栄養の幅が広がります'),
      };
    case 'lift_sleep':
      return {
        title: p.dir === 'down'
          ? t('あなたは7時間以上寝た日のトレは、ボリュームが平均{pct}%少ない', { pct: Number(p.pct) })
          : t('あなたは7時間以上寝た日のトレは、ボリュームが平均{pct}%多い', { pct: Number(p.pct) }),
        sub: t('7時間以上の日{a}回・未満の日{b}回のトレから', { a: Number(p.a), b: Number(p.b) }),
      };
    case 'lift_protein_pr':
      return {
        title: t('あなたはたんぱく質が目標に届いた週、自己ベスト更新が{x}倍起きやすい', { x: String(p.x) }),
        sub: t('トレした{n}週の記録から（目標の9割以上を「届いた」と数える）', { n: Number(p.n) }),
      };
    case 'lift_mood':
      return {
        title: p.dir === 'down'
          ? t('あなたはトレした日の気分が、平均{d}低い', { d: String(p.d) })
          : t('あなたはトレした日の気分が、平均{d}高い', { d: String(p.d) }),
        sub: t('トレした日{a}日・しなかった日{b}日の気分から', { a: Number(p.a), b: Number(p.b) }),
      };
    case 'multi_binge':
      return {
        title: t('あなたは{a}がそろった日、食べすぎが{x}倍起きやすい', { a: multiFactorText(String(p.f)), x: String(p.x) }),
        sub: t('該当{h}日を含む{n}日の記録から（相関であり、原因とは限りません）', { h: Number(p.h), n: Number(p.n) }),
      };
    // ---- 食材ナビ（content/proteinTiers.ts）。食材名は辞書の日本語名を生値で保存し、表示時に現在の言語へ ----
    case 'protein_tier':
      return {
        title: t('あなたのたんぱく源はAティア以上が{p}%', { p: Number(p.p) }),
        sub: lawVariant('protein_tier', p) === 'swap'
          ? t('{food}（{tier}ティア）を{best}（S）に替えると1食あたり約−{n}kcal', { food: tierFoodLabel(p.food), tier: String(p.tier), best: tierFoodLabel(p.best), n: Number(p.kcal).toLocaleString() })
          : t('直近30日の{n}食のたんぱく源から（{mode}の基準）', { n: Number(p.n), mode: p.mode === 'bulk' ? t('増量') : t('減量') }),
      };
  }
}

/** protein_tier の食材名: 生値は食材id。辞書にあれば現在の言語の名前、無ければ生値のまま */
function tierFoodLabel(id: unknown): string {
  const f = getNutrientDb().find((x) => x.id === String(id));
  return f ? foodName(f) : String(id ?? '');
}

function makeLaw(id: string, kind: LawKind, p: LawParams, foundAt: string): Law {
  return { id, kind, p, ...lawText(kind, p), foundAt };
}

// 表示用の丸め（0.7 のような1桁小数の文字列。toLocaleStringは食材のkgには不要）
const r1 = (n: number) => Math.round(n * 10) / 10;

// ===== 検出（純関数・テスト対象） =====

/** いまのデータから成立している法則を全て返す。データ不足時は黙って空配列 */
export function detectLaws(input: LawInput): Law[] {
  const out: Law[] = [];
  const today = input.today;

  // --- 食材×翌日体重（insights.foodWeightEffects。閾値は本体に加えてさらに絞る） ---
  try {
    const fx = foodWeightEffects(input.itemDays, input.weights)
      .filter((f) => f.withN >= FOOD_MIN_N);
    const ups = [...fx].reverse().filter((f) => f.effect >= FOOD_MIN_EFFECT).slice(0, FOOD_MAX_PER_DIR);
    const downs = fx.filter((f) => f.effect <= -FOOD_MIN_EFFECT).slice(0, FOOD_MAX_PER_DIR);
    for (const f of ups) out.push(makeLaw(`food_up:${f.name}`, 'food_up', { food: f.name, kg: r1(f.effect), n: f.withN }, today));
    for (const f of downs) out.push(makeLaw(`food_safe:${f.name}`, 'food_safe', { food: f.name, kg: r1(Math.abs(f.effect)), n: f.withN }, today));
  } catch { /* 分析はベストエフォート（1系統の失敗で図鑑全体を止めない） */ }

  // --- 崩れやすい曜日（weekdayRhythm。rowsはdiffから逆算して組む） ---
  try {
    const rows = input.days
      .filter((d) => d.intake != null && d.diff != null)
      .map((d) => ({ date: d.date, intake: d.intake, target: Number(d.intake) - Number(d.diff) }));
    const r = weekdayRhythm(rows, today);
    if (r.enough) {
      if (r.worstDow != null) {
        out.push(makeLaw(`weekday:${r.worstDow}`, 'weekday', { d: r.worstDow, kcal: r.avgOver ?? 0 }, today));
      } else {
        out.push(makeLaw('weekday:stable', 'weekday', { d: 'stable' }, today));
      }
    }
  } catch { /* 同上 */ }

  // --- 過食の引き金1位＋お守り（analyzeBinge。enough判定は本体に任せる） ---
  try {
    const r = analyzeBinge(input.days);
    if (r.enough && r.triggers.length > 0) {
      const top = r.triggers[0];
      out.push(makeLaw(`binge_trigger:${top.key}`, 'binge_trigger',
        { label: top.label, lift: r1(top.lift), n: r.totalDays }, today));
    }
    if (r.enough && r.bingeDays >= RECOVER_MIN_BINGES
      && r.after.recoverDays != null && r.after.recoverDays <= RECOVER_MAX_DAYS) {
      out.push(makeLaw('recover', 'recover', { days: r1(r.after.recoverDays), binges: r.bingeDays }, today));
    }
  } catch { /* 同上 */ }

  // --- 食べる時間帯の偏り（slotOf。夜シェアだけを法則にする） ---
  try {
    const withHour = input.itemHours.filter((x) => x.hour != null && x.kcal > 0);
    const dayN = new Set(withHour.map((x) => x.date)).size;
    if (dayN >= NIGHT_MIN_DAYS) {
      let night = 0; let total = 0;
      for (const x of withHour) {
        total += x.kcal;
        if (slotOf(x.hour as number) === 'night') night += x.kcal;
      }
      const share = total > 0 ? night / total : 0;
      if (share >= NIGHT_MIN_SHARE) {
        out.push(makeLaw('timeslot:night', 'timeslot', { pct: Math.round(share * 100) }, today));
      }
    }
  } catch { /* 同上 */ }

  // --- 復帰パターン（achievements.hadComeback。「戻ってこられる人」という強さの証明） ---
  try {
    if (hadComeback([...input.recordedDates].sort(), today)) {
      out.push(makeLaw('comeback', 'comeback', {}, today));
    }
  } catch { /* 同上 */ }

  // --- 夜食×睡眠（B-14b・sleep_factor） ---
  // 「21時以降の摂取がある日」vs「無い日」で当夜の睡眠時間を比べる。
  // 睡眠は「起きた日」に計上される（health.ts）ため、日dの当夜の睡眠＝d+1のsleepH。
  // 差30分以上・各群5日以上のときだけ法則にする（ノイズを出さない側に倒す）
  try {
    const sleepMap = new Map((input.sleepDays ?? []).filter((x) => x.sleepH > 0).map((x) => [x.date, x.sleepH]));
    if (sleepMap.size > 0) {
      // 時刻つきの食事記録がある日を「食べた/食べない」に分ける（時刻が無い記録だけの日は判定不能で除外）
      const withHour = input.itemHours.filter((x) => x.hour != null && x.kcal > 0);
      const lateDays = new Set(withHour.filter((x) => (x.hour as number) >= 21).map((x) => x.date));
      const allDays = new Set(withHour.map((x) => x.date));
      const late: number[] = [];
      const off: number[] = [];
      for (const d of allDays) {
        const sleep = sleepMap.get(shiftDate(d, 1));   // 当夜の睡眠＝翌朝「起きた日」の値
        if (sleep == null) continue;
        (lateDays.has(d) ? late : off).push(sleep);
      }
      if (late.length >= SLEEP_MIN_GROUP && off.length >= SLEEP_MIN_GROUP) {
        const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
        const diffH = avg(off) - avg(late);   // 正=食べた日のほうが短い
        if (Math.abs(diffH) >= SLEEP_MIN_DIFF_H) {
          out.push(makeLaw('sleep_factor', 'sleep_factor', {
            dir: diffH > 0 ? 'short' : 'long',
            min: Math.round(Math.abs(diffH) * 60),
            late: late.length, off: off.length,
          }, today));
        }
      }
    }
  } catch { /* 同上 */ }

  // --- インサイト・エンジン（§3）。日次特徴量が14日以上あるときだけ ---
  try {
    if (input.features && input.features.length >= ENGINE_MIN_DAYS) {
      out.push(...detectEngineLaws(input.features, today, input.proteinPerKg ?? PROTEIN_PER_KG_DEFAULT));
    }
  } catch { /* 同上 */ }

  // --- 食材ナビ: たんぱく源ティア（直近30日の品目名 → content/proteinTiers.tierShareOf） ---
  try {
    const law = detectProteinTierLaw(input.itemDays, today, input.purposeKey);
    if (law) out.push(law);
  } catch { /* 同上 */ }

  return out;
}

/**
 * protein_tier の検出（純関数・テスト対象）。直近30日の品目名をたんぱく源ティアに当て、
 * たんぱく源として数えられた品目が10以上のときだけ法則にする。生値は食材id（翻訳非依存）で保存する。
 * 目的が 'bulk' なら増量の基準、それ以外は減量の基準（content/proteinTiers.ts の基準表）
 */
export function detectProteinTierLaw(itemDays: ItemDay[], today: string, purposeKey?: string | null): Law | null {
  const from = shiftDate(today, -30);
  const names: string[] = [];
  for (const d of itemDays) if (d.date > from && d.date <= today) names.push(...d.names);
  const mode = purposeKey === 'bulk' ? 'bulk' : 'cut';
  const share = tierShareOf(names, mode, PROTEIN_TIER_MIN_N);
  if (!share) return null;
  const p: LawParams = { p: share.pHigh, n: share.n, mode };
  if (share.worst && share.best && share.kcalSaved >= PROTEIN_TIER_MIN_KCAL) {
    p.food = share.worst.food.id; p.tier = share.worst.tier; p.best = share.best.id; p.kcal = share.kcalSaved;
  }
  return makeLaw('protein_tier', 'protein_tier', p, today);
}

// ===== インサイト・エンジン系の検出（純関数・テスト対象） =====

const avgOf = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * 日次特徴量から §3 の法則を検出する。features は昇順・密（features.ts が保証）。
 * それぞれの採択基準は correlate.ts の安全弁（n≥14・両群≥4）に加えて、上の ENGINE_* 定数。
 */
export function detectEngineLaws(features: DayFeature[], today: string, proteinPerKg: number): Law[] {
  const out: Law[] = [];
  const f = features;
  const n = f.length;

  // --- sleep_debt_binge: 睡眠負債≥5h の日 t について、t または t+1 に食べすぎ ---
  // 「起きた日」に睡眠が計上されるので、負債が5hに達した朝から2日間を結果の窓にする。
  // 結果が分からない（摂取未記録）日は除外。両群≥4日・リスク比≥1.5
  try {
    const rr = riskRatio(f,
      (d) => (d.sleep_debt5 == null ? null : d.sleep_debt5 >= 5),
      (d, i) => {
        const nx = f[i + 1];
        if (d.intake == null && (nx == null || nx.intake == null)) return null;
        return d.binge || (nx != null && nx.binge);
      }, ENGINE_MIN_GROUP);
    if (rr && rr.withHits >= 2 && rr.rr >= ENGINE_MIN_LIFT) {
      out.push(makeLaw('sleep_debt_binge', 'sleep_debt_binge', { x: r1(rr.rr), n: rr.n, h: rr.withHits }, today));
    }
  } catch { /* ベストエフォート */ }

  // --- mood_lag_binge: 気分3日平均≤2.5 の k日後（k=1..3）に食べすぎ。最も倍率の高い k を採る ---
  try {
    let best: { k: number; rr: number; n: number; hits: number } | null = null;
    for (let k = 1; k <= 3; k++) {
      const rr = riskRatio(f,
        (_d, i) => { const p = f[i - k]; return p?.mood_avg3 == null ? null : p.mood_avg3 <= 2.5; },
        (d) => (d.intake == null ? null : d.binge), ENGINE_MIN_GROUP);
      if (rr && rr.withHits >= 2 && rr.rr >= ENGINE_MIN_LIFT && (!best || rr.rr > best.rr)) best = { k, rr: rr.rr, n: rr.n, hits: rr.withHits };
    }
    if (best) out.push(makeLaw('mood_lag_binge', 'mood_lag_binge', { k: best.k, x: r1(best.rr), n: best.n }, today));
  } catch { /* 同上 */ }

  // --- wheat_vs_rice_mood: 小麦中心の日 vs 米中心の日で、翌日の気分を比べる ---
  // 中心＝その主食が100g以上で、もう一方より多い。翌日に気分の記録がある日だけ。各群≥5日・差≥0.5
  try {
    const wheat: number[] = []; const rice: number[] = [];
    for (let i = 0; i + 1 < n; i++) {
      const d = f[i]; const nx = f[i + 1];
      if (!d.recorded || nx.mood == null) continue;
      if (d.wheat_g >= 100 && d.wheat_g > d.rice_g) wheat.push(nx.mood);
      else if (d.rice_g >= 100 && d.rice_g > d.wheat_g) rice.push(nx.mood);
    }
    if (wheat.length >= MOOD_GROUP_MIN && rice.length >= MOOD_GROUP_MIN) {
      const diff = avgOf(rice) - avgOf(wheat);   // 正＝小麦の日のほうが低い
      if (Math.abs(diff) >= MOOD_MIN_DIFF) {
        out.push(makeLaw('wheat_vs_rice_mood', 'wheat_vs_rice_mood',
          { dir: diff > 0 ? 'wheat_low' : 'rice_low', d: r1(Math.abs(diff)), a: wheat.length, b: rice.length }, today));
      }
    }
  } catch { /* 同上 */ }

  // --- salmon_master / chicken_heavy: 直近30日の食材合計 ---
  try {
    const last30 = f.slice(-30);
    const salmonDays = last30.filter((d) => d.salmon_g > 0).length;
    const salmonG = last30.reduce((a, d) => a + d.salmon_g, 0);
    if (salmonDays >= SALMON_MIN_DAYS) {
      out.push(makeLaw('salmon_master', 'salmon_master', { g: Math.round(salmonG / 10) * 10, w: r1(salmonDays / (last30.length / 7)), days: salmonDays }, today));
    }
    const chickenG = last30.reduce((a, d) => a + d.chicken_g, 0);
    const fishG = last30.reduce((a, d) => a + d.fish_g, 0);
    if (chickenG >= CHICKEN_HEAVY_G && fishG < chickenG * CHICKEN_FISH_RATIO) {
      out.push(makeLaw('chicken_heavy', 'chicken_heavy', { kg: r1(chickenG / 1000), g: Math.round(chickenG), fish: Math.round(fishG) }, today));
    }
  } catch { /* 同上 */ }

  // --- lift_sleep: トレした日を「その朝の睡眠≥7h」で分け、ボリュームの平均を比べる。各群≥4回・差≥10% ---
  try {
    const good: number[] = []; const short: number[] = [];
    for (const d of f) {
      if (d.lift_sessions === 0 || d.sleep_h == null || d.lift_volume_kg <= 0) continue;
      (d.sleep_h >= 7 ? good : short).push(d.lift_volume_kg);
    }
    if (good.length >= LIFT_GROUP_MIN && short.length >= LIFT_GROUP_MIN) {
      const pct = Math.round(((avgOf(good) - avgOf(short)) / avgOf(short)) * 100);
      if (Math.abs(pct) >= LIFT_VOL_MIN_PCT) {
        out.push(makeLaw('lift_sleep', 'lift_sleep', { dir: pct < 0 ? 'down' : 'up', pct: Math.abs(pct), a: good.length, b: short.length }, today));
      }
    }
  } catch { /* 同上 */ }

  // --- lift_protein_pr: 週ごとに「たんぱく質の週平均 ≥ 目標×0.9」と「その週に自己ベスト更新があった」を比べる ---
  // 目標＝直近の体重 × proteinPerKg（goals.protein_per_kg・既定2.0）。トレした週だけ数える。週≥6・各群≥2
  try {
    const weeks = new Map<string, { p: number[]; lift: boolean; pr: boolean; w: number | null }>();
    let lastW: number | null = null;
    for (const d of f) {
      if (d.weight != null) lastW = d.weight;
      const wk = weekStartOf(d.date);
      const b = weeks.get(wk) ?? { p: [], lift: false, pr: false, w: null };
      if (d.protein_g != null && d.protein_g > 0) b.p.push(d.protein_g);
      if (d.lift_sessions > 0) b.lift = true;
      if (d.pr) b.pr = true;
      b.w = lastW;
      weeks.set(wk, b);
    }
    const rows = [...weeks.values()].filter((w) => w.lift && w.p.length >= 3 && w.w != null);
    if (rows.length >= PR_WEEKS_MIN) {
      const rr = riskRatio(rows, (w) => avgOf(w.p) >= (w.w as number) * proteinPerKg * PROTEIN_MET_RATIO, (w) => w.pr, PR_GROUP_MIN);
      if (rr && rr.withHits >= 2 && rr.rr >= ENGINE_MIN_LIFT) {
        out.push(makeLaw('lift_protein_pr', 'lift_protein_pr', { x: r1(rr.rr), n: rr.n }, today));
      }
    }
  } catch { /* 同上 */ }

  // --- lift_mood: トレした日 vs しなかった日（記録がある日）の気分。各群≥5日・差≥0.4 ---
  try {
    const on: number[] = []; const off: number[] = [];
    for (const d of f) {
      if (!d.recorded || d.mood == null) continue;
      (d.lift_sessions > 0 ? on : off).push(d.mood);
    }
    if (on.length >= MOOD_GROUP_MIN && off.length >= MOOD_GROUP_MIN) {
      const diff = avgOf(on) - avgOf(off);
      if (Math.abs(diff) >= LIFT_MOOD_MIN_DIFF) {
        out.push(makeLaw('lift_mood', 'lift_mood', { dir: diff < 0 ? 'down' : 'up', d: r1(Math.abs(diff)), a: on.length, b: off.length }, today));
      }
    }
  } catch { /* 同上 */ }

  // --- multi_binge: 多要素ルールの上位3件（correlate.mineRules・事前に分かる条件だけ）。id は因子の組で決定的 ---
  try {
    const rules = mineRules(f, 'binge', { minSupport: 6, minLift: ENGINE_MIN_LIFT, maxFactors: 3, top: MULTI_TOP })
      .filter((r) => r.factors.length >= 2);   // 単独因子は sleep_debt_binge 等の専用法則に任せる
    for (const r of rules) {
      const key = r.factors.join('+');
      out.push(makeLaw(`multi_binge:${key}`, 'multi_binge', { f: key, x: r1(r.effect), n: r.n, h: r.hits ?? 0 }, today));
    }
  } catch { /* 同上 */ }

  return out;
}

// 週の起点（月曜）。trend.ts / changes.tsx と同じ定義
function weekStartOf(d: string): string {
  const dt = new Date(d + 'T00:00:00');
  dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

// ===== 永続化（一度見つけた法則は消えても図鑑に残る） =====

type StoredLaw = { at: string; kind: LawKind; p: LawParams };

async function readStore(): Promise<Record<string, StoredLaw>> {
  try {
    const raw = JSON.parse((await AsyncStorage.getItem(STORE_KEY)) || '{}') as Record<string, StoredLaw>;
    // 壊れた行（kind不明など）は表示時に落ちるので読み込み時に捨てる
    const out: Record<string, StoredLaw> = {};
    for (const [id, v] of Object.entries(raw)) {
      if (v && typeof v.at === 'string' && LAW_KINDS.includes(v.kind)) out[id] = { at: v.at, kind: v.kind, p: v.p ?? {} };
    }
    return out;
  } catch { return {}; }
}

async function readSeen(): Promise<Set<string>> {
  try { return new Set(JSON.parse((await AsyncStorage.getItem(SEEN_KEY)) || '[]') as string[]); } catch { return new Set(); }
}

/** 祝祭を見せ終わった法則を記録する（次回のfreshから外す） */
export async function markLawsSeen(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    const seen = await readSeen();
    for (const id of ids) seen.add(id);
    await AsyncStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));
  } catch { /* 次回もう一度祝うだけ（害はない） */ }
}

function reviveLaw(id: string, v: StoredLaw): Law {
  return { id, kind: v.kind, p: v.p, ...lawText(v.kind, v.p), foundAt: v.at };
}

async function refreshFrom(input: LawInput | null): Promise<{ all: Law[]; fresh: Law[] }> {
  let detected: Law[] = [];
  try { if (input) detected = detectLaws(input); } catch { /* 保存済みの図鑑だけでも返す */ }
  const store = await readStore();
  for (const l of detected) {
    // 発見日は初回のもの。生値（平均kg等）は最新データで更新する
    store[l.id] = { at: store[l.id]?.at ?? l.foundAt, kind: l.kind, p: l.p };
  }
  try { await AsyncStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch { /* 次回また拾う */ }
  const seen = await readSeen();
  const all = Object.entries(store)
    .map(([id, v]) => reviveLaw(id, v))
    .sort((a, b) => (a.foundAt === b.foundAt ? (a.id < b.id ? -1 : 1) : a.foundAt > b.foundAt ? -1 : 1)); // 新しい順
  const fresh = all.filter((l) => !seen.has(l.id));
  return { all, fresh };
}

// ===== データ取得（entries＋logsから LawInput を組む） =====

function shiftDate(d: string, n: number): string {
  const dt = new Date(d + 'T00:00:00');
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

/** JSTの時(0-23)。itemLog.hourJSTと同じ計算（あちらはexportされていない） */
function hourJST(at: string | null | undefined): number | null {
  if (!at) return null;
  const ms = Date.parse(at);
  if (Number.isNaN(ms)) return null;
  return new Date(ms + 9 * 3600_000).getUTCHours();
}

type ProfileRow = { sex: 'male' | 'female'; height_cm: number; age: number; init_weight: number | null; life_factor: number };
type EntryRow = { date: string; intake: number | null; p: number | null; weight: number | null; mood: string | null; food_text: string | null; ex: string | null; adj: number | null };
type LogRow = { date: string; at: string | null; items: { name?: string; kcal?: number }[] | null };

async function fetchLawInput(): Promise<LawInput | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return null;
  const today = todayJST();
  const from = shiftDate(today, -90);   // 分析窓は直近90日（曜日8週・過食4週を余裕でカバー）
  const [profRes, entRes, logRes] = await Promise.all([
    supabase.from('profiles').select('sex,height_cm,age,init_weight,life_factor').eq('id', session.user.id).maybeSingle(),
    supabase.from('entries').select('date,intake,p,weight,mood,food_text,ex,adj').gte('date', from).order('date', { ascending: true }).limit(1000),
    supabase.from('logs').select('date,at,items').gte('date', from).order('date', { ascending: true }).limit(2000),
  ]);
  const prof = profRes.data as ProfileRow | null;
  const entries = (entRes.data ?? []) as EntryRow[];
  const logs = (logRes.data ?? []) as LogRow[];
  if (!prof || entries.length === 0) return null;

  // 日次特徴量: 目安kcalはchanges.tsxと同じ式（BMR×活動係数＋運動加算adj）
  let w = Number(prof.init_weight) || 70;
  const days: AnalysisDay[] = entries.map((e) => {
    if (e.weight != null) w = Number(e.weight);
    const bmr = mifflinBMR(prof.sex, w, Number(prof.height_cm), Number(prof.age));
    const target = targetKcal(bmr, Number(prof.life_factor), (e.ex as ExLevel) || 'オフ', Number(e.adj) || 0);
    const intake = e.intake == null ? null : Number(e.intake);
    return {
      date: e.date, intake,
      p: e.p == null ? null : Number(e.p),
      diff: intake == null ? null : Math.round(intake - target),
      mood: e.mood, text: e.food_text,
      weight: e.weight == null ? null : Number(e.weight),
    };
  });
  const weights: WeightPoint[] = entries.filter((e) => e.weight != null).map((e) => ({ date: e.date, weight: Number(e.weight) }));

  const from28 = shiftDate(today, -28);
  const itemHours: LawInput['itemHours'] = [];
  for (const r of logs) {
    if (r.date < from28) continue;
    const hour = hourJST(r.at);
    for (const it of r.items ?? []) {
      const kcal = Number(it?.kcal) || 0;
      if (kcal > 0) itemHours.push({ date: r.date, hour, kcal });
    }
  }

  const recorded = new Set<string>();
  for (const e of entries) if (e.intake != null || e.weight != null) recorded.add(e.date);
  for (const r of logs) recorded.add(r.date);

  // 日別の睡眠（sleep_factor用）。呼び出し元（/laws・checkFirstLawUnlock）はHealthKit読取を
  // 持っていないため、ここで1回だけ読む。窓はitemHours（28日）＋翌朝ぶんで30日あれば足りる。
  // hk無し環境（Expo Go / Android）や未許可・失敗は空＝sleep_factorだけ静かにスキップ
  let sleepDays: LawInput['sleepDays'] = [];
  try {
    if (healthAvailable()) {
      const r = await readActivitySummary(30);
      if (!('error' in r)) sleepDays = r.filter((d) => d.sleepH > 0).map((d) => ({ date: d.date, sleepH: d.sleepH }));
    }
  } catch { /* 睡眠はベストエフォート */ }

  // 日次特徴量（エンジン系の法則用）。15分キャッシュがあるので、ここでの読取はふだん増えない。
  // たんぱく質目標は goals.protein_per_kg（列が無い/未設定なら既定2.0）
  let features: DayFeature[] | undefined;
  let proteinPerKg: number | null = null;
  try {
    const [feat, goalRes] = await Promise.all([
      buildDayFeatures(90),
      supabase.from('goals').select('protein_per_kg').maybeSingle(),
    ]);
    features = feat.length > 0 ? feat : undefined;
    const g = goalRes.data as { protein_per_kg?: number | null } | null;
    proteinPerKg = g?.protein_per_kg != null && Number(g.protein_per_kg) > 0 ? Number(g.protein_per_kg) : null;
  } catch { /* 特徴量はベストエフォート（無ければエンジン系の法則だけ出ない） */ }

  return {
    today, days,
    itemDays: buildItemDays(logs.map((r) => ({ date: r.date, items: r.items }))),
    weights, itemHours,
    recordedDates: [...recorded].sort(),
    sleepDays,
    features, proteinPerKg,
    purposeKey: getPurpose(),   // protein_tier の格付け基準（bulk=増量）。端末に保存済みの目的をそのまま
  };
}

// ===== §6 AI相談への注入（coach.tsx → /api/coach の dataBlock 末尾） =====

const COACH_BLOCK_MAX = 600;   // 文字数上限（プロンプトを太らせない）

/**
 * 「見つかっている法則の上位3件（文言）＋直近7日の特徴量サマリ」を1つのテキストにする。
 * サーバ側の dataBlock は日本語で組まれているので、ここも見出しは日本語固定（コーチが読む文書であり UI ではない）。
 * 法則の title は表示言語で組まれる（コーチはその言語で答えるので齟齬は出ない）。
 * 通信も HealthKit も触らない（相談の送信を遅くしない）。キャッシュが無ければ法則だけ、それも無ければ空文字
 */
export async function coachInsightsBlock(): Promise<string> {
  const lines: string[] = [];
  try {
    const store = await readStore();
    const top = Object.entries(store).sort((a, b) => (a[1].at > b[1].at ? -1 : 1)).slice(0, 3);
    if (top.length > 0) {
      lines.push('【本人の法則（端末内の相関分析・因果ではない）】');
      for (const [, v] of top) lines.push('・' + lawText(v.kind, v.p).title);
    }
  } catch { /* 図鑑が読めなければ法則は省く */ }
  try {
    const rows = await readCachedDayFeatures();
    if (rows.length > 0) {
      const s = summarizeRecent(rows, 7);
      const parts: string[] = [];
      if (s.sleepAvg != null) parts.push(`睡眠平均${s.sleepAvg}h`);
      if (s.moodAvg != null) parts.push(`気分平均${s.moodAvg}/5`);
      if (s.stepsAvg != null) parts.push(`歩数平均${s.stepsAvg.toLocaleString()}`);
      parts.push(`目安超過${s.overDays}日`);
      if (s.bingeDays > 0) parts.push(`食べすぎ${s.bingeDays}日`);
      if (s.liftDays > 0) parts.push(`トレ${s.liftDays}日`);
      lines.push(`直近7日の特徴量: ${parts.join('・')}（記録${s.recordedDays}/${s.days}日）`);
    }
  } catch { /* サマリ無しでも法則だけ渡す */ }
  const text = lines.join('\n');
  return text.length > COACH_BLOCK_MAX ? text.slice(0, COACH_BLOCK_MAX - 1) + '…' : text;
}

/**
 * 図鑑を更新して返す。
 * all=図鑑の全カード（新しい順・過去に見つけたものを含む）、fresh=まだ祝祭を見せていないもの。
 * 呼び出し側は祝祭を見せたら markLawsSeen(fresh.map(l => l.id)) を呼ぶ。
 */
export async function refreshLaws(): Promise<{ all: Law[]; fresh: Law[] }> {
  let input: LawInput | null = null;
  try { input = await fetchLawInput(); } catch { /* 通信断でも保存済みの図鑑は出す */ }
  return refreshFrom(input);
}

/** 概要タブのメニュー行サマリー用: 最新の法則のtitle（未発見ならnull）。端末内だけで完結 */
export async function latestLawSummary(): Promise<string | null> {
  const store = await readStore();
  const rows = Object.entries(store).sort((a, b) => (a[1].at > b[1].at ? -1 : 1));
  if (rows.length === 0) return null;
  return lawText(rows[0][1].kind, rows[0][1].p).title;
}

/** ハイライト（B-16）用: 最新の法則を生値つきで返す（未発見ならnull）。
 *  文章はハイライト側が表示のたびに lawText で組み立て直す（言語切替に耐えるため）。
 *  AsyncStorageを読むだけで軽い（サーバへは何も送らない） */
export async function latestLawRaw(): Promise<{ id: string; kind: LawKind; p: LawParams; foundAt: string } | null> {
  const store = await readStore();
  const rows = Object.entries(store).sort((a, b) => (a[1].at > b[1].at ? -1 : 1));
  if (rows.length === 0) return null;
  const [id, v] = rows[0];
  return { id, kind: v.kind, p: v.p, foundAt: v.at };
}

// ===== B-7: Day12「最初の法則」 =====

/**
 * 記録日数が12日に到達し、かつ法則が1つ以上ある状態を初検出したら:
 *  ・当日21:05（過ぎていれば翌日21:05）にローカル通知を1回だけ予約
 *  ・食事タブに一度きりの帯を出すフラグを立てる
 * 戻り値=帯を出すべきか（未消化の帯が残っている間はtrueを返し続ける）
 * scheduleNotify は notify.scheduleFirstLawNotification を渡す（laws→notifyの循環importを避ける）
 */
export async function checkFirstLawUnlock(scheduleNotify: () => Promise<void>): Promise<boolean> {
  try {
    if ((await AsyncStorage.getItem(DAY12_BANNER_KEY)) === '1') return true;   // 帯がまだ未消化
    if ((await AsyncStorage.getItem(DAY12_DONE_KEY)) === '1') return false;    // 実施済み（一度きり）
    // 毎回の起動で走るので、まず日付列だけの軽いクエリで12日未満を弾く（quickStreakと同じ考え方）
    const [e, l] = await Promise.all([
      supabase.from('entries').select('date').limit(1000),
      supabase.from('logs').select('date').limit(2000),
    ]);
    const quick = new Set<string>([
      ...((e.data ?? []) as { date: string }[]).map((r) => r.date),
      ...((l.data ?? []) as { date: string }[]).map((r) => r.date),
    ]);
    if (quick.size < 12) return false;   // 記録日数はentries/logsのdistinct date（全期間）
    const input = await fetchLawInput();
    if (!input) return false;
    const { all } = await refreshFrom(input);
    if (all.length === 0) return false;                                        // 12日貯まっても法則ゼロなら待つ
    await scheduleNotify().catch(() => {});
    await AsyncStorage.multiSet([[DAY12_DONE_KEY, '1'], [DAY12_BANNER_KEY, '1']]);
    return true;
  } catch { return false; }
}

/** 食事タブの帯を消化する（タップ／×で呼ぶ。以後は二度と出ない） */
export async function consumeFirstLawBanner(): Promise<void> {
  try { await AsyncStorage.removeItem(DAY12_BANNER_KEY); } catch { /* 次のタップで消える */ }
}
