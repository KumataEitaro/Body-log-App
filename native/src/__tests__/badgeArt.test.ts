// メダルの配色導出（lib/badgeArt）。
// テーマ（12アクセント×明暗）のどれでも「4カテゴリが識別でき、質感が揃う」ことを守る。
import { hueOf, hueGap, hsl, parseColor, spreadHues, medalTones, silhouetteTones } from '@/lib/badgeArt';

describe('parseColor / hueOf', () => {
  it('HEXとrgba()の両方を読める', () => {
    expect(parseColor('#059669')).toEqual({ r: 5, g: 150, b: 105 });
    expect(parseColor('rgba(5,150,105,0.3)')).toEqual({ r: 5, g: 150, b: 105 });
    expect(parseColor('まっくろ')).toBeNull();
  });
  it('トークンの色相を取り出す（amber=金色帯・calorieBar=青帯）', () => {
    const gold = hueOf('#b8860b');
    const slate = hueOf('#3f4c5a');
    expect(gold).toBeGreaterThan(30);
    expect(gold).toBeLessThan(55);
    expect(slate).toBeGreaterThan(195);
    expect(slate).toBeLessThan(225);
  });
  it('無彩色は色相を持たない（null）', () => {
    expect(hueOf('#ffffff')).toBeNull();
    expect(hueOf('#808080')).toBeNull();
  });
});

describe('spreadHues（アクセントと衝突したカテゴリだけ押しのける）', () => {
  it('十分離れている希望色相はそのまま', () => {
    expect(spreadHues(162, [36, 223, 271])).toEqual([36, 223, 271]);
  });
  it('アクセントに近い色相は最小角まで離される（オレンジテーマの「継続」）', () => {
    const [streak] = spreadHues(25, [36, 223, 271], 28);
    expect(hueGap(streak, 25)).toBeGreaterThanOrEqual(28);
  });
  it('グラファイト等でアクセントが青寄りでも「体重」が同色にならない', () => {
    const [, body] = spreadHues(215, [36, 223, 271], 28);
    expect(hueGap(body, 215)).toBeGreaterThanOrEqual(28);
  });
  it('アクセントが無彩色（色相なし）なら希望色相のまま', () => {
    expect(spreadHues(null, [36, 223, 271])).toEqual([36, 223, 271]);
  });
});

describe('medalTones / silhouetteTones', () => {
  it('生HEXを作らず rgb() 文字列を返す（テーマ差し替えの置換対象にしない）', () => {
    const m = medalTones(36);
    for (const v of [m.core, m.mid, m.edge, m.rimHi, m.rimLo]) {
      expect(v).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
    }
  });
  it('中心が明るく外周が暗い（立体に見える明度の並び）', () => {
    const lum = (c: string) => {
      const p = parseColor(c)!;
      return 0.299 * p.r + 0.587 * p.g + 0.114 * p.b;
    };
    const m = medalTones(211);
    expect(lum(m.core)).toBeGreaterThan(lum(m.mid));
    expect(lum(m.mid)).toBeGreaterThan(lum(m.edge));
  });
  it('未獲得はテーマトークンそのまま＝無彩色シルエット', () => {
    const sil = silhouetteTones({ chipBg: '#f4f5f3', track: '#eceeeb', line: '#e9eae7', faint: '#9aa1ab' });
    expect(sil.core).toBe('#f4f5f3');
    expect(sil.icon).toBe('#9aa1ab');
    // メダルの彩度を持たない＝ほぼ無彩色（テーマの下地と同じ静けさ。集める余地の見せ方）
    const p = parseColor(sil.mid)!;
    expect(Math.max(p.r, p.g, p.b) - Math.min(p.r, p.g, p.b)).toBeLessThanOrEqual(8);
  });
  it('hslは範囲外の値でも壊れない', () => {
    expect(hsl(400, 2, -1)).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
    expect(hsl(-30, 0.5, 0.5)).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
  });
});
