// 「生活係数」を人間の言葉で選ぶピッカー（内部では従来どおり係数に変換して保存）
// 数値入力は誰にも伝わらなかったため廃止し、生活イメージ4択にした
import { View, Text, Pressable } from 'react-native';
import { C, themed } from '@/lib/ui';
import { t } from '@/lib/i18n';

export const ACTIVITY_LEVELS = [
  { v: 1.2, t: t('ほぼ座って過ごす'), d: t('デスクワーク中心。運動はほとんどしない') },
  { v: 1.375, t: t('軽く動く'), d: t('通勤で歩く・立ち仕事・犬の散歩など。運動は週1〜2回') },
  { v: 1.55, t: t('よく動く'), d: t('週3〜5回は運動やスポーツをしている') },
  { v: 1.725, t: t('かなり動く'), d: t('ほぼ毎日ハードに運動する・肉体労働') },
] as const;

// 既存ユーザーの任意係数（例: 1.3）を最寄りの選択肢に丸める
export function nearestActivity(v: number): number {
  let best: number = ACTIVITY_LEVELS[0].v;
  let diff = Infinity;
  for (const a of ACTIVITY_LEVELS) {
    const d = Math.abs(a.v - v);
    if (d < diff) { diff = d; best = a.v; }
  }
  return best;
}

export default function ActivityLevelPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const sel = nearestActivity(value);
  return (
    <View style={{ gap: 8 }}>
      {ACTIVITY_LEVELS.map((a) => (
        <Pressable key={a.v} style={[s.card, sel === a.v && s.on]} onPress={() => onChange(a.v)}>
          <View style={{ flex: 1 }}>
            <Text style={[s.t, sel === a.v && { color: C.teal }]}>{a.t}</Text>
            <Text style={s.d}>{a.d}</Text>
          </View>
          <View style={[s.radio, sel === a.v && s.radioOn]}>
            {sel === a.v && <View style={s.radioDot} />}
          </View>
        </Pressable>
      ))}
    </View>
  );
}

const s = themed(() => ({
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: C.bg, borderWidth: 1.5, borderColor: C.line, borderRadius: 14,
    paddingHorizontal: 12, paddingVertical: 10,
  },
  on: { borderColor: C.teal, backgroundColor: C.accentSoft },
  t: { fontSize: 15, fontWeight: '800', color: C.ink },
  d: { fontSize: 13, color: C.sub, marginTop: 2, lineHeight: 18 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: C.teal },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.teal },
}));
