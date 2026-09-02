// リモートコンテンツ: 読み物・バッジ・法則の文言を、アプリのアップデート無しで足す／差し替える。
//
// 【何をリモート化するか（原則）】
//  App Storeの規約上「コードを含む機能」はOTA配信できない。したがって配信するのは
//  **宣言的データとして表現できるもの**だけに絞る。
//   ・読み物   … 純テキスト。完全にリモート化できる（タイトル・本文・タグ・公開日・対象言語）
//   ・バッジ   … 名前・説明・アイコン名・カテゴリはデータ。獲得条件だけはコードなので、
//                条件を単一メトリクスの比較（AND配列まで）の**宣言的DSL**にした。
//                DSLで書けない条件（不死鳥＝途切れたあとの再30日 等）はコード側に残る
//   ・法則     … 検出は統計計算（コード）なので**新しい法則の追加はアップデートが必要**。
//                図鑑の文言（発見文・根拠・未発見のヒント）だけを差し替えられる
//
// 【配信元】Supabase `remote_content`（supabase/migration-30.sql）。全認証ユーザーがselect可・
//  書き込みはservice roleのみ（管理者がSQL Editorでinsertする運用。docs/REMOTE-CONTENT.md）。
//
// 【取得と反映】起動時（認証確立後）＋24時間ごとに読み、AsyncStorage 'bl-remote-content' に
//  キャッシュ。オフライン・失敗時はキャッシュ、キャッシュも無ければ同梱データのみ＝**壊れない**。
//  min_app_version より古いアプリは行を無視。DSLの未知metricなど解釈できない要素は捨てる。
//
// 【マージ規則】同梱データ＋リモートを **idで統合**。リモートが同idなら上書き（＝文言差し替え）、
//  新idなら追加。同じkindの行が複数あるときは version昇順→published_at昇順に適用し、後勝ち。
//
// 【i18n】payload内の文言は { ja:'…', en:'…' } の多言語オブジェクト。t()は通さない（辞書に無いため）。
//  無い言語は ja → en → 最初にある言語 の順でフォールバック（pickL10n）。
import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import { supabase } from './supabase';
import { getLocale } from './i18n';

export const REMOTE_CACHE_KEY = 'bl-remote-content';
const REFRESH_INTERVAL_MS = 24 * 60 * 60_000;   // 24時間ごと

// ===== 型（payloadの中身） =====

/** 多言語文言。キーは言語コード（'ja' | 'en' | …）。文字列1本でも受け付ける（＝全言語共通） */
export type L10n = Record<string, string> | string;

export type RemoteKind = 'readings' | 'badges' | 'laws_text';

/** 読み物1件（同梱の Column と同じ形に解決される） */
export type RemoteReading = {
  id: string;
  emoji?: string;
  minutes?: number;
  publishedAt?: string;          // 'YYYY-MM-DD'。一覧の並び順と「NEW」の判定に使う
  langs?: string[];              // 対象言語。指定があれば、その言語で表示中のときだけ出す
  tags?: string[];               // 任意（将来の絞り込み用。現状は表示しない）
  title: L10n;
  lead: L10n;
  body: L10n;
  sources?: { label: string; url: string }[];
};

/** バッジ条件DSLで参照できるメトリクス。runEvaluate（lib/achievements）が毎回計算する数値だけ */
export const BADGE_METRICS = [
  'streak',              // いまの連続記録日数（お守り込み）
  'recordedDays',        // 直近400日の通算記録日数
  'morningDays',         // 朝（10時まで）に記録した日の累計
  'photoCount',          // 写真解析の累計枚数
  'coachCount',          // AI相談の累計往復数
  'myFoodCount',         // マイ食品の登録数
  'restCount',           // レストタイマーの累計起動回数（端末ローカル）
  'weightLossKg',        // 開始時体重 − 最低体重（kg）
  'liftVolumeMonthKg',   // 月間の挙上ボリューム最大値（kg×回数×セット）
  'cardioKmMonth',       // 月間の有酸素距離の最大値（km）
  'burnKcalWeek',        // 週間の運動消費kcalの最大値
  'prCount',             // 自己ベストの更新回数
  'weekCount',           // 今週（月曜起点）の記録日数
] as const;
export type BadgeMetric = (typeof BADGE_METRICS)[number];
export type BadgeMetrics = Record<BadgeMetric, number>;

export type BadgeOp = '>=' | '>' | '<=' | '<' | '==';
export type BadgeCondition = { metric: BadgeMetric; op?: BadgeOp; value: number };

/** バッジ1件（リモート）。獲得条件は when（単一 or AND配列） */
export type RemoteBadge = {
  id: string;
  cat: 'streak' | 'action' | 'body' | 'move';
  icon?: string;                 // Lucideのアイコン名（許可リストに無ければ既定アイコン）
  emoji?: string;                // ステッカー等のテキスト表現用（省略時 '🏅'）
  name: L10n;
  desc: L10n;
  when: BadgeCondition | BadgeCondition[];
};

/** 解説記事の出典1件（content/evidence.ts の EvidenceSource と同じ形。url は https のみ受け付ける） */
export type RemoteEvidenceSource = { authors: string; title: string; journal: string; year: number; url: string };

/**
 * 法則の解説記事（law-detail・E1b）のリモート差し替え。節ごとに部分上書きできる
 * （無い節は同梱のまま）。science の refs は **この記事の sources の1始まりの番号**
 */
export type RemoteLawArticle = {
  meaning?: L10n;                                   // ②これは何を意味するか
  science?: { text: L10n; refs?: number[] }[];      // ③科学的背景（段落＋出典番号）
  actions?: L10n[];                                 // ④できること（3つ）
  seeDoctor?: L10n;                                 // ⑤受診の目安（空文字で「同梱の目安を消す」）
  caution?: L10n;                                   // ⑥記事固有の注意
  sources?: RemoteEvidenceSource[];                 // ⑦出典
};

/** 法則の文言1件。id は 'kind' または 'kind:variant'（weekday:stable / sleep_factor:long 等） */
export type RemoteLawText = {
  id: string;
  title?: L10n;                  // 発見文。{food} {kg} {n} {d} {kcal} {x} {lift} {pct} {days} {binges} {min} {late} {off} を差し込める
  sub?: L10n;                    // 根拠の一言
  hint?: L10n;                   // 未発見シルエットのヒント（variant無しのidにだけ効く）
  article?: RemoteLawArticle;    // 解説記事（law-detail）。id は evidenceKey（'kind' または 'kind:variant'）
};

/** remote_content の1行 */
export type RemoteRow = {
  id: string;
  kind: RemoteKind;
  version: number;
  payload: { items?: unknown[] } | null;
  published_at: string | null;
  min_app_version: string | null;
};

/** マージ済みのリモート内容（同梱との統合は各機能側で行う） */
export type RemoteContent = {
  readings: RemoteReading[];
  badges: RemoteBadge[];
  lawsText: RemoteLawText[];
};

export const EMPTY_REMOTE: RemoteContent = { readings: [], badges: [], lawsText: [] };

// ===== 純関数（テスト対象） =====

/**
 * 多言語文言から表示言語の文字列を選ぶ。無い言語は ja → en → 最初の値 の順でフォールバック。
 * 文字列1本ならそのまま返す。何も無ければ ''。
 */
export function pickL10n(v: L10n | undefined | null, locale: string = getLocale()): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v !== 'object') return '';
  const hit = v[locale] ?? v.ja ?? v.en;
  if (typeof hit === 'string') return hit;
  const first = Object.values(v).find((x) => typeof x === 'string');
  return first ?? '';
}

/**
 * バージョン比較: app >= min なら true。'1.0.20' / '1.0' / '1.0-test' のような文字列を
 * 数値部分だけで比べる（欠けた桁は0）。minが空・解釈不能なら制限なし（true）。
 * appが解釈不能（開発ビルド等）は「最新扱い」で true にする＝配信を止めない。
 */
export function versionGte(app: string | null | undefined, min: string | null | undefined): boolean {
  const parse = (s: string | null | undefined): number[] | null => {
    if (!s) return null;
    const m = String(s).match(/\d+(?:\.\d+)*/);
    if (!m) return null;
    return m[0].split('.').map((x) => Number(x) || 0);
  };
  const a = parse(app), b = parse(min);
  if (!b) return true;
  if (!a) return true;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0, y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

const isStr = (x: unknown): x is string => typeof x === 'string' && x.length > 0;
const isL10n = (x: unknown): x is L10n =>
  isStr(x) || (typeof x === 'object' && x != null && Object.values(x as object).some((v) => typeof v === 'string'));
const OPS: BadgeOp[] = ['>=', '>', '<=', '<', '=='];

/** 条件1つの検証（未知のmetric・op・非数値は捨てる） */
function validCondition(c: unknown): c is BadgeCondition {
  if (typeof c !== 'object' || c == null) return false;
  const o = c as Record<string, unknown>;
  if (!(BADGE_METRICS as readonly string[]).includes(String(o.metric))) return false;
  if (o.op != null && !OPS.includes(o.op as BadgeOp)) return false;
  return typeof o.value === 'number' && Number.isFinite(o.value);
}

/** 読み物の検証（壊れた項目は捨てる） */
export function validateReading(x: unknown): RemoteReading | null {
  if (typeof x !== 'object' || x == null) return null;
  const o = x as Record<string, unknown>;
  if (!isStr(o.id) || !isL10n(o.title) || !isL10n(o.body)) return null;
  const sources = Array.isArray(o.sources)
    ? (o.sources as unknown[]).filter((s): s is { label: string; url: string } =>
        typeof s === 'object' && s != null && isStr((s as Record<string, unknown>).label) && isStr((s as Record<string, unknown>).url))
    : [];
  return {
    id: o.id,
    emoji: isStr(o.emoji) ? o.emoji : undefined,
    minutes: typeof o.minutes === 'number' ? o.minutes : undefined,
    publishedAt: isStr(o.publishedAt) ? o.publishedAt : undefined,
    langs: Array.isArray(o.langs) ? (o.langs as unknown[]).filter(isStr) : undefined,
    tags: Array.isArray(o.tags) ? (o.tags as unknown[]).filter(isStr) : undefined,
    title: o.title as L10n,
    lead: isL10n(o.lead) ? (o.lead as L10n) : '',
    body: o.body as L10n,
    sources,
  };
}

/** バッジの検証。条件のどれかが解釈できないバッジは丸ごと捨てる（永久に取れないバッジを見せない） */
export function validateBadge(x: unknown): RemoteBadge | null {
  if (typeof x !== 'object' || x == null) return null;
  const o = x as Record<string, unknown>;
  if (!isStr(o.id) || !isL10n(o.name) || !isL10n(o.desc)) return null;
  if (!['streak', 'action', 'body', 'move'].includes(String(o.cat))) return null;
  const conds = Array.isArray(o.when) ? o.when : [o.when];
  if (conds.length === 0 || !conds.every(validCondition)) return null;
  return {
    id: o.id,
    cat: o.cat as RemoteBadge['cat'],
    icon: isStr(o.icon) ? o.icon : undefined,
    emoji: isStr(o.emoji) ? o.emoji : undefined,
    name: o.name as L10n,
    desc: o.desc as L10n,
    when: conds as BadgeCondition[],
  };
}

/** 法則文言の検証 */
export function validateLawText(x: unknown): RemoteLawText | null {
  if (typeof x !== 'object' || x == null) return null;
  const o = x as Record<string, unknown>;
  if (!isStr(o.id)) return null;
  const out: RemoteLawText = { id: o.id };
  if (isL10n(o.title)) out.title = o.title as L10n;
  if (isL10n(o.sub)) out.sub = o.sub as L10n;
  if (isL10n(o.hint)) out.hint = o.hint as L10n;
  const article = validateLawArticle(o.article);
  if (article) out.article = article;
  if (!out.title && !out.sub && !out.hint && !out.article) return null;
  return out;
}

/** 解説記事の検証。解釈できる節だけ残し、1節も無ければ null。出典は https の URL を持つものだけ */
export function validateLawArticle(x: unknown): RemoteLawArticle | null {
  if (typeof x !== 'object' || x == null) return null;
  const o = x as Record<string, unknown>;
  const out: RemoteLawArticle = {};
  if (isL10n(o.meaning)) out.meaning = o.meaning as L10n;
  if (Array.isArray(o.science)) {
    const paras = o.science.flatMap((p) => {
      if (typeof p !== 'object' || p == null) return [];
      const q = p as Record<string, unknown>;
      if (!isL10n(q.text)) return [];
      const refs = Array.isArray(q.refs) ? q.refs.filter((n): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1) : [];
      return [{ text: q.text as L10n, refs }];
    });
    if (paras.length > 0) out.science = paras;
  }
  if (Array.isArray(o.actions)) {
    const acts = o.actions.filter(isL10n) as L10n[];
    if (acts.length > 0) out.actions = acts;
  }
  // seeDoctor は空文字も「同梱の目安を消す」意図として通す（isL10nは空文字を弾くため別扱い）
  if (o.seeDoctor === '' || isL10n(o.seeDoctor)) out.seeDoctor = o.seeDoctor as L10n;
  if (isL10n(o.caution)) out.caution = o.caution as L10n;
  if (Array.isArray(o.sources)) {
    const srcs = o.sources.flatMap((r) => {
      if (typeof r !== 'object' || r == null) return [];
      const q = r as Record<string, unknown>;
      if (!isStr(q.authors) || !isStr(q.title) || !isStr(q.journal) || !isStr(q.url) || typeof q.year !== 'number') return [];
      if (!/^https:\/\//.test(q.url)) return [];
      return [{ authors: q.authors, title: q.title, journal: q.journal, year: q.year, url: q.url }];
    });
    if (srcs.length > 0) out.sources = srcs;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * バッジ条件DSLの評価。when は単一条件 or AND配列。
 * 未知のmetric（型の外から来た値）は false（＝落ちない・獲得もしない）。
 */
export function evaluateDeclarativeBadge(def: { when?: BadgeCondition | BadgeCondition[] | null }, metrics: BadgeMetrics): boolean {
  if (!def.when) return false;
  const conds = Array.isArray(def.when) ? def.when : [def.when];
  if (conds.length === 0) return false;
  return conds.every((c) => {
    const v = metrics[c.metric];
    if (typeof v !== 'number' || !Number.isFinite(v)) return false;
    switch (c.op ?? '>=') {
      case '>=': return v >= c.value;
      case '>': return v > c.value;
      case '<=': return v <= c.value;
      case '<': return v < c.value;
      case '==': return v === c.value;
      default: return false;
    }
  });
}

/**
 * 「idで統合」の共通規則: base（同梱）に patch（リモート）を重ねる。
 * 同idは上書き（位置は元の場所のまま）、新idは末尾に追加。
 */
export function mergeById<T extends { id: string }>(base: T[], patch: T[]): T[] {
  const out = base.slice();
  const idx = new Map(out.map((x, i) => [x.id, i] as const));
  for (const p of patch) {
    const i = idx.get(p.id);
    if (i == null) { idx.set(p.id, out.length); out.push(p); }
    else out[i] = p;
  }
  return out;
}

/**
 * remote_content の行の集合 → マージ済みの RemoteContent。
 *  ・appVersion < min_app_version の行は無視
 *  ・同kindの複数行は version昇順→published_at昇順に適用（後勝ち・item idで統合）
 *  ・解釈できない項目は捨てる（1件の壊れで全体を止めない）
 */
export function mergeRemoteRows(rows: RemoteRow[] | null | undefined, appVersion: string | null | undefined): RemoteContent {
  const out: RemoteContent = { readings: [], badges: [], lawsText: [] };
  if (!Array.isArray(rows)) return out;
  const usable = rows
    .filter((r) => r && typeof r === 'object' && versionGte(appVersion, r.min_app_version))
    .sort((a, b) => (Number(a.version) || 0) - (Number(b.version) || 0)
      || String(a.published_at ?? '').localeCompare(String(b.published_at ?? '')));
  for (const r of usable) {
    const items = Array.isArray(r.payload?.items) ? r.payload!.items! : [];
    switch (r.kind) {
      case 'readings':
        out.readings = mergeById(out.readings, items.map(validateReading).filter((x): x is RemoteReading => x != null));
        break;
      case 'badges':
        out.badges = mergeById(out.badges, items.map(validateBadge).filter((x): x is RemoteBadge => x != null));
        break;
      case 'laws_text':
        out.lawsText = mergeById(out.lawsText, items.map(validateLawText).filter((x): x is RemoteLawText => x != null));
        break;
      default:
        break;   // 未知のkindは無視（古いアプリに新しい種類が来ても落ちない）
    }
  }
  return out;
}

/** 読み物を「新着が上・日付の無い同梱は下」に並べる（同日・日付無し同士は元の順を保つ） */
export function sortReadingsByDate<T extends { publishedAt?: string }>(items: T[]): T[] {
  return items
    .map((x, i) => ({ x, i }))
    .sort((a, b) => {
      const da = a.x.publishedAt ?? '', db = b.x.publishedAt ?? '';
      if (da !== db) return da > db ? -1 : 1;    // 文字列比較でYYYY-MM-DDの新旧が決まる。'' は最後尾
      return a.i - b.i;
    })
    .map((p) => p.x);
}

/** 「NEW」判定: 公開日から days 日以内（today は 'YYYY-MM-DD'） */
export function isRecent(publishedAt: string | undefined, today: string, days = 30): boolean {
  if (!publishedAt) return false;
  const a = Date.parse(publishedAt + 'T00:00:00'), b = Date.parse(today + 'T00:00:00');
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  const diff = (b - a) / 86400000;
  return diff >= 0 && diff <= days;
}

// ===== 実行時の状態（メモリ＋AsyncStorageキャッシュ） =====

let current: RemoteContent = EMPTY_REMOTE;
let generation = 0;                 // 内容が変わるたびに進む（購読者の再描画キー）
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => { try { l(); } catch { /* 購読者の失敗は他に波及させない */ } });

function setContent(next: RemoteContent): void {
  current = next;
  generation += 1;
  emit();
}

/** いまのリモート内容（同梱との統合は呼び出し側） */
export function getRemoteContent(): RemoteContent { return current; }
/** 内容の世代（変わったら再計算・再描画） */
export function remoteContentGeneration(): number { return generation; }
/** 内容が変わったら呼ばれる（badgeCatOfのキャッシュ破棄など） */
export function onRemoteContentChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
/** 画面用フック: リモート内容が届いたら再描画する */
export function useRemoteContent(): RemoteContent {
  useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    remoteContentGeneration,
    remoteContentGeneration,
  );
  return current;
}

type CacheShape = { fetchedAt: number; rows: RemoteRow[] };

function appVersion(): string | null {
  try { return Application.nativeApplicationVersion ?? null; } catch { return null; }
}

/** キャッシュ（前回取得した行）を読んで反映する。起動直後・未認証でも同梱＋前回ぶんで動く */
export async function loadRemoteContentCache(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(REMOTE_CACHE_KEY);
    if (!raw) return;
    const c = JSON.parse(raw) as CacheShape;
    if (c && Array.isArray(c.rows)) setContent(mergeRemoteRows(c.rows, appVersion()));
  } catch { /* 壊れたキャッシュは無視（次の取得で上書きされる） */ }
}

let inFlight: Promise<boolean> | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

/**
 * remote_content を読んで反映・キャッシュする。失敗時は何もしない（既存の内容を保つ）。
 * 戻り値: 取得に成功したか
 */
export function refreshRemoteContent(): Promise<boolean> {
  if (inFlight) return inFlight;
  const p = (async () => {
    try {
      const { data, error } = await supabase
        .from('remote_content')
        .select('id,kind,version,payload,published_at,min_app_version')
        .order('published_at', { ascending: true })
        .limit(200);
      if (error || !Array.isArray(data)) return false;
      const rows = data as RemoteRow[];
      setContent(mergeRemoteRows(rows, appVersion()));
      try { await AsyncStorage.setItem(REMOTE_CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), rows } satisfies CacheShape)); }
      catch { /* キャッシュできなくても表示は済んでいる */ }
      return true;
    } catch { return false; }
  })();
  inFlight = p;
  p.finally(() => { if (inFlight === p) inFlight = null; });
  return p;
}

/** 認証確立後に呼ぶ: 即時に1回＋24時間ごと（アプリが生きている間） */
export function startRemoteContentSync(): void {
  refreshRemoteContent().catch(() => {});
  if (timer) return;
  timer = setInterval(() => { refreshRemoteContent().catch(() => {}); }, REFRESH_INTERVAL_MS);
}

/** テスト・ログアウト用: メモリ上の内容を空に戻す（キャッシュは消さない） */
export function resetRemoteContentForTest(content: RemoteContent = EMPTY_REMOTE): void {
  setContent(content);
}
