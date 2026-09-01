// ペイウォールの選択ロジック（2プラン構成・2026-09）。
// βフィードバックの「3つとも選択済みに見える」バグは、カードごとに独立したperiodを
// 持っていたのが原因だった。ここでは「選択はplan×periodの組がただ1つに決まる」ことと、
// 既定がプレミアムの年額になることを固定する。
import { PAYWALL_PLANS, preferredPeriod, defaultSelection, type Offer, type Plan } from '@/lib/purchases';

// テスト用のOffer（価格・pkgは選択ロジックに関係しないのでダミー）
function offer(plan: Plan, period: Offer['period'], price = 1000): Offer {
  return { plan, period, priceString: `¥${price}`, price, currency: 'JPY', trialDays: 0, pkg: null };
}

const FULL: Offer[] = [
  offer('standard', 'monthly', 480), offer('standard', 'annual', 4800),
  offer('premium', 'monthly', 980), offer('premium', 'annual', 9800),
];

describe('ペイウォールに出すプラン', () => {
  it('ライトは新規販売しない（カードに出さない）', () => {
    expect(PAYWALL_PLANS).toEqual(['standard', 'premium']);
    expect(PAYWALL_PLANS).not.toContain('lite');
  });
});

describe('preferredPeriod（そのプランの既定期間）', () => {
  it('年額があれば年額を選ぶ', () => {
    expect(preferredPeriod(FULL, 'premium')).toBe('annual');
    expect(preferredPeriod(FULL, 'standard')).toBe('annual');
  });
  it('年額が無ければ6ヶ月 → 月額の順に落ちる', () => {
    expect(preferredPeriod([offer('premium', 'monthly'), offer('premium', 'sixmonth')], 'premium')).toBe('sixmonth');
    expect(preferredPeriod([offer('premium', 'monthly')], 'premium')).toBe('monthly');
  });
  it('買える期間が無いプランはnull（CTAを無効にできる）', () => {
    expect(preferredPeriod(FULL, 'lite')).toBeNull();
    expect(preferredPeriod([], 'premium')).toBeNull();
  });
});

describe('defaultSelection（画面全体でただ1つの既定選択）', () => {
  it('既定はプレミアムの年額（主役＋年額既定）', () => {
    expect(defaultSelection(FULL)).toEqual({ plan: 'premium', period: 'annual' });
  });
  it('プレミアムが売られていない時だけスタンダードに落ちる', () => {
    const only = FULL.filter((o) => o.plan === 'standard');
    expect(defaultSelection(only)).toEqual({ plan: 'standard', period: 'annual' });
  });
  it('買えるものが無ければnull（準備中表示に落ちる）', () => {
    expect(defaultSelection([])).toBeNull();
  });
  it('選択はplan×periodの組がちょうど1つ（複数プランが同時に選ばれない）', () => {
    const sel = defaultSelection(FULL);
    const hits = FULL.filter((o) => o.plan === sel?.plan && o.period === sel?.period);
    expect(hits).toHaveLength(1);
    // 他プランの同期間オファーは選択に含まれない＝カードをまたいだ二重選択が起きない
    expect(FULL.filter((o) => o.plan !== sel?.plan && o.period === sel?.period).length).toBeGreaterThan(0);
  });
});
