// 食事の制約（B-18）の端末内判定。docs/DIET-MODES.md §2 の二段構えの①。
//
// 純関数だけを置く（Reactにも通信にも依存しない）。無料プラン・オフライン・AI上限到達でも
// 最低限の警告が出ることが、この機能を安全に配る前提になっている。
//
// ===== 絶対に守ること（§6） =====
// - この関数は「該当した可能性」だけを返す。**該当なしを『安全』として返さない**。
//   該当なしは空配列で表され、呼び出し側は「見落としがある」旨の常設表記を必ず併記する。
// - 断定的な語（安全・OK・〜フリー）をここで作らない。返すのは該当語そのものだけ。
import { DIET_RULES, type DietLevel, type DietModeKey, type DietRule } from '@/content/dietRules';

export type { DietLevel, DietModeKey, DietRule };

/** 判定にかける対象。text には原材料表示・分量などの補助テキストを入れてよい */
export type CheckTarget = { name: string; text?: string | null };

export type DietHit = {
  /** 対象の品目名（入力のまま。表示に使う） */
  name: string;
  /** 警告の強さ。high=黒（含む可能性が高い）/ maybe=灰（製品による） */
  level: DietLevel;
  /** 該当した辞書の語（そのまま画面に出せる短い語。「なぜ出たか」の説明可能性のため） */
  reason: string;
  /** どのプリセットで該当したか */
  mode: DietModeKey;
  /** プリセットの表示名（呼び出し側で t() に通す原文キー） */
  modeLabel: string;
};

// ひらがな→カタカナ（表記ゆれの吸収）。1文字ずつのコードポイント加算で足りる
function kanaFold(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    // U+3041(ぁ)〜U+3096(ゖ) を +0x60 でカタカナ帯へ寄せる
    out += c >= 0x3041 && c <= 0x3096 ? String.fromCodePoint(c + 0x60) : ch;
  }
  return out;
}

/**
 * 判定用の正規化。全角/半角・大文字小文字・ひらがな/カタカナの差を吸収する。
 * 空白は「1個の半角スペース」に畳むだけで消さない（英語の複数語entryを壊さないため）。
 */
export function normalizeForMatch(s: string): string {
  const base = typeof s === 'string' ? s : '';
  let n = base;
  try { n = base.normalize('NFKC'); } catch { /* 環境依存の失敗時は素の文字列で続行 */ }
  return kanaFold(n.toLowerCase()).replace(/\s+/g, ' ').trim();
}

const ASCII_ONLY = /^[\x20-\x7e]+$/;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ASCII語は単語境界で判定する（ham が graham に、egg が eggplant に当たらないように）。
// 正規表現はモジュール内でキャッシュ（辞書は静的なので毎回作る必要がない）
const reCache = new Map<string, RegExp>();
function asciiRe(word: string): RegExp {
  let re = reCache.get(word);
  if (!re) {
    re = new RegExp(`(?:^|[^a-z0-9])${escapeRe(word)}(?:[^a-z0-9]|$)`);
    reCache.set(word, re);
  }
  return re;
}

/**
 * 正規化済みテキストに語が含まれるか。
 * @param spaced 空白を1個に畳んだ正規化テキスト（英語entry用）
 * @param compact 空白を除いた正規化テキスト（日本語entry用。「生 クリーム」を拾うため）
 */
function contains(spaced: string, compact: string, word: string): boolean {
  const w = normalizeForMatch(word);
  if (!w) return false;
  if (ASCII_ONLY.test(w)) return asciiRe(w).test(spaced);
  return compact.includes(w.replace(/\s+/g, ''));
}

/** high が maybe より強い。null は「該当なし」 */
export function stronger(a: DietLevel | null, b: DietLevel | null): DietLevel | null {
  if (a === 'high' || b === 'high') return 'high';
  if (a === 'maybe' || b === 'maybe') return 'maybe';
  return null;
}

/**
 * 1品目を判定する。該当が無ければ null（＝「安全」ではなく「辞書では見つからなかった」）。
 * 複数のプリセットに当たった場合は強い方（high優先）を1件だけ返す。
 * 全ルールの high を先に見てから maybe を見るので、
 * 「1つ目のプリセットの灰」より「2つ目のプリセットの黒」が勝つ。
 */
export function checkOne(target: CheckTarget, rules: readonly DietRule[]): DietHit | null {
  if (!target || typeof target.name !== 'string') return null;
  const raw = `${target.name} ${target.text ?? ''}`;
  const spaced = normalizeForMatch(raw);
  if (!spaced) return null;
  const compact = spaced.replace(/\s+/g, '');

  for (const level of ['high', 'maybe'] as const) {
    for (const rule of rules) {
      for (const word of level === 'high' ? rule.high : rule.maybe) {
        if (contains(spaced, compact, word)) {
          return { name: target.name, level, reason: word, mode: rule.key, modeLabel: rule.label };
        }
      }
    }
  }
  return null;
}

/**
 * 品目リストを判定する（docs/DIET-MODES.md §2 の主入口）。
 * 1品目につき最大1件。該当が無い品目は結果に入らない＝空配列は「該当語が見つからなかった」
 * という意味でしかなく、対象を含まないことの保証ではない。
 */
export function checkItems(items: readonly CheckTarget[], rules: readonly DietRule[]): DietHit[] {
  if (!Array.isArray(items) || !Array.isArray(rules) || rules.length === 0) return [];
  const out: DietHit[] = [];
  for (const it of items) {
    const hit = checkOne(it, rules);
    if (hit) out.push(hit);
  }
  return out;
}

/**
 * 画面に出す1件の警告。辞書由来（mode/reasonあり）とAI由来（写真から読み取ったもの）を
 * 同じ形で扱うための型。「該当なし」はこの配列に入らないことで表す。
 */
export type DietAlert = {
  name: string;
  level: DietLevel;
  /** 辞書で当たった語。AI由来の判定では空文字（AIに理由を語らせない＝断定の余地を作らない） */
  reason: string;
  /** 辞書で当たったプリセット。AI由来では undefined */
  mode?: DietModeKey;
  source: 'dict' | 'ai';
};

/**
 * 二段構え（§2）の合成。品目ごとに「端末内の辞書判定」と「AIのdietFlag」の強い方を採る。
 *
 * - 無料プラン（premium=false）は辞書の黒だけ（AI判定は捨て、灰も出さない・§4）
 * - AI判定が辞書より強い場合は source:'ai' として出す（写真から原材料を読めた場合など）
 * - どちらも該当なしの品目は結果に入らない＝沈黙は保証ではない（§6-4の常設表記で補う）
 */
export function mergeAlerts(input: {
  items: readonly CheckTarget[];
  rules: readonly DietRule[];
  /** 品目名 → AIのdietFlag（high/maybe のみ） */
  aiFlags?: Readonly<Record<string, DietLevel>>;
  premium: boolean;
}): DietAlert[] {
  const { items, rules, aiFlags, premium } = input;
  if (!Array.isArray(items)) return [];
  const out: DietAlert[] = [];
  for (const it of items) {
    if (!it || typeof it.name !== 'string') continue;
    const dict = checkOne(it, rules);
    const ai = premium ? levelFromAiFlag(aiFlags?.[it.name]) : null;
    const level = stronger(dict?.level ?? null, ai);
    if (!level) continue;
    if (!premium && level !== 'high') continue;   // 無料は黒だけ
    if (dict && dict.level === level) {
      out.push({ name: dict.name, level, reason: dict.reason, mode: dict.mode, source: 'dict' });
    } else {
      out.push({ name: it.name, level, reason: '', source: 'ai' });
    }
  }
  return out;
}

/** AIが返した dietFlag を型に落とす（未知値・none は null＝該当なし扱い） */
export function levelFromAiFlag(v: unknown): DietLevel | null {
  return v === 'high' ? 'high' : v === 'maybe' ? 'maybe' : null;
}

/**
 * 無料プランで見せていい判定に絞る（docs/DIET-MODES.md §4）。
 * 無料 = 端末内辞書の黒だけ。灰とAI判定はスタンダード以上。
 * 「最低限の保護は無料に置く」ための関数で、逆に無料から黒を隠してはいけない。
 */
export function visibleHits(hits: readonly DietHit[], premium: boolean): DietHit[] {
  if (!Array.isArray(hits)) return [];
  return premium ? [...hits] : hits.filter((h) => h.level === 'high');
}

/** 一覧の中でいちばん強い判定（トレイ上部の警告行の色を決めるのに使う） */
export function topLevel(hits: readonly DietHit[]): DietLevel | null {
  let lv: DietLevel | null = null;
  for (const h of hits) lv = stronger(lv, h.level);
  return lv;
}

/** 有効キー配列 → ルール配列（辞書側の実装をそのまま使う） */
export { rulesFor, ruleOf } from '@/content/dietRules';

/** プリセット全部（設定画面用） */
export { DIET_RULES };
