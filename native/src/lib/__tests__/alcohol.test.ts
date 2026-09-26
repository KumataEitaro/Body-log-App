// お酒の自動推定（lib/alcohol.ts・過食アラート v2）
import { looksAlcoholic } from '../alcohol';

describe('looksAlcoholic', () => {
  it('お酒らしい品目名があれば true', () => {
    expect(looksAlcoholic([{ name: '生ビール 中ジョッキ' }])).toBe(true);
    expect(looksAlcoholic([{ name: 'ハイボール' }, { name: '枝豆' }])).toBe(true);
    expect(looksAlcoholic([{ name: '赤ワイン 1杯' }])).toBe(true);
    expect(looksAlcoholic([{ name: 'Beer 350ml' }])).toBe(true);
    expect(looksAlcoholic([{ name: 'gin tonic' }])).toBe(true);
  });

  it('ノンアル・調理用・食材の語は数えない', () => {
    expect(looksAlcoholic([{ name: 'ノンアルコールビール' }])).toBe(false);
    expect(looksAlcoholic([{ name: '甘酒' }])).toBe(false);
    expect(looksAlcoholic([{ name: '鶏の酒蒸し' }])).toBe(false);
    expect(looksAlcoholic([{ name: 'ジンジャーエール' }])).toBe(false);
    expect(looksAlcoholic([{ name: 'サワークリーム' }])).toBe(false);
    expect(looksAlcoholic([{ name: 'ワインビネガーのサラダ' }])).toBe(false);
  });

  it('空・欠損は false', () => {
    expect(looksAlcoholic([])).toBe(false);
    expect(looksAlcoholic(null)).toBe(false);
    expect(looksAlcoholic([{ name: '' }, { name: null }])).toBe(false);
  });
});
