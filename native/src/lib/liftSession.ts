// 筋トレ記録画面（app/lift-session.tsx）の純関数。
//
// 画面は「セット行の配列」を持ち、保存のときに既存の記録テキスト
// （`🏋️ 懸垂 -20kg×9、懸垂 -20kg×7、懸垂 -20kg×5`）へ落とす。
// 集計・e1RM・PR判定・履歴カードはすべてこのテキストを parseLiftText で読むので、
// ここで作る文字列が既存の書式から外れないことが最重要（往復テストで固定）。
//
// 【セットごとに回数が違う】9回→7回→5回と落ちていくのが普通なので、1セット=1行で持つ。
// 保存文字列では「連続する同じ種目・同じ重量・同じ回数」だけ `×回数×セット` にまとめ、
// それ以外は種目名を繰り返して並べる。parseLiftText は種目名が繰り返されても種目数を
// Setで数える（groupLiftsByDay）ので、集計は壊れない。
//
// 【加重/補助の1本ダイアル】自重種目（懸垂・ディップス等）の kg は
//   0 = 自重のみ ／ 正 = 加重（ベルト・ダンベル） ／ 負 = 補助（アシストマシン・バンド）
// の1つの数直線で持つ。実負荷 = 体重×係数 + kg（liftLog.effectiveKg。負なら引かれる）。
// 通常種目の kg は負荷そのもの（正のみ）。
import { effectiveKg, liftTextFrom, parseLiftText, type LiftEntry, type LiftMode } from './liftLog';

/** 画面上の1セット。id は行のキー（並び替えはしないが React の key に要る） */
export type SessionSet = {
  id: string;
  name: string;   // 種目の canon（日本語固定・DBに書く名前）
  kg: number;     // 通常種目: 負荷そのもの(>0) ／ 自重種目: ±kg（0=自重・負=補助・正=加重）
  reps: number;
};

/** 自重種目の加重/補助ダイアルの振れ幅（±kg）。補助マシンは最大でも体重相当なので60で十分 */
export const ASSIST_RANGE_KG = 60;
/** 通常種目の重量ダイアルの上限（WeightDial と同じ） */
export const MAX_ABS_KG = 300;
/** 回数ダイアルの上限 */
export const MAX_REPS = 50;

/** レストの選択肢（秒）。15秒刻みで 15秒〜10分（追い込み30秒〜高重量5分〜神経系10分をカバー） */
export const REST_CHOICES: number[] = Array.from({ length: 40 }, (_, i) => (i + 1) * 15);
export const REST_DEFAULT_SEC = 90;

/** レスト秒数の表示（60の倍数は「N分」、それ以外は「M分S秒」または「S秒」）。訳語は呼び側で渡す */
export function fmtRestSec(sec: number, words: { min: (n: number) => string; sec: (n: number) => string; minSec: (m: number, s: number) => string }): string {
  const n = Math.max(0, Math.round(sec));
  if (n < 60) return words.sec(n);
  if (n % 60 === 0) return words.min(n / 60);
  return words.minSec(Math.floor(n / 60), n % 60);
}

/** 保存できる行か。自重種目は kg が 0 や負でもよい。通常種目は kg > 0 が必須 */
export function setReady(s: SessionSet, isBw: (name: string) => boolean): boolean {
  if (!s.name.trim() || !(s.reps > 0)) return false;
  return isBw(s.name) ? Number.isFinite(s.kg) : s.kg > 0;
}

/** kg を種目の許容範囲に丸める（ダイアルの外や手打ちの事故を吸収） */
export function clampLoad(kg: number, bw: boolean): number {
  const v = Number.isFinite(kg) ? kg : 0;
  if (bw) return Math.max(-ASSIST_RANGE_KG, Math.min(ASSIST_RANGE_KG, v));
  return Math.max(0, Math.min(MAX_ABS_KG, v));
}

/** kg の意味（自重種目のダイアル表示に使う） */
export type LoadKind = 'abs' | 'bw' | 'plus' | 'assist';
export function loadKind(kg: number, bw: boolean): LoadKind {
  if (!bw) return 'abs';
  if (kg > 0) return 'plus';
  if (kg < 0) return 'assist';
  return 'bw';
}

/** 表示用の短い重量ラベル。「補助 −20kg」「加重 +10kg」「自重」「80kg」（訳語は呼び側から） */
export function loadLabel(kg: number, bw: boolean, words: { bw: string; plus: string; assist: string }): string {
  const kind = loadKind(kg, bw);
  const num = (v: number) => (v % 1 === 0 ? String(v) : v.toFixed(1));
  if (kind === 'abs') return `${num(kg)}kg`;
  if (kind === 'bw') return words.bw;
  if (kind === 'plus') return `${words.plus} +${num(kg)}kg`;
  return `${words.assist} −${num(Math.abs(kg))}kg`;   // 表示は全角マイナス（保存は ASCII の -）
}

/** 1セットを LiftEntry（保存書式の1単位）にする。自重種目の kg の符号で mode を決める */
export function setToEntry(s: SessionSet, isBw: (name: string) => boolean, sets = 1): LiftEntry {
  const bw = isBw(s.name);
  const mode: LiftMode = !bw ? 'abs' : s.kg > 0 ? 'plus' : s.kg < 0 ? 'minus' : 'bw';
  return { name: s.name.trim(), kg: bw ? s.kg : Math.max(0, s.kg), reps: Math.round(s.reps), sets, mode };
}

/**
 * セット配列 → 保存書式の LiftEntry 配列。
 * 連続する同じ種目・同じkg・同じ回数だけ sets にまとめる（「80kg×8×3」）。
 * 回数が変わる（9→7→5）・重量が変わる・別種目を挟む と別の単位になる。
 */
export function sessionEntries(sets: SessionSet[], isBw: (name: string) => boolean): LiftEntry[] {
  const out: LiftEntry[] = [];
  for (const s of sets) {
    if (!setReady(s, isBw)) continue;
    const e = setToEntry(s, isBw);
    const last = out[out.length - 1];
    if (last && last.name === e.name && last.kg === e.kg && last.reps === e.reps && last.mode === e.mode) {
      last.sets += 1;
    } else {
      out.push(e);
    }
  }
  return out;
}

/** セット配列 → 保存テキスト（`🏋️ …`）。保存できる行が無ければ空文字 */
export function sessionText(sets: SessionSet[], isBw: (name: string) => boolean): string {
  return liftTextFrom(sessionEntries(sets, isBw));
}

/** セッション全体の総挙上量（実負荷×回数の合計・整数）。自重種目は体重が要る（無ければ加重ぶんだけ） */
export function sessionVolume(sets: SessionSet[], isBw: (name: string) => boolean, bodyWeight?: number | null): number {
  let v = 0;
  for (const s of sets) {
    if (!setReady(s, isBw)) continue;
    v += effectiveKg(setToEntry(s, isBw), bodyWeight) * Math.round(s.reps);
  }
  return Math.round(v);
}

/** 保存テキストがこの画面のセット配列と同じ内容に戻せるか（テスト用の往復チェック） */
export function roundTrips(sets: SessionSet[], isBw: (name: string) => boolean): boolean {
  const text = sessionText(sets, isBw);
  const back = parseLiftText(text);
  const fwd = sessionEntries(sets, isBw);
  return liftTextFrom(back) === text && back.length === fwd.length;
}

/** 新しい行の id（時刻＋連番。並びのキーにしか使わない） */
let seq = 0;
export function newSetId(): string {
  seq = (seq + 1) % 100000;
  return `${Date.now().toString(36)}-${seq}`;
}

/**
 * 「＋セット」で足す行。前のセットの種目・重量・回数を引き継ぐ
 * （9→7→5 のように回数だけ変える操作が最短になる）。前が無ければ空の行
 */
export function nextSet(prev: SessionSet | null | undefined, name?: string): SessionSet {
  if (prev) return { id: newSetId(), name: name ?? prev.name, kg: prev.kg, reps: prev.reps };
  return { id: newSetId(), name: name ?? '', kg: 0, reps: 8 };
}

// ===== セッション中の状態（アプリ切替で失わないよう AsyncStorage に持つ） =====
// レストは「終わる時刻」で持つ。残り秒で持つとバックグラウンド中に止まってしまう
export type LiftSessionState = {
  date: string;              // 記録先の日付（YYYY-MM-DD）
  sets: SessionSet[];
  restSec: number;           // 選んでいるレストの長さ
  restEndsAt: number | null; // レスト終了時刻（epoch ms）。null=止まっている
  startedAt: number;         // セッション開始時刻（epoch ms）
};

export const LIFT_SESSION_KEY = 'bl-lift-session';

/** 保存文字列 → 状態。壊れていれば null（画面は新規セッションから始める） */
export function parseSessionState(raw: string | null | undefined): LiftSessionState | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<LiftSessionState>;
    if (!v || typeof v !== 'object') return null;
    if (typeof v.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.date)) return null;
    if (!Array.isArray(v.sets)) return null;
    const sets: SessionSet[] = [];
    for (const s of v.sets as Partial<SessionSet>[]) {
      if (!s || typeof s.name !== 'string') continue;
      const kg = Number(s.kg); const reps = Number(s.reps);
      if (!Number.isFinite(kg) || !Number.isFinite(reps)) continue;
      sets.push({ id: typeof s.id === 'string' && s.id ? s.id : newSetId(), name: s.name, kg, reps: Math.max(0, Math.round(reps)) });
    }
    const restSec = REST_CHOICES.includes(Number(v.restSec)) ? Number(v.restSec) : REST_DEFAULT_SEC;
    const restEndsAt = typeof v.restEndsAt === 'number' && Number.isFinite(v.restEndsAt) ? v.restEndsAt : null;
    const startedAt = typeof v.startedAt === 'number' && Number.isFinite(v.startedAt) ? v.startedAt : Date.now();
    return { date: v.date, sets, restSec, restEndsAt, startedAt };
  } catch { return null; }
}

/** 状態 → 保存文字列 */
export function serializeSessionState(st: LiftSessionState): string {
  return JSON.stringify(st);
}

/** レストの残り秒（終了時刻と現在時刻から。終わっていれば0、止まっていれば null） */
export function restLeftSec(endsAt: number | null, now: number): number | null {
  if (endsAt == null) return null;
  return Math.max(0, Math.ceil((endsAt - now) / 1000));
}

/** 保存の直前まで何も入力していない（破棄しても失うものが無い）か */
export function isEmptySession(st: LiftSessionState | null): boolean {
  return !st || st.sets.length === 0;
}
