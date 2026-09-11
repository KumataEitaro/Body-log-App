// 時間帯別の歩数（0〜23時・24本・ヘルスケア式の棒グラフ）。
// 運動タブ「きょうの動き」の描画（app/(tabs)/training.tsx）と同じ見た目を、概要タブの
// 歩数・睡眠詳細（components/HealthDetail.tsx）でも過去日ぶんに使うために部品化した
// （feat/health-history・2026-09-10）。training.tsx 側の置き換えは別作業（同時編集を避けた）。
//
// - 今日を見ているときは「まだ来ていない時間帯」を淡い空バーにする（0歩と区別）
// - 0歩の時間帯は細い線（C.line）＝「計測はあるが歩いていない」
// - 高さは呼び出し側が選ぶ（きょうの動きは 32・詳細はもう少し大きく）
import { View, Text, type StyleProp, type ViewStyle } from 'react-native';
import { jstHourNow } from '@/lib/health';
import { C, themed } from '@/lib/ui';
import { t } from '@/lib/i18n';

export default function HourlyStepsChart({ hours, date, today, barHeight = 32, style }: {
  /** 0〜23時の歩数（readHourlySteps の戻り） */
  hours: number[];
  /** 表示している日（'YYYY-MM-DD'） */
  date: string;
  /** 今日（'YYYY-MM-DD'）。date と同じなら未来の時間帯を空にする */
  today: string;
  /** バー領域の高さ（px） */
  barHeight?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const nowH = jstHourNow();
  const isToday = date === today;
  const maxHr = Math.max(1, ...hours);
  const maxBar = Math.max(4, barHeight - 3);
  return (
    <View style={[s.wrap, style]}>
      <Text style={s.title}>{t('時間帯別の歩数')}</Text>
      <View style={[s.bars, { height: barHeight }]}>
        {hours.map((v, h) => {
          const future = isToday && h > nowH;
          return (
            <View key={h} style={s.col}>
              {future ? (
                <View style={s.empty} />
              ) : (
                <View style={[s.bar, { height: v > 0 ? 3 + Math.round(maxBar * (v / maxHr)) : 2 }, v === 0 && { backgroundColor: C.line }]} />
              )}
            </View>
          );
        })}
      </View>
      <View style={s.axis}>
        {[0, 6, 12, 18].map((h) => (
          <Text key={h} style={s.axisT}>{t('{n}時', { n: h })}</Text>
        ))}
      </View>
    </View>
  );
}

const s = themed(() => ({
  wrap: { marginTop: 12, borderTopWidth: 0.5, borderTopColor: C.line, paddingTop: 10 },
  title: { fontSize: 11.5, fontWeight: '700', color: C.sub, marginBottom: 6 },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  col: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  bar: { alignSelf: 'stretch', borderRadius: 2, backgroundColor: C.teal },
  empty: { alignSelf: 'stretch', height: 2, borderRadius: 2, backgroundColor: C.track },
  axis: { flexDirection: 'row', marginTop: 4 },
  axisT: { flex: 1, fontSize: 11, color: C.faint, fontWeight: '700', textAlign: 'left' },
}));
