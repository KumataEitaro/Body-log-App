// マイ食品の「よく使う量」まわりのロジック
import AsyncStorage from '@react-native-async-storage/async-storage';
import { qtyNumber, rescaleByQty } from '@/lib/items';

export type MyFoodRow = {
  id: string; name: string; unit: string;
  kcal: number; p: number; f: number; c: number;
  serving_label?: string | null;   // よく使う量の名前（例: 丼1杯）
  serving_ratio?: number | null;   // 基準量に対する倍率（例: 1/6 → 0.1667）
};

// 「1/6」「0.17」「2」などを倍率に変換
export function parseRatio(s: string): number | null {
  const t = String(s ?? '').trim();
  if (!t) return null;
  const m = t.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  if (m) {
    const den = parseFloat(m[2]);
    if (den <= 0) return null;
    return parseFloat(m[1]) / den;
  }
  const v = parseFloat(t);
  return Number.isFinite(v) && v > 0 ? v : null;
}

export type LocalItem = { name: string; qty: string; kcal: number; p: number; f: number; c: number };

/**
 * テキストがマイ食品辞書「だけ」で完全に説明できる場合、AIを呼ばずローカルで品目化する（0秒解析）。
 * 例: 「プロテイン」「プロテイン2回とゆで卵」「野菜鍋×0.5」
 * 辞書で説明できない語（"食べた" や数値・体重など）が残る場合は null を返してAI解析に任せる。
 */
export function matchFoodsLocally(text: string, foods: MyFoodRow[]): LocalItem[] | null {
  const norm = (s: string) => String(s ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
  let rest = norm(text);
  if (!rest) return null;

  const items: LocalItem[] = [];
  const round1 = (n: number) => Math.round(n * 10) / 10;
  // 長い名前から先にマッチ（「プロテインバー」を「プロテイン」より優先）
  const sorted = [...foods].filter((f) => f?.name).sort((a, b) => norm(b.name).length - norm(a.name).length);

  for (const fd of sorted) {
    const n = norm(fd.name);
    if (n.length < 2) continue;
    let idx = rest.indexOf(n);
    while (idx !== -1) {
      // 名前直後の数量表現: ×2 / x2 / 2回 / 2杯 / 2個 / 2つ / 2人前 / 2回分 / 0.5 / 半分
      const after = rest.slice(idx + n.length);
      const m = after.match(/^(?:[×x*]?(\d+(?:\.\d+)?)(?:回分|回|杯|個|つ|人前|倍)?|半分)/);
      let count = 1;
      let consumed = n.length;
      if (m) {
        count = m[0] === '半分' ? 0.5 : parseFloat(m[1]);
        consumed += m[0].length;
      }
      if (!(count > 0 && count <= 20)) { count = 1; consumed = n.length; }
      const sv = servingOf(fd);
      const baseR = fd.serving_ratio != null && Number(fd.serving_ratio) > 0 ? Number(fd.serving_ratio) : 1;
      items.push({
        name: fd.name,
        qty: `×${Math.round(baseR * count * 100) / 100}`, // 1回分の倍率×個数を単一倍率で表示（分量編集の再計算が効く形式）
        kcal: round1(sv.kcal * count), p: round1(sv.p * count), f: round1(sv.f * count), c: round1(sv.c * count),
      });
      rest = rest.slice(0, idx) + rest.slice(idx + consumed);
      idx = rest.indexOf(n);
    }
  }
  if (items.length === 0) return null;
  // 残りが区切り・接続詞だけなら「完全に説明できた」とみなす
  if (!/^[、。,.・+＋&と\s]*$/.test(rest)) return null;
  return items;
}

// ===== 使用頻度によるチップの並び替え（端末内・DB不要） =====
// 単純な累積カウントではなく「半減期つき移動平均」を使う:
// タップで+1点、スコアは14日で半減。毎日使う定番は高スコアを維持し、
// たまたま1回タップした食品（1点）は定番を追い越せず、数週間で自然に沈む。
const FREQ_KEY = 'bl-food-freq-v2';
const HALF_LIFE_DAYS = 14;

export type FreqEntry = { s: number; t: number }; // s=スコア, t=最終更新(epoch ms)

function decayedScore(e: FreqEntry, now: number): number {
  const days = Math.max(0, (now - Number(e.t)) / 86400000);
  return (Number(e.s) || 0) * Math.pow(0.5, days / HALF_LIFE_DAYS);
}

// 保存先は AsyncStorage。
//
// 以前は localStorage を読み書きしていたが、React Native には localStorage が無く、
// アクセスすると例外になる。try/catch で囲まれていたため落ちはしないものの、
// 端末では常に「記録0件」として振る舞い、よく使う順の並びが一切効いていなかった。
//
// 呼び出し側は描画中に同期で読むので、起動時に読み込んだ内容をメモリに持ち、
// 読みはメモリから、書きは非同期で追いかける形にしている。
let freqCache: Record<string, FreqEntry> = {};

/**
 * 起動時に一度呼ぶ。保存内容をそのままキャッシュに反映する。
 * 保存が無い・壊れている場合は空にする（読み込みなのに古い内容が残るほうが紛らわしい）。
 * 実績が消えても並び順が既定に戻るだけで、記録そのものには影響しない。
 */
export async function loadFoodFreq(): Promise<void> {
  let next: Record<string, FreqEntry> = {};
  try {
    const raw = await AsyncStorage.getItem(FREQ_KEY);
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    if (v && typeof v === 'object' && !Array.isArray(v)) next = v as Record<string, FreqEntry>;
  } catch { /* 空にする */ }
  freqCache = next;
}

export function readFoodFreq(): Record<string, FreqEntry> {
  return freqCache;
}

// 現在時点の実効スコア（減衰適用後）に変換する
export function foodScores(freq: Record<string, FreqEntry>, now = Date.now()): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, e] of Object.entries(freq)) out[id] = decayedScore(e, now);
  return out;
}

// チップ使用時に呼ぶ（減衰させてから+1点）
export function bumpFoodFreq(id: string): void {
  const now = Date.now();
  const prev = freqCache[id];
  const score = (prev ? decayedScore(prev, now) : 0) + 1;
  // 先にメモリを更新する。保存が失敗しても、その場の並び順には反映される
  freqCache = { ...freqCache, [id]: { s: Math.round(score * 1000) / 1000, t: now } };
  AsyncStorage.setItem(FREQ_KEY, JSON.stringify(freqCache)).catch(() => {});
}

// 頻度の多い順に並び替え（同数は元の順序を維持＝安定ソート）
export function sortByFreq<T extends { id: string }>(foods: T[], freq: Record<string, number>): T[] {
  return foods
    .map((f, i) => ({ f, i, c: Number(freq[f.id]) || 0 }))
    .sort((a, b) => (b.c - a.c) || (a.i - b.i))
    .map((x) => x.f);
}

function ratioOf(fd: MyFoodRow): number {
  return fd.serving_ratio != null && Number(fd.serving_ratio) > 0 ? Number(fd.serving_ratio) : 1;
}

// チップ連打対応: 同じ食品のチップをもう一度タップしたら、行を増やさず既存行に「1回分」を積み増す。
// 対象は qty が「×倍率」形式の行だけ（gや杯に手編集済みの行は別物として触らない）。無ければ新規追加。
export function addServing(items: LocalItem[], fd: MyFoodRow): LocalItem[] {
  const r = ratioOf(fd);
  const idx = items.findIndex((it) => it.name === fd.name && /^×\d/.test(String(it.qty)));
  if (idx === -1) {
    const sv = servingOf(fd);
    return [...items, { name: fd.name, ...sv }];
  }
  const cur = items[idx];
  const curMult = qtyNumber(cur.qty) ?? 0;
  const newMult = Math.round((curMult + r) * 100) / 100;
  const next = rescaleByQty(cur, `×${newMult}`);
  return items.map((it, i) => (i === idx ? next : it));
}

// チップの「−」: 1回分減らす。1回分未満になったら行ごと削除
export function removeServing(items: LocalItem[], fd: MyFoodRow): LocalItem[] {
  const r = ratioOf(fd);
  const idx = items.findIndex((it) => it.name === fd.name && /^×\d/.test(String(it.qty)));
  if (idx === -1) return items;
  const cur = items[idx];
  const curMult = qtyNumber(cur.qty) ?? 0;
  const newMult = Math.round((curMult - r) * 100) / 100;
  if (newMult < r * 0.5) return items.filter((_, i) => i !== idx); // 実質0回分 → 削除
  return items.map((it, i) => (i === idx ? rescaleByQty(cur, `×${newMult}`) : it));
}

// その食品が今「何回分」入っているか（チップのカウントバッジ用）。未追加ならnull
export function servingCount(items: LocalItem[], fd: MyFoodRow): number | null {
  const it = items.find((x) => x.name === fd.name && /^×\d/.test(String(x.qty)));
  if (!it) return null;
  const mult = qtyNumber(it.qty);
  if (mult == null) return null;
  return Math.round((mult / ratioOf(fd)) * 10) / 10;
}

// チップで追加するときの1回分。
// 登録合計＝基準(×1)とし、serving_ratio（タップ時の量）を掛けた値を返す。
// qtyは「×0.17」形式（分量編集で数値を変えると自動再計算が効く）
export function servingOf(fd: MyFoodRow): { qty: string; kcal: number; p: number; f: number; c: number } {
  const r = fd.serving_ratio != null && Number(fd.serving_ratio) > 0 ? Number(fd.serving_ratio) : 1;
  const round1 = (n: number) => Math.round(n * 10) / 10;
  const rDisp = Math.round(r * 100) / 100;
  return {
    qty: `×${rDisp}`,
    kcal: round1((Number(fd.kcal) || 0) * r),
    p: round1((Number(fd.p) || 0) * r),
    f: round1((Number(fd.f) || 0) * r),
    c: round1((Number(fd.c) || 0) * r),
  };
}
