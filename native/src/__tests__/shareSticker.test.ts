// 体重変化ステッカー（ShareSticker kind:'weight'）の変化量の向きと色づけ（E1c・2026-09-02）
//  ・表示の符号は数学的な向き（減れば−・増えれば+・0は±）
//  ・「良い方向」は目的で反転する: 減量は減った（<0）が良い、増量（bulk）は増えた（>0）が良い
//  ・点が2つ未満なら描けない（null）
import { weightDelta } from '@/components/ShareSticker';

const pts = (...kg: number[]) => kg.map((k) => ({ kg: k }));

describe('weightDelta（体重ステッカーの変化量）', () => {
  it('減量: 減ったら − で good、増えたら + で good ではない', () => {
    expect(weightDelta(pts(72.4, 71.0, 70.0), false)).toEqual({ delta: -2.4, text: '−2.4', good: true });
    expect(weightDelta(pts(70.0, 71.2), false)).toEqual({ delta: 1.2, text: '+1.2', good: false });
  });
  it('増量（bulk）: 符号はそのまま・良い方向だけ反転する', () => {
    expect(weightDelta(pts(70.0, 71.2), true)).toEqual({ delta: 1.2, text: '+1.2', good: true });
    expect(weightDelta(pts(72.4, 70.0), true)).toEqual({ delta: -2.4, text: '−2.4', good: false });
  });
  it('変化なしは ±0.0 で中立、点が足りなければ null', () => {
    expect(weightDelta(pts(70.0, 70.0), false)).toEqual({ delta: 0, text: '±0.0', good: false });
    expect(weightDelta(pts(70.0, 70.0), true)?.good).toBe(false);
    expect(weightDelta(pts(70.0), false)).toBeNull();
    expect(weightDelta([], true)).toBeNull();
  });
  it('小数第1位に丸める（浮動小数の誤差を表示に出さない）', () => {
    expect(weightDelta(pts(70.15, 69.05), false)?.text).toBe('−1.1');
  });
});
