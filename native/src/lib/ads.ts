// 広告枠（AdSlot）の純関数。表示可否と「畳んで消える」状態遷移をここに閉じ込め、
// UI（components/AdSlot.tsx）は描画とアニメだけを担う。jestで挙動を固定する。
//
// 方針（docs/ADS.md）:
// - 1画面に最大1枠。アンカー型アダプティブバナーのみ（インタースティシャル・リワード不使用）
// - 表示は「課金基盤が有効なビルド（active）× 無料プラン（plan が null/'free'）」のときだけ
// - 課金が通った瞬間は、枠を高さアニメで畳んでから unmount する（レイアウトが跳ねない）
// - 読み込み前は高さを確保しない（空白の枠を見せない）ので、読み込み前に課金されたら即 unmount

/** 広告枠の設置場所。計測・将来のユニット出し分けに使う（現在は全枠で同一ユニットID） */
export type AdPlacement = 'log' | 'training' | 'coach' | 'changes';
export const AD_PLACEMENTS: readonly AdPlacement[] = ['log', 'training', 'coach', 'changes'];

/** 畳むアニメの長さ（ms）。180ms・easeOut＝「消えた」と気づく最短の長さ */
export const AD_COLLAPSE_MS = 180;

/**
 * この端末・このプランで広告を出すべきか。
 * active=false（RCキー未設定ビルド）では誰にも出さない＝「広告なし」を売る前に広告を見せない。
 * plan は null（未取得・未設定）も無料扱い。lite/standard/premium は広告なし
 * （既存ライト購入者は降格させない＝ライトにも出さない）。
 */
export function shouldShowAd(active: boolean, plan: string | null | undefined): boolean {
  if (!active) return false;
  return plan == null || plan === 'free';
}

/**
 * 枠の状態。
 * - hidden: 何も描かない（高さ0）
 * - loading: BannerAd をマウントして読み込み中。高さはまだ確保しない（ラベル非表示）
 * - shown: 読み込み完了。ラベル＋導線＋バナーが見えている
 * - collapsing: 課金完了などで消える途中（高さアニメ中。終わったら hidden）
 */
export type AdSlotState = 'hidden' | 'loading' | 'shown' | 'collapsing';

/**
 * 枠に起きる出来事。
 * - eligible / ineligible: shouldShowAd の結果が変わった（課金完了は ineligible）
 * - loaded / failed: AdMob SDK のコールバック
 * - collapsed: 畳むアニメが終わった
 */
export type AdSlotEvent = 'eligible' | 'ineligible' | 'loaded' | 'failed' | 'collapsed';

/** 状態遷移（純関数）。想定外の組は現状維持＝落とさない */
export function nextAdSlotState(state: AdSlotState, ev: AdSlotEvent): AdSlotState {
  switch (state) {
    case 'hidden':
      return ev === 'eligible' ? 'loading' : 'hidden';
    case 'loading':
      if (ev === 'loaded') return 'shown';
      // 読み込み前に消える理由が出たら、高さを持っていないので即 hidden（畳む対象がない）
      if (ev === 'failed' || ev === 'ineligible') return 'hidden';
      return 'loading';
    case 'shown':
      // 見えている枠が消えるときだけ畳む（課金完了・再読み込み失敗）
      if (ev === 'ineligible' || ev === 'failed') return 'collapsing';
      return 'shown';
    case 'collapsing':
      if (ev === 'collapsed') return 'hidden';
      // 畳んでいる最中に再び対象になった（復元の取り消し等・実運用ではほぼ無い）→ 読み込みからやり直す
      if (ev === 'eligible') return 'loading';
      return 'collapsing';
    default:
      return state;
  }
}

/** この状態で BannerAd をマウントしておくべきか（collapsing 中はアニメのため残す） */
export function bannerMounted(state: AdSlotState): boolean {
  return state !== 'hidden';
}
