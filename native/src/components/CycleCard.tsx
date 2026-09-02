// サイクル比較カード（B-5・概要メニューの'cycles'）
// 中級者はバルク（増量）とカット（減量）を季節で往復する。purpose_periodsの履歴を
// 期間ごとに集計し、「前回のカットは8週で−3.1kg」のような自己比較を可能にする。
// テーブル未作成・切替経験なし（サイクル1つ以下）のときは親（changes.tsx）が
// メニューから除外する（bulkguardの'unavailable'と同じ流儀）ため、ここは表示に徹する。
import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Repeat, Dumbbell } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { C, themed } from '@/lib/ui';
import { t } from '@/lib/i18n';
import { todayJST } from '@/lib/calc';
import { cycleLabel, type PurposePeriod } from '@/lib/purpose';

export type WeightRow = { date: string; weight: number };

export type CycleStat = {
  purpose: string;
  start: string;
  end: string | null;      // null=進行中
  days: number;            // 期間日数（進行中はtodayまで）
  deltaKg: number | null;  // 期間内の最初と最後の記録体重の差（2点未満はnull）
  paceKg: number | null;   // 週あたりペース（kg/週）
};

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) / 86400000);
}

/** 期間ごとの体重変化・週ペースを集計する純関数（テスト対象） */
export function cycleStats(periods: PurposePeriod[], weights: WeightRow[], today: string): CycleStat[] {
  return periods.map((p) => {
    const end = p.ended_at ?? today;
    const ws = weights.filter((w) => w.date >= p.started_at && w.date <= end);
    const deltaKg = ws.length >= 2
      ? Math.round((ws[ws.length - 1].weight - ws[0].weight) * 10) / 10
      : null;
    // 最低1日として0除算を避ける（切替当日など）
    const days = Math.max(1, daysBetween(p.started_at, end));
    const paceKg = deltaKg != null ? Math.round((deltaKg / (days / 7)) * 100) / 100 : null;
    return { purpose: p.purpose, start: p.started_at, end: p.ended_at, days, deltaKg, paceKg };
  });
}

// 「3/1〜5/31」式の短い日付（スペースを稼ぐため年は出さない）
const fmtMD = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const signed = (v: number, digits: number) => `${v > 0 ? '+' : ''}${v.toFixed(digits)}`;

export default function CycleCard({ periods, weights }: { periods: PurposePeriod[]; weights: WeightRow[] }) {
  // 🏋️記録日（distinct date）。挙上を続けたサイクルかどうかの参考値。ベストエフォート
  const [liftDates, setLiftDates] = useState<Set<string>>(new Set());
  const load = useCallback(async () => {
    try {
      const { data } = await supabase.from('logs').select('date,text')
        .like('text', '🏋️%').order('date', { ascending: true }).limit(2000);
      setLiftDates(new Set(((data as { date: string }[]) ?? []).map((r) => r.date)));
    } catch { /* 参考値なので無視 */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  // 切替経験なし（1つ以下）は親が除外するが、直接マウントされても静かに消える二重防御
  if (periods.length < 2) return null;

  const today = todayJST();
  const stats = cycleStats(periods, weights, today);
  const recent = stats.slice(-3).reverse(); // 直近3サイクル・新しい順

  // 先頭の言語化1行: 直近の「完了した」サイクルを一文に（例: 前回の減量は8週で−3.1kg）
  const prev = [...stats].reverse().find((c) => c.end != null && c.deltaKg != null);
  const lead = prev
    ? t('前回の{name}は{w}週で{d}kg', {
        name: cycleLabel(prev.purpose),
        w: Math.max(1, Math.round(prev.days / 7)),
        d: signed(prev.deltaKg!, 1),
      })
    : null;

  return (
    <View style={s.card}>
      <View style={s.h2Row}>
        <Repeat size={16} color={C.teal} />
        <Text style={s.h2}>{t('サイクル比較')}</Text>
      </View>
      {lead && <Text style={s.lead}>{lead}</Text>}
      {recent.map((c) => {
        const lifting = [...liftDates].filter((d) => d >= c.start && d <= (c.end ?? today)).length;
        const ongoing = c.end == null;
        // 増量サイクルは「増えた」が成功。色は減量/増量それぞれの意図に沿って塗る
        const good = c.purpose === 'bulk' ? (c.deltaKg ?? 0) > 0 : (c.deltaKg ?? 0) <= 0;
        return (
          <View key={c.start} style={s.row}>
            <View style={s.nameRow}>
              <Text style={s.name}>{cycleLabel(c.purpose)} {fmtMD(c.start)}〜{c.end ? fmtMD(c.end) : ''}</Text>
              {ongoing && (
                <View style={s.badge}><Text style={s.badgeT}>{t('進行中')}</Text></View>
              )}
            </View>
            <View style={s.statRow}>
              <Text style={[s.delta, { color: c.deltaKg == null ? C.sub : good ? C.teal : C.coral }]}>
                {c.deltaKg != null ? `${signed(c.deltaKg, 1)}kg` : '—'}
              </Text>
              {c.paceKg != null && (
                <Text style={s.pace}>{signed(c.paceKg, 2)} {t('kg/週')}</Text>
              )}
              {lifting > 0 && (
                <View style={s.liftRow}>
                  <Dumbbell size={12} color={C.sub} />
                  <Text style={s.liftT}>{t('{n}日', { n: lifting })}</Text>
                </View>
              )}
            </View>
          </View>
        );
      })}
      <Text style={s.note}>{t('体重変化は期間内の最初と最後の記録体重の差です。目的を切り替えるたびにサイクルが増えます。')}</Text>
    </View>
  );
}

const s = themed(() => ({
  card: { backgroundColor: C.panel, borderWidth: StyleSheet.hairlineWidth, borderColor: C.hairline, borderRadius: 20, shadowColor: C.shadow, shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 2, padding: 16, marginBottom: 12 },
  h2Row: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  h2: { fontSize: 17, fontWeight: '800', color: C.ink },
  lead: { fontSize: 14, color: C.ink, lineHeight: 21, marginBottom: 6 },
  row: { borderTopWidth: 0.5, borderTopColor: C.line, paddingVertical: 9 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { fontSize: 15, fontWeight: '800', color: C.ink, fontVariant: ['tabular-nums'] },
  badge: { borderWidth: 1.5, borderColor: C.teal, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  badgeT: { fontSize: 11, fontWeight: '800', color: C.accentInk },
  statRow: { flexDirection: 'row', alignItems: 'baseline', gap: 12, marginTop: 4 },
  delta: { fontSize: 19, fontWeight: '800', fontVariant: ['tabular-nums'] },
  pace: { fontSize: 12.5, color: C.sub, fontWeight: '700', fontVariant: ['tabular-nums'] },
  liftRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  liftT: { fontSize: 12.5, color: C.sub, fontWeight: '700', fontVariant: ['tabular-nums'] },
  note: { fontSize: 12, color: C.faint, lineHeight: 17, marginTop: 6 },
}));
