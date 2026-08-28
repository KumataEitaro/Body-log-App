// バーコード→公式栄養データベース（Open Food Facts）照会
// 方針: 公式値を一次ソースにする。ここでヒットすればAI枠を一切消費しない（端末→OFF直・サーバー経由なし）。
// 未ヒット・欠損・オフラインは null を返し、呼び出し側がAI推定（成分表示写真など）へ案内する。
import AsyncStorage from '@react-native-async-storage/async-storage';

export type DbFood = {
  name: string;                 // 商品名（日本語表記があれば優先）
  brand: string | null;         // ブランド名（先頭1つ）
  per100g: { kcal: number; p: number; f: number; c: number };
  serving: { size: string | null; kcal: number; p: number | null; f: number | null; c: number | null } | null;
  quantityG: number | null;     // 内容量（gに換算できた場合のみ。mlは1g/mlの近似）
};

const round1 = (n: number) => Math.round(n * 10) / 10;

// 数値らしい値だけを number にする（OFFは文字列で返すことがある）
function num(v: unknown): number | null {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

/** 内容量の文字列をgに換算する（"450g"→450, "1kg"→1000, "500 ml"→500, "1.5L"→1500）。
 *  mlは1g/mlの近似（飲料の概算として十分）。読めない表記は null。 */
export function parseQuantityG(quantity: unknown): number | null {
  if (typeof quantity !== 'string') return null;
  const m = quantity.replace(/,/g, '.').match(/(\d+(?:\.\d+)?)\s*(kg|g|l|ml)\b/i);
  if (!m) return null;
  const v = parseFloat(m[1]);
  if (!Number.isFinite(v) || v <= 0) return null;
  const unit = m[2].toLowerCase();
  const g = unit === 'kg' || unit === 'l' ? v * 1000 : v;
  return g > 0 && g < 100000 ? round1(g) : null;
}

/** OFFのproduct JSONをDbFoodに変換する純関数（テスト対象）。
 *  100gあたりの kcal/P/F/C が1つでも欠けていたら null（＝AI推定へフォールバック）。 */
export function parseOffProduct(json: unknown): DbFood | null {
  const root = json as { status?: number; product?: Record<string, unknown> } | null;
  const p = root?.product;
  if (!p || typeof p !== 'object') return null;

  const nut = (p.nutriments ?? {}) as Record<string, unknown>;
  const kcal = num(nut['energy-kcal_100g']);
  const prot = num(nut['proteins_100g']);
  const fat = num(nut['fat_100g']);
  const carb = num(nut['carbohydrates_100g']);
  // 公式値として使うにはエネルギーとPFCが揃っている必要がある（欠けは「公式値なし」扱い）
  if (kcal == null || kcal < 0 || prot == null || fat == null || carb == null) return null;

  const nameJa = typeof p.product_name_ja === 'string' ? p.product_name_ja.trim() : '';
  const nameEn = typeof p.product_name === 'string' ? p.product_name.trim() : '';
  const name = nameJa || nameEn;
  if (!name) return null;   // 名前が無い商品は記録に使えない

  const brandsRaw = typeof p.brands === 'string' ? p.brands : '';
  const brand = brandsRaw.split(',')[0]?.trim() || null;

  // 1食分（serving）はkcalがあるときだけ採用する（サイズ表記のみでは換算できない）
  const svKcal = num(nut['energy-kcal_serving']);
  const serving = svKcal != null && svKcal >= 0 ? {
    size: typeof p.serving_size === 'string' && p.serving_size.trim() ? p.serving_size.trim() : null,
    kcal: round1(svKcal),
    p: num(nut['proteins_serving']),
    f: num(nut['fat_serving']),
    c: num(nut['carbohydrates_serving']),
  } : null;

  return {
    name, brand,
    per100g: { kcal: round1(kcal), p: round1(prot), f: round1(fat), c: round1(carb) },
    serving,
    quantityG: parseQuantityG(p.quantity),
  };
}

/** 内容量1個ぶんのkcal/PFC（内容量が読めた場合のみ）。トレイ投入時の「1個」既定値に使う */
export function packageNutrition(fd: DbFood): { g: number; kcal: number; p: number; f: number; c: number } | null {
  if (fd.quantityG == null) return null;
  const r = fd.quantityG / 100;
  return {
    g: fd.quantityG,
    kcal: round1(fd.per100g.kcal * r), p: round1(fd.per100g.p * r),
    f: round1(fd.per100g.f * r), c: round1(fd.per100g.c * r),
  };
}

// ===== 照会（キャッシュつき） =====
// 同じ商品を何度もスキャンする使い方（毎朝同じプロテイン等）が主なので、
// jan→結果をインメモリ＋AsyncStorageに7日キャッシュして再スキャンを即答にする。
// 未ヒット/通信失敗はキャッシュしない（商品は後からOFFに登録されうるし、圏外を7日覚えるのは不便）。
const CACHE_PREFIX = 'bl-fooddb-';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const memCache = new Map<string, DbFood>();

// OFFの利用マナー: User-Agentでアプリ名と連絡先を名乗る
const UA = 'BodyLog/1.0 (https://bodylog-orcin.vercel.app)';
const TIMEOUT_MS = 5000;

type CacheRow = { t: number; v: DbFood };

/** JANコード（EAN-13/EAN-8）でOpen Food Factsを照会する。
 *  未ヒット・栄養値欠損・オフライン・タイムアウトはすべて null。 */
export async function lookupBarcode(jan: string): Promise<DbFood | null> {
  const code = String(jan).trim();
  if (!/^\d{8}$|^\d{13}$/.test(code)) return null;

  // 1) メモリキャッシュ
  const hit = memCache.get(code);
  if (hit) return hit;

  // 2) AsyncStorageキャッシュ（7日以内なら採用）
  try {
    const raw = await AsyncStorage.getItem(CACHE_PREFIX + code);
    if (raw) {
      const row = JSON.parse(raw) as CacheRow;
      if (row?.v && Date.now() - Number(row.t) < CACHE_TTL_MS) {
        memCache.set(code, row.v);
        return row.v;
      }
    }
  } catch { /* キャッシュ破損は無視してネットへ */ }

  // 3) OFF照会（日本商品も world.openfoodfacts.org の同一エンドポイントで引ける）
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let json: unknown;
    try {
      const res = await fetch(
        `https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=product_name,product_name_ja,brands,nutriments,serving_size,quantity`,
        { headers: { 'User-Agent': UA }, signal: ctrl.signal },
      );
      if (!res.ok) return null;   // 404=未登録商品もここ
      json = await res.json();
    } finally {
      clearTimeout(timer);
    }
    const fd = parseOffProduct(json);
    if (fd) {
      memCache.set(code, fd);
      AsyncStorage.setItem(CACHE_PREFIX + code, JSON.stringify({ t: Date.now(), v: fd } satisfies CacheRow)).catch(() => {});
    }
    return fd;
  } catch {
    return null;   // タイムアウト・圏外・DNS失敗など
  }
}
