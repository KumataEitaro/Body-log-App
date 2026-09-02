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
  | 'sleep_factor';  // 21時以降に食べた日は当夜の睡眠が短い/長い（B-14b・HealthKitの睡眠×食事時刻）

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
};

// 図鑑の「未発見枠」を出すための全種類リスト（表示順）
export const LAW_KINDS: LawKind[] = ['food_up', 'food_safe', 'weekday', 'binge_trigger', 'timeslot', 'recover', 'comeback', 'sleep_factor'];

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
  return vars;
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
  }
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

  return out;
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

  return {
    today, days,
    itemDays: buildItemDays(logs.map((r) => ({ date: r.date, items: r.items }))),
    weights, itemHours,
    recordedDates: [...recorded].sort(),
    sleepDays,
  };
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
