// お酒の自動推定（過食アラート v2・docs/BINGE-PREVENTION-RESEARCH-2026-09-25.md §6-4）
//
// 食事を保存するとき、品目名にお酒らしい語があれば logs.alcohol を自動で立てる（lib/quicklog.ts）。
// 手入力ほぼ不要にするための推定であって判定ではない。外れたら記録行の長押しで直せる。
// 純関数（テスト: lib/__tests__/alcohol.test.ts）
//
// 誤検出を避けるための除外:
//  ・ノンアルコール／アルコールフリー／0.00%
//  ・甘酒・酒粕・酒蒸し・料理酒（調理用。飲酒ではない）
//  ・ジンジャー（ジンではない）・サワークリーム／ワインビネガー（食材）
const POSITIVE = /(ビール|発泡酒|生ビ|ハイボール|チューハイ|酎ハイ|サワー|日本酒|清酒|地酒|焼酎|ウイスキー|ウィスキー|ワイン|シャンパン|スパークリング|カクテル|梅酒|果実酒|マッコリ|紹興酒|ジン(?!ジャー|ギス)|ウォッカ|テキーラ|ラム酒|ブランデー|お酒|\bbeer\b|\bwine\b|whisk(?:e)?y|highball|\bsake\b|shochu|cocktail|vodka|tequila|\bgin\b|\brum\b|champagne|prosecco|liquor|alcohol)/i;
const NEGATIVE = /(ノンアル|アルコールフリー|0\.00\s*%|甘酒|酒粕|酒蒸し|料理酒|ビネガー|サワークリーム|non-?alcoholic|alcohol[- ]free)/i;

/** 品目名の1つでもお酒らしければ true（除外語を含む品目は数えない） */
export function looksAlcoholic(items: readonly { name?: string | null }[] | null | undefined): boolean {
  for (const it of items ?? []) {
    const name = String(it?.name ?? '').trim();
    if (!name) continue;
    if (NEGATIVE.test(name)) continue;
    if (POSITIVE.test(name)) return true;
  }
  return false;
}
