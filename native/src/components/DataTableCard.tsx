// 数値テーブル（グラフだけでは読み取れない「実際の数字」を確認するための画面）
// 体重・ウエスト・体脂肪率は日付順、筋トレは種目ごとの重量履歴を表で出す。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, Modal, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, Table2 } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { C, sheetTopPad, themed } from '@/lib/ui';
import { t } from '@/lib/i18n';
import { kgToDisplay, useUnits } from '@/lib/units';
import { Chip } from '@/components/ui/Selectable';
import { parse1RMs, epley1RM } from '@/lib/rm';
import { weightLookup } from '@/lib/liftLog';

type Row = { date: string; weight: number | null; waist: number | null; bodyfat: number | null };
type Metric = 'weight' | 'waist' | 'bodyfat';

const UNIT: Record<Metric, string> = { weight: '', waist: 'cm', bodyfat: '%' };

/** 体重などの推移を表で見る（日付・値・前日比・7日平均） */
export function BodyTable({ visible, onClose, initialMetric = 'weight' }: {
  visible: boolean; onClose: () => void; initialMetric?: Metric;
}) {
  const insets = useSafeAreaInsets();
  const units = useUnits();
  const [rows, setRows] = useState<Row[]>([]);
  const [metric, setMetric] = useState<Metric>(initialMetric);
  const [loading, setLoading] = useState(true);

  useEffect(() => { if (visible) setMetric(initialMetric); }, [visible, initialMetric]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await supabase.from('entries').select('date,weight,waist,bodyfat')
        .order('date', { ascending: false }).limit(400);
      if (!res.error) { setRows((res.data as Row[]) ?? []); return; }
      // bodyfat列が無い旧DBでも表が出るようフォールバック
      const res2 = await supabase.from('entries').select('date,weight,waist')
        .order('date', { ascending: false }).limit(400);
      setRows((res2.data as Row[]) ?? []);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { if (visible) load(); }, [visible, load]);

  // 選んだ指標の記録だけを新しい順に並べ、前日比と7日平均を添える
  const table = useMemo(() => {
    const withVal = rows
      .filter((r) => r[metric] != null)
      .map((r) => ({ date: r.date, value: Number(r[metric]) }));
    return withVal.map((r, i) => {
      const prev = withVal[i + 1]; // 1つ後ろ＝1つ前の記録（降順のため）
      const window = withVal.slice(i, i + 7);
      const avg = window.reduce((a, b) => a + b.value, 0) / window.length;
      return { ...r, delta: prev ? r.value - prev.value : null, avg7: avg };
    });
  }, [rows, metric]);

  const fmt = (v: number) => (metric === 'weight' ? kgToDisplay(v, units.weight) : v).toFixed(1);
  const unitLabel = metric === 'weight' ? units.weight : UNIT[metric];

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={s.wrap}>
        <View style={s.head}>
          <Text style={s.title}>{t('推移の詳細')}</Text>
          <Pressable onPress={onClose} hitSlop={10}><X size={22} color={C.sub} /></Pressable>
        </View>

        <View style={s.chips}>
          {([['weight', t('体重')], ['waist', t('ウエスト')], ['bodyfat', t('体脂肪率')]] as const).map(([k, label]) => (
            <Chip key={k} label={label} tone="ink" selected={metric === k} onPress={() => setMetric(k)} />
          ))}
        </View>

        {loading ? (
          <ActivityIndicator color={C.teal} style={{ marginTop: 24 }} />
        ) : table.length === 0 ? (
          <Text style={s.empty}>{t('この項目の記録はまだありません。')}</Text>
        ) : (
          <>
            <View style={s.thead}>
              <Text style={[s.th, { flex: 1.2 }]}>{t('日付')}</Text>
              <Text style={[s.th, s.num]}>{unitLabel}</Text>
              <Text style={[s.th, s.num]}>{t('前回比')}</Text>
              <Text style={[s.th, s.num]}>{t('7日平均')}</Text>
            </View>
            <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 30 }}>
              {table.map((r) => (
                <View key={r.date} style={s.tr}>
                  <Text style={[s.td, { flex: 1.2, color: C.sub }]}>{r.date.slice(5).replace('-', '/')}</Text>
                  <Text style={[s.td, s.num, s.strong]}>{fmt(r.value)}</Text>
                  <Text style={[s.td, s.num, r.delta != null && r.delta > 0 ? { color: C.coral } : r.delta != null && r.delta < 0 ? { color: C.teal } : null]}>
                    {r.delta == null ? '—' : `${r.delta > 0 ? '+' : ''}${fmt(Math.abs(r.delta)).replace(/^/, r.delta < 0 ? '-' : '')}`}
                  </Text>
                  <Text style={[s.td, s.num, { color: C.faint }]}>{fmt(r.avg7)}</Text>
                </View>
              ))}
            </ScrollView>
          </>
        )}
      </View>
    </Modal>
  );
}

/** 筋トレの重量を種目ごとに表で見る（日付・重量・回数・推定1RM） */
export function LiftTable({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const units = useUnits();
  const [logs, setLogs] = useState<{ date: string; text: string }[]>([]);
  // 自重種目の重量は体重＋加重なので、日付ごとの体重が要る
  const [weightRows, setWeightRows] = useState<{ date: string; weight: number | null }[]>([]);
  const [ex, setEx] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data }, wRes] = await Promise.all([
        supabase.from('logs').select('date,text')
          .like('text', '🏋️%').order('at', { ascending: false }).limit(300),
        supabase.from('entries').select('date,weight').not('weight', 'is', null)
          .order('date', { ascending: false }).limit(400),
      ]);
      setLogs((data as { date: string; text: string }[]) ?? []);
      setWeightRows((wRes.data as { date: string; weight: number | null }[] | null) ?? []);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { if (visible) load(); }, [visible, load]);

  // 種目ごとに「日付・重量・回数・推定1RM」を展開する
  const byExercise = useMemo(() => {
    const weightAt = weightLookup(weightRows);
    const map = new Map<string, { date: string; kg: number; reps: number; rm: number }[]>();
    for (const l of logs) {
      for (const p of parse1RMs(l.text, weightAt(l.date))) {
        const arr = map.get(p.name) ?? [];
        arr.push({ date: l.date, kg: p.kg, reps: p.reps, rm: Math.round(epley1RM(p.kg, p.reps)) });
        map.set(p.name, arr);
      }
    }
    return map;
  }, [logs, weightRows]);

  const names = [...byExercise.keys()].sort((a, b) => (byExercise.get(b)!.length - byExercise.get(a)!.length));
  const active = ex && byExercise.has(ex) ? ex : names[0] ?? null;
  const rows = active ? byExercise.get(active)! : [];
  const best = rows.reduce((m, r) => Math.max(m, r.rm), 0);
  const w = (v: number) => kgToDisplay(v, units.weight).toFixed(1);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={s.wrap}>
        <View style={s.head}>
          <Text style={s.title}>{t('挙上重量の推移')}</Text>
          <Pressable onPress={onClose} hitSlop={10}><X size={22} color={C.sub} /></Pressable>
        </View>

        {loading ? (
          <ActivityIndicator color={C.teal} style={{ marginTop: 24 }} />
        ) : names.length === 0 ? (
          <Text style={s.empty}>{t('まだ記録がありません。今日の1セット目から始めましょう。')}</Text>
        ) : (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 44 }} contentContainerStyle={s.chips}>
              {names.map((n) => (
                <Chip key={n} label={n} tone="ink" selected={n === active} onPress={() => setEx(n)} />
              ))}
            </ScrollView>
            <View style={s.thead}>
              <Text style={[s.th, { flex: 1.2 }]}>{t('日付')}</Text>
              <Text style={[s.th, s.num]}>{units.weight}</Text>
              <Text style={[s.th, s.num]}>{t('回')}</Text>
              <Text style={[s.th, s.num]}>{t('推定1RM')}</Text>
            </View>
            <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 30 }}>
              {rows.map((r, i) => (
                <View key={`${r.date}-${i}`} style={s.tr}>
                  <Text style={[s.td, { flex: 1.2, color: C.sub }]}>{r.date.slice(5).replace('-', '/')}</Text>
                  <Text style={[s.td, s.num, s.strong]}>{w(r.kg)}</Text>
                  <Text style={[s.td, s.num]}>{r.reps}</Text>
                  <Text style={[s.td, s.num, r.rm >= best ? { color: C.teal, fontWeight: '800' } : null]}>
                    {w(r.rm)}{r.rm >= best ? ' ⭐' : ''}
                  </Text>
                </View>
              ))}
            </ScrollView>
          </>
        )}
      </View>
    </Modal>
  );
}

/** 概要タブに置く「表で見る」入口カード */
export function TableEntryCard({ onOpenBody, onOpenLift }: { onOpenBody: () => void; onOpenLift: () => void }) {
  return (
    <View style={s.card}>
      <View style={s.h2Row}>
        <Table2 size={16} color={C.teal} />
        <Text style={s.h2}>{t('数字で見る')}</Text>
      </View>
      <Pressable style={s.entryRow} onPress={onOpenBody}>
        <Text style={s.entryT}>{t('体重・ウエスト・体脂肪率の表')}</Text>
        <Text style={s.entryArrow}>›</Text>
      </Pressable>
      <Pressable style={s.entryRow} onPress={onOpenLift}>
        <Text style={s.entryT}>{t('挙上重量の表（種目別）')}</Text>
        <Text style={s.entryArrow}>›</Text>
      </Pressable>
    </View>
  );
}

const s = themed(() => ({
  wrap: { flex: 1, backgroundColor: C.bg, paddingHorizontal: 16, paddingTop: sheetTopPad(16) },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  title: { fontSize: 17, fontWeight: '800', color: C.ink },
  chips: { flexDirection: 'row', gap: 6, marginBottom: 12, flexWrap: 'wrap' },
  thead: {
    flexDirection: 'row', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.line,
    backgroundColor: C.chipBg, borderRadius: 8, paddingHorizontal: 8,
  },
  th: { flex: 1, fontSize: 11, fontWeight: '800', color: C.sub },
  tr: { flexDirection: 'row', paddingVertical: 10, paddingHorizontal: 8, borderBottomWidth: 0.5, borderBottomColor: C.line },
  td: { flex: 1, fontSize: 15, color: C.ink, fontVariant: ['tabular-nums'] },
  num: { textAlign: 'right' },
  strong: { fontWeight: '800' },
  empty: { fontSize: 15, color: C.sub, marginTop: 24, textAlign: 'center', lineHeight: 21 },
  card: { backgroundColor: C.panel, borderWidth: StyleSheet.hairlineWidth, borderColor: C.hairline, borderRadius: 20, shadowColor: C.shadow, shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 2, padding: 16, marginBottom: 12 },
  h2Row: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  h2: { fontSize: 17, fontWeight: '800', color: C.ink },
  entryRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: C.line,
  },
  entryT: { fontSize: 15, color: C.ink, fontWeight: '600' },
  entryArrow: { fontSize: 21, color: C.faint },
}));
