// 概要タブの詳細ページに入るときの王冠（有料）判定を**1か所に集める**（2026-09-16）。
//
// 事故の形: 判定は `changes.tsx` のメニュー行の中に**べた書き**されていた。
// ところが同じ詳細ページには**もう1つの入口**がある ——「きょうのハイライト」カード。
// そちらには判定が無く、**無料のまま有料の「食べ方の分析」が開けていた**
// （docs/NAV-AUDIT-2026-09-16.md D-07）。
//
// 入口が増えるたびに判定をコピーしていたら、いつかどれかが漏れる。
// 判定をここに置き、**詳細ページへ入る経路は必ずここを通す**。
// 新しい入口を足す人は、この関数を呼ぶ以外の選択肢が無い形にしておく。
import type { GatedFeature } from './gate';

/** 判定の結果。`blocked` なら詳細を開かず、`src` を付けて料金表へ送る */
export type DetailGate =
  /** そのまま開いてよい */
  | { blocked: false; crowned: boolean }
  /** 有料。料金表（/paywall?src=…）へ送る */
  | { blocked: true; crowned: true; src: 'eating' | 'digest' };

/**
 * 概要タブの詳細キーに対する王冠判定。
 *
 * @param key    詳細ページのキー（'eating' / 'week' / 'body' …）
 * @param gated  `useGate().gated`。機能名を渡すと「いまゲートされているか」を返す
 *
 * 「王冠は出すが遷移は止めない」ものがある点に注意（`crowned: true, blocked: false`）:
 *   **週のふりかえり**は、行き先の画面が「見出しと体重変化までは無料・評価文と来週の目標は有料」と
 *   自前でゲートする。ここで蹴ると、ロック中の人が体重変化すら見られなくなる（law-detail と同じ流儀）。
 */
export function detailGate(key: string, gated: (f: GatedFeature) => boolean): DetailGate {
  if (key === 'eating' && gated('eating')) return { blocked: true, crowned: true, src: 'eating' };
  // 週のふりかえりは王冠だけ出して通す（行き先が自前でゲートする）
  if (key === 'week' && gated('digest')) return { blocked: false, crowned: true };
  return { blocked: false, crowned: false };
}

/** 料金表のパス。src は「どこから来たか」の計測に使う（paywall 側が読む） */
export function paywallPath(src: 'eating' | 'digest'): string {
  return `/paywall?src=${src}`;
}
