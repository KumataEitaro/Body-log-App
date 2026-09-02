// 記録行のタイポグラフィ（2026-09-02・βフィードバック「材料そのものと量、PFCの視認性を上げて」）
//
// 「今日の記録」のフィード行・展開した品目行・「前の食事をもう一度」・入力シートのトレイ品目行は
// どれも「品名＋量／P・F・C／kcal」の同じ情報を持つのに、太さや色がばらばらで、とくに
// **品名と量が同じ太さで一塊に見える**・**PFCのラベルと数値の区別が付かない**・**kcalの桁が揃わない**
// という3点が読みにくさの原因だった。ここに1か所だけ定義し、4か所すべてで共用する。
//
// 階層の設計（ライト／ダークで同じ階層が出るよう色は C.ink / C.sub だけで組む）:
//   品名   15px / 700 / C.ink      … 行の主役。1行で末尾を省略（…）
//   量     12.5px / 600 / C.sub    … 品名と同じ行だが一段細く・薄く、半角スペースで離す
//   P/F/C  ラベル 11px / 800 / 各栄養素の色、数値 13px / 700 / C.ink・等幅数字。
//          ラベルと数値の間 2px、P・F・C の組の間 8px（詰まると「P20F10C80」に見える）
//   kcal   15px / 800 / C.ink・右寄せ・幅を4桁ぶん固定（「1,234」が並んでも桁がずれない）
import { Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { C, themed } from '@/lib/ui';
import { pfcColors } from '@/lib/theme';
import type { FoodItem } from '@/lib/items';
import { t } from '@/lib/i18n';

/** 「×1」は既定量なので表示しない（トレイ・フィードで共通の判断） */
export function showQty(qty: string | null | undefined): string | null {
  return qty && qty !== '×1' ? qty : null;
}

/** 品名＋量（1行・末尾省略）。量は一段細く薄い */
export function FoodName({ name, qty, style }: { name: string; qty?: string | null; style?: StyleProp<TextStyle> }) {
  const q = showQty(qty);
  return (
    <Text style={[s.name, style]} numberOfLines={1} ellipsizeMode="tail">
      {name}
      {q ? <Text style={s.qty}> {q}</Text> : null}
    </Text>
  );
}

/** 複数品目の見出し（フィード行用）。先頭3品を「、」で繋ぎ、残りは「ほか{n}品」 */
export function ItemsTitle({ items, lines = 2 }: { items: FoodItem[]; lines?: number }) {
  const head = items.slice(0, 3);
  const rest = items.length - head.length;
  return (
    <Text style={s.name} numberOfLines={lines} ellipsizeMode="tail">
      {head.map((it, i) => {
        const q = showQty(it.qty);
        return (
          <Text key={i}>
            {i > 0 ? '、' : ''}{it.name}
            {q ? <Text style={s.qty}> {q}</Text> : null}
          </Text>
        );
      })}
      {rest > 0 ? <Text style={s.qty}>{t(' ほか{n}品', { n: rest })}</Text> : null}
    </Text>
  );
}

/** P/F/C の組。ラベルは栄養素色、数値は本文色の等幅数字 */
export function PfcInline({ p, f, c, style }: { p: number; f: number; c: number; style?: StyleProp<ViewStyle> }) {
  const col = pfcColors();
  const cell = (ab: string, v: number, color: string) => (
    <View key={ab} style={s.pfcCell}>
      <Text style={[s.pfcAb, { color }]}>{ab}</Text>
      <Text style={s.pfcV}>{Math.round(Number(v) || 0)}</Text>
    </View>
  );
  return (
    <View style={[s.pfcRow, style]}>
      {cell('P', p, col.p)}
      {cell('F', f, col.f)}
      {cell('C', c, col.c)}
    </View>
  );
}

/** kcal（右寄せ・4桁ぶんの固定幅）。unit=false で数字だけ（展開品目行など詰めたい場所） */
export function KcalCell({ kcal, unit = true, style }: { kcal: number; unit?: boolean; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[s.kcalCell, !unit && s.kcalCellNarrow, style]}>
      <Text style={s.kcal} numberOfLines={1} maxFontSizeMultiplier={1.3}>
        {Math.round(Number(kcal) || 0).toLocaleString()}
        {unit ? <Text style={s.kcalU}> kcal</Text> : null}
      </Text>
    </View>
  );
}

const s = themed(() => ({
  name: { fontSize: 15, fontWeight: '700', color: C.ink, lineHeight: 21 },
  qty: { fontSize: 12.5, fontWeight: '600', color: C.sub },
  pfcRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 3 },
  pfcCell: { flexDirection: 'row', alignItems: 'baseline', gap: 2 },
  pfcAb: { fontSize: 11, fontWeight: '800' },
  pfcV: { fontSize: 13, fontWeight: '700', color: C.ink, fontVariant: ['tabular-nums'] },
  // 「1,234 kcal」が収まる幅。数字だけの行（展開品目）は単位が無いぶん狭くする
  kcalCell: { width: 78, alignItems: 'flex-end' },
  kcalCellNarrow: { width: 44 },
  kcal: { fontSize: 15, fontWeight: '800', color: C.ink, fontVariant: ['tabular-nums'], textAlign: 'right' },
  kcalU: { fontSize: 11, fontWeight: '600', color: C.sub },
}));
