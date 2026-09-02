// 「何を食べる？」（食事タブ内のAI相談）の純関数群。
//
// 熊田さんの要望:「何を食べようか悩んだときにAI相談ページに行かないといけないのは楽じゃない。
// 同じ画面（食事記録の画面）でやりたい。献立考えたいな、コンビニで何買おうかな、とか」。
//
// この層はUI（components/WhatToEatSheet.tsx）とAPI（/api/what-to-eat）の間に立つ判断だけを持つ:
//   ・文脈チップ → プロンプト型（サーバーの3型 item/menu/snack のどれで考えさせるか）
//   ・残量 → 1行の制約文（「残り620kcal・P残り40g」）
//   ・提案JSONの検証（3案・数値範囲・dietFlagの白リスト）
//   ・直近3日の食材タグの要約（偏り回避のヒント）とマイ食品の上位名（「いつものあれ」）
// すべて副作用なし。jest（__tests__/whatToEat.test.ts）で守る。
import { t } from '@/lib/i18n';
import { sumTagGrams, FOOD_TAGS, type FoodTag } from '@/content/foodTags';
import { sortByFreq } from '@/lib/foods';

/** 文脈チップ。並びは表示順（悩む頻度が高い順に左から） */
export const EAT_CONTEXTS = ['convenience', 'eatout', 'cook', 'snack', 'quick'] as const;
export type EatContext = (typeof EAT_CONTEXTS)[number];

/**
 * サーバーのプロンプト型。文脈5つを3型に畳む:
 *   item  = すぐ買える／頼める「一品」（コンビニ・外食・時間がない）
 *   menu  = 主菜＋副菜＋主食の「献立」（自炊）
 *   snack = 200kcal以内の「間食」
 * 文脈そのものも一緒に送り、サーバー側で店の種類（コンビニの商品カテゴリ／外食の定食）の補足行を足す
 */
export type EatPromptKind = 'item' | 'menu' | 'snack';

export function promptKindOf(ctx: EatContext): EatPromptKind {
  switch (ctx) {
    case 'cook': return 'menu';
    case 'snack': return 'snack';
    default: return 'item';
  }
}

/** チップの表示名 */
export function contextLabel(ctx: EatContext): string {
  switch (ctx) {
    case 'convenience': return t('コンビニ');
    case 'eatout': return t('外食');
    case 'cook': return t('自炊（献立）');
    case 'snack': return t('間食');
    case 'quick': return t('時間がない');
  }
}

/** 一言入力のプレースホルダ（文脈ごとに例を変え、何を書けばよいか迷わせない） */
export function contextHint(ctx: EatContext): string {
  switch (ctx) {
    case 'convenience': return t('例: 温かいもの・安く・魚がいい');
    case 'eatout': return t('例: 定食屋・ラーメン以外・軽め');
    case 'cook': return t('例: 冷蔵庫に卵とキャベツ・20分で');
    case 'snack': return t('例: 甘いもの・しょっぱいもの');
    case 'quick': return t('例: 5分で・レンジだけ');
  }
}

/** 一言入力の最大文字数（APIも同じ値で切る） */
export const EAT_NOTE_MAX = 80;

// ===== 残量 → 制約文 =====

export type Remaining = {
  /** 残りkcal（マイナス=すでに超過） */
  kcal: number;
  /** 残りたんぱく質g（未計算ならnull） */
  p: number | null;
  /** 残り脂質g */
  f: number | null;
  /** 残り炭水化物g */
  c: number | null;
};

/**
 * シート上部の1行。「残り620kcal・P残り40g・F残り12g・C残り80g」。
 * 超過中は「620kcal超過」と言い切り、PFCは残っている栄養素だけ添える（マイナスのgは出さない＝責め色を作らない）
 */
export function remainingLine(r: Remaining): string {
  const k = Math.round(r.kcal);
  const head = k < 0
    ? t('{n}kcal超過', { n: Math.abs(k).toLocaleString() })
    : t('残り{n}kcal', { n: k.toLocaleString() });
  const parts: string[] = [head];
  const g = (label: string, v: number | null) => {
    if (v == null) return;
    const n = Math.round(v);
    if (n > 0) parts.push(t('{l}残り{n}g', { l: label, n }));
  };
  g('P', r.p); g('F', r.f); g('C', r.c);
  return parts.join('・');   // 区切りの中黒は全言語で共通（翻訳キーにしない）
}

// ===== 提案JSONの検証 =====

export type EatPick = {
  name: string;
  estKcal: number;
  p: number;
  f: number;
  c: number;
  /** 選ぶ理由（1文・非審判） */
  reason: string;
  /** 食事の制約（B-18）に該当する可能性。該当なしはキーごと無し */
  dietFlag?: 'high' | 'maybe';
};

export type EatProposal = { picks: EatPick[]; note: string };

/** 提案は3案（サーバーにもこの数を要求する） */
export const PICK_TARGET = 3;

const KCAL_MAX = 3000;   // 1案の上限。これを超える値は推定の暴走とみなして案ごと落とす
const GRAM_MAX = 500;    // P/F/Cの上限g

function num(v: unknown, max: number): number | null {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 0 || n > max) return null;
  return n;
}

/**
 * APIの応答（何が入っていてもよい）→ 表示できる提案。
 * 型崩れ・範囲外の案は**その案だけ**落とし、1案も残らなければ null（呼び出し側は「もう一度」を出す）。
 * 3案を超える分は捨てる（プロンプトの指示を超えた出力を画面に流さない）。
 */
export function validateProposal(v: unknown): EatProposal | null {
  if (v == null || typeof v !== 'object') return null;
  const raw = (v as { picks?: unknown; note?: unknown });
  if (!Array.isArray(raw.picks)) return null;
  const picks: EatPick[] = [];
  for (const p of raw.picks) {
    if (p == null || typeof p !== 'object') continue;
    const o = p as Record<string, unknown>;
    const name = String(o.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
    const estKcal = num(o.estKcal, KCAL_MAX);
    const pg = num(o.p, GRAM_MAX);
    const fg = num(o.f, GRAM_MAX);
    const cg = num(o.c, GRAM_MAX);
    if (!name || estKcal == null || pg == null || fg == null || cg == null) continue;
    const reason = String(o.reason ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
    const pick: EatPick = { name, estKcal, p: pg, f: fg, c: cg, reason };
    // 安全側の値だけ通す。"none"・未知値はキーごと落として「該当なし」（DIET-MODES.md §6）
    if (o.dietFlag === 'high' || o.dietFlag === 'maybe') pick.dietFlag = o.dietFlag;
    picks.push(pick);
    if (picks.length >= PICK_TARGET) break;
  }
  if (picks.length === 0) return null;
  const note = String(raw.note ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
  return { picks, note };
}

// ===== 直近3日の食材タグ（偏り回避） =====

/** タグ→プロンプトに書く日本語（サーバーのプロンプトは日本語で組むため、ここで文字列化してよい） */
const TAG_NAME: Record<FoodTag, string> = {
  wheat: '小麦（パン・麺）', rice: '米', chicken: '鶏肉', salmon: '鮭', fish: '魚', dairy: '乳製品', sugar_drink: '甘い飲み物',
};

/**
 * 直近の品目 → 「米: 約540g・鶏肉: 約300g」のような要約（多い順・上位3タグ・0gは出さない）。
 * 品目が無ければ空文字（プロンプトに行を足さない）。サーバーはこれを「偏り回避のヒント」として使う。
 */
export function recentTagSummary(items: { name?: string | null; qty?: string | null }[], top = 3): string {
  if (!items.length) return '';
  const grams = sumTagGrams(items);
  // 鮭は魚にも数えられる（tagsOf の仕様）ので、鮭が主役のときは魚の行を落として二重に見せない
  const entries = FOOD_TAGS
    .map((tag) => [tag, Math.round(grams[tag] ?? 0)] as const)
    .filter(([, g]) => g > 0)
    .sort((a, b) => b[1] - a[1]);
  const seen: Array<readonly [FoodTag, number]> = [];
  for (const e of entries) {
    if (e[0] === 'fish' && entries.some(([tg, g]) => tg === 'salmon' && g >= e[1])) continue;
    seen.push(e);
    if (seen.length >= top) break;
  }
  return seen.map(([tag, g]) => `${TAG_NAME[tag]}: 約${g.toLocaleString()}g`).join('・');
}

// ===== マイ食品の上位名（「いつものあれ」） =====

/**
 * マイ食品を使用頻度順に並べ、名前の上位n件を返す（重複名は1つに）。
 * 頻度の正本は lib/foods.ts の減衰スコア（readFoodFreq→foodScores）。scoresが空なら登録順のまま。
 */
export function topMyFoodNames(foods: { id: string; name: string }[], scores: Record<string, number>, n = 10): string[] {
  const out: string[] = [];
  for (const f of sortByFreq(foods, scores)) {
    const name = String(f.name ?? '').trim();
    if (!name || out.includes(name)) continue;
    out.push(name.slice(0, 40));
    if (out.length >= n) break;
  }
  return out;
}

// ===== 無料プラン向けの見本（機能の存在を見せる・静的） =====

/**
 * 「スタンダードで使えます」の下に1件だけ出す見本。
 * 数値はごく一般的な概算で、本人の残量には連動しない（見本であることを文言で明示する）
 */
export function sampleProposal(ctx: EatContext): EatPick {
  switch (ctx) {
    case 'convenience':
      return { name: t('サラダチキン＋鮭おにぎり'), estKcal: 290, p: 28, f: 4, c: 38, reason: t('たんぱく質をしっかり取りつつ、残りにゆとりが残ります。') };
    case 'eatout':
      return { name: t('焼き魚定食（ごはん少なめ）'), estKcal: 520, p: 32, f: 16, c: 58, reason: t('主菜でたんぱく質、ごはん少なめで残りに収まります。') };
    case 'cook':
      return { name: t('鶏むねの照り焼き・ほうれん草のおひたし・ごはん150g'), estKcal: 560, p: 42, f: 9, c: 70, reason: t('主菜・副菜・主食がそろい、20分で作れます。') };
    case 'snack':
      return { name: t('ギリシャヨーグルト＋バナナ半分'), estKcal: 150, p: 10, f: 0, c: 24, reason: t('200kcal以内で、小腹と甘いもの欲を同時に満たせます。') };
    case 'quick':
      return { name: t('ゆで卵2個＋バナナ'), estKcal: 240, p: 14, f: 10, c: 27, reason: t('買ってそのまま食べられて、たんぱく質も確保できます。') };
  }
}
