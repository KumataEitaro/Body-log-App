// 広告枠（AdSlot）の純関数: 表示可否と「畳んで消える」状態遷移。
// 課金した人に広告が残る／無料の人に広告が出ない、の両方が売り物の実体なので式を固定する。
import { shouldShowAd, nextAdSlotState, bannerMounted, AD_COLLAPSE_MS, AD_PLACEMENTS, type AdSlotState, type AdSlotEvent } from '../ads';
import { higherPlan, planRank } from '../purchases';

describe('shouldShowAd（active × plan）', () => {
  it('課金基盤が無効なビルド（RCキー未設定）では誰にも出さない', () => {
    expect(shouldShowAd(false, null)).toBe(false);
    expect(shouldShowAd(false, 'free')).toBe(false);
    expect(shouldShowAd(false, 'premium')).toBe(false);
  });
  it('有効ビルド × 無料（null/free）で出す', () => {
    expect(shouldShowAd(true, null)).toBe(true);
    expect(shouldShowAd(true, undefined)).toBe(true);
    expect(shouldShowAd(true, 'free')).toBe(true);
  });
  it('有効ビルド × 有料（lite/standard/premium）では出さない（既存ライト購入者にも出さない）', () => {
    expect(shouldShowAd(true, 'lite')).toBe(false);
    expect(shouldShowAd(true, 'standard')).toBe(false);
    expect(shouldShowAd(true, 'premium')).toBe(false);
  });
});

// 起こる順に流して最終状態を見る
function run(events: AdSlotEvent[], from: AdSlotState = 'hidden'): AdSlotState {
  return events.reduce((s, e) => nextAdSlotState(s, e), from);
}

describe('nextAdSlotState（畳んで消える状態遷移）', () => {
  it('無料ユーザー: hidden → eligible → loading → loaded → shown', () => {
    expect(run(['eligible'])).toBe('loading');
    expect(run(['eligible', 'loaded'])).toBe('shown');
  });
  it('表示中に課金完了（ineligible）→ collapsing（畳むアニメ）→ collapsed → hidden', () => {
    expect(run(['eligible', 'loaded', 'ineligible'])).toBe('collapsing');
    expect(run(['eligible', 'loaded', 'ineligible', 'collapsed'])).toBe('hidden');
  });
  it('読み込み前に課金完了 → 畳む対象が無いので即 hidden（高さ0のまま）', () => {
    expect(run(['eligible', 'ineligible'])).toBe('hidden');
  });
  it('読み込み失敗 → 即 hidden（空白の枠を見せない）。表示後の再読み込み失敗は畳んで消す', () => {
    expect(run(['eligible', 'failed'])).toBe('hidden');
    expect(run(['eligible', 'loaded', 'failed'])).toBe('collapsing');
  });
  it('有料ユーザー: hidden のまま何も起きない（ineligible/loaded/failed/collapsed は無視）', () => {
    expect(run(['ineligible'])).toBe('hidden');
    expect(run(['loaded'])).toBe('hidden');
    expect(run(['failed'])).toBe('hidden');
    expect(run(['collapsed'])).toBe('hidden');
  });
  it('shown 中の eligible/loaded/collapsed は現状維持（二重読み込みしない）', () => {
    expect(run(['eligible', 'loaded', 'eligible'])).toBe('shown');
    expect(run(['eligible', 'loaded', 'loaded'])).toBe('shown');
    expect(run(['eligible', 'loaded', 'collapsed'])).toBe('shown');
  });
  it('畳んでいる最中に再び対象になったら読み込みからやり直す（loading）', () => {
    expect(run(['eligible', 'loaded', 'ineligible', 'eligible'])).toBe('loading');
  });
  it('bannerMounted: hidden 以外は BannerAd をマウントしたまま（collapsing 中もアニメのため残す）', () => {
    expect(bannerMounted('hidden')).toBe(false);
    expect(bannerMounted('loading')).toBe(true);
    expect(bannerMounted('shown')).toBe(true);
    expect(bannerMounted('collapsing')).toBe(true);
  });
  it('定数: 畳むアニメは180ms・枠は4タブぶん', () => {
    expect(AD_COLLAPSE_MS).toBe(180);
    expect([...AD_PLACEMENTS]).toEqual(['log', 'training', 'coach', 'changes']);
  });
});

describe('higherPlan（サーバーplanと端末entitlementの強い方）', () => {
  it('free/null/未知は0、lite<standard<premium', () => {
    expect(planRank(null)).toBe(0);
    expect(planRank('free')).toBe(0);
    expect(planRank('unknown')).toBe(0);
    expect(planRank('lite')).toBeLessThan(planRank('standard'));
    expect(planRank('standard')).toBeLessThan(planRank('premium'));
  });
  it('購入直後: サーバー未着（null/free）でも端末の standard を採る', () => {
    expect(higherPlan(null, 'standard')).toBe('standard');
    expect(higherPlan('free', 'premium')).toBe('premium');
  });
  it('同格・端末が弱いときはサーバー値（正本）を残す', () => {
    expect(higherPlan('premium', 'standard')).toBe('premium');
    expect(higherPlan('standard', 'standard')).toBe('standard');
    expect(higherPlan(null, null)).toBeNull();
    expect(higherPlan(null, 'free')).toBeNull();
  });
});
