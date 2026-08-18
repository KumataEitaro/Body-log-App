// テーマ切替: アクセントだけでなく背景・罫線まで変わり、既存スタイルにも遡って反映されること
import { StyleSheet } from 'react-native';
import { C, applyPalette } from '@/lib/ui';
import { PALETTES, pfcColors } from '@/lib/theme';

describe('テーマ', () => {
  it('パレット適用で背景・罫線・アクセントがまとめて変わる', () => {
    applyPalette(PALETTES.green); // 既定に戻してから
    expect(C.teal).toBe('#059669');
    applyPalette(PALETTES.blue);
    expect(C.teal).toBe('#2563eb');
    expect(C.bg).toBe('#fafbfd');    // 背景も青寄りに
    expect(C.line).toBe('#e5e9f0');  // 罫線も
    applyPalette(PALETTES.green);
    expect(C.bg).toBe('#fbfbfa');
  });

  it('StyleSheetで作った色も遡って書き換わる（再起動不要）', () => {
    applyPalette(PALETTES.green);
    const s = StyleSheet.create({
      card: { backgroundColor: C.panel, borderColor: C.line },
      btn: { backgroundColor: C.teal },
    }) as unknown as Record<string, Record<string, string>>;
    expect(s.btn.backgroundColor).toBe('#059669');

    applyPalette(PALETTES.purple);
    expect(s.btn.backgroundColor).toBe('#7c3aed');
    expect(s.card.borderColor).toBe('#ebe6f0');

    applyPalette(PALETTES.green); // 後続テストのため戻す
  });

  it('P/F/Cの配色はテーマとは独立している', () => {
    const before = pfcColors('classic');
    applyPalette(PALETTES.pink);
    expect(pfcColors('classic')).toEqual(before); // テーマを変えてもPFCは不変
    expect(pfcColors('accessible').p).toBe('#0072b2');
    applyPalette(PALETTES.green);
  });

  it('全テーマがパレットの全キーを持つ', () => {
    const keys = Object.keys(PALETTES.green);
    for (const p of Object.values(PALETTES)) {
      expect(Object.keys(p).sort()).toEqual(keys.sort());
    }
  });
});
