// 運動（有酸素・日常の動き）を記録するシート。
//
// 以前は運動タブのカードに種目チップ8枚を常設し、選んで時間チップを押す形だった。
// 「運動の種類は筋トレと同じように毎度選ぶ形に」「消費カロリーは基本ヘルスケア取り込み」
// （βFB 2026-09-02）に合わせ、カード側はボタン1つにして、押したら
//   ① 種目を選ぶ（よく使う順 → 7カテゴリ・検索つき）
//   ② 時間をダイアルで回す（5分刻み・任意で距離）→ 記録
// の2段のシートにした。表示中チップの管理（bl-act-visible）は廃止し、一覧は常に全種目。
import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, Modal, ScrollView, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { X, Search, ChevronLeft } from 'lucide-react-native';
import { C, sheetTopPad, RADIUS, HEAD, themed } from '@/lib/ui';
import { t } from '@/lib/i18n';
import { ACTIVITIES, ACTIVITY_GROUPS, activityById, activityName, activityKcal, type Activity } from '@/lib/activities';
import { Wheel, WheelUnit } from '@/components/Wheel';
import { OptionButton } from '@/components/ui/Selectable';

/** 時間ダイアルの目盛り（5分刻み・5〜300分） */
const MINUTES = Array.from({ length: 60 }, (_, i) => (i + 1) * 5);
const LAST_MIN_KEY = 'bl-act-last-min';

export default function ActivityLogSheet({ visible, onClose, weightKg, freq, busy, onSave }: {
  visible: boolean;
  onClose: () => void;
  /** 消費kcalの計算に使う体重 */
  weightKg: number;
  /** よく使う順の実績（lib/foods foodScores のキー 'act:<id>'） */
  freq: Record<string, number>;
  busy: boolean;
  /** 保存。成功したら true（シートを閉じる） */
  onSave: (a: Activity, minutes: number, km: number | null) => Promise<boolean>;
}) {
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Activity | null>(null);
  const [minIdx, setMinIdx] = useState(5);   // 30分
  const [km, setKm] = useState('');
  const query = q.trim();

  // 前回の時間を初期位置にする（同じ人は同じくらいの時間で動くことが多い）
  useEffect(() => {
    if (!visible) return;
    setPicked(null); setQ(''); setKm('');
    AsyncStorage.getItem(LAST_MIN_KEY).then((v) => {
      const n = Number(v);
      const i = MINUTES.indexOf(n);
      if (i >= 0) setMinIdx(i);
    }).catch(() => {});
  }, [visible]);

  // よく使う種目（保存の実績順・上位8件）。探させずに最短で選べるようにする
  const frequent = useMemo(() => Object.entries(freq)
    .filter(([k, v]) => k.startsWith('act:') && v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => activityById(k.slice('act:'.length)))
    .filter((a): a is Activity => a != null)
    .slice(0, 8), [freq]);

  const match = (a: Activity) => !query || activityName(a.id).includes(query) || a.canon.includes(query);
  const minutes = MINUTES[minIdx];
  const kmNum = Number(km) > 0 ? Number(km) : null;
  const kcal = picked ? activityKcal(picked, weightKg, minutes, picked.perKgKm != null ? kmNum : null) : 0;

  async function save() {
    if (!picked) return;
    const ok = await onSave(picked, minutes, picked.perKgKm != null ? kmNum : null);
    if (ok) {
      AsyncStorage.setItem(LAST_MIN_KEY, String(minutes)).catch(() => {});
      onClose();
    }
  }

  const row = (a: Activity) => (
    <Pressable key={a.id} style={s.row} onPress={() => setPicked(a)}>
      <Text style={{ fontSize: 21 }}>{a.e}</Text>
      <Text style={s.rowT}>{activityName(a.id)}</Text>
      <Text style={s.rowMets}>{a.mets} METs</Text>
      <Text style={s.arrow}>›</Text>
    </Pressable>
  );

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[s.wrap, { paddingTop: sheetTopPad(16) }]}>
        {picked == null ? (
          <>
            <View style={s.head}>
              <Text style={s.title}>{t('運動を記録する')}</Text>
              <Pressable onPress={onClose} hitSlop={10}><X size={22} color={C.sub} /></Pressable>
            </View>
            <Text style={s.sub}>{t('種目を選ぶと、次に時間を選べます。犬の散歩でも立派な運動。')}</Text>
            <View style={s.searchRow}>
              <Search size={15} color={C.faint} />
              <TextInput style={s.search} placeholder={t('種目名で探す')} placeholderTextColor={C.faint}
                         value={q} onChangeText={setQ} clearButtonMode="while-editing" />
            </View>
            <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 30 }} keyboardShouldPersistTaps="handled">
              {frequent.length > 0 && query.length === 0 && (
                <>
                  <Text style={s.groupT}>{t('よく使う')}</Text>
                  {frequent.map(row)}
                </>
              )}
              {ACTIVITY_GROUPS.map((g) => {
                const items = g.ids.map((id) => activityById(id)).filter((a): a is Activity => a != null && match(a));
                if (items.length === 0) return null;
                return (
                  <View key={g.key}>
                    <Text style={s.groupT}>{t(g.label)}</Text>
                    {items.map(row)}
                  </View>
                );
              })}
              {ACTIVITIES.filter(match).length === 0 && (
                <Text style={s.empty}>{t('見つかりませんでした。別の言葉で探してみてください。')}</Text>
              )}
              <Text style={s.note}>
                {t('消費カロリーの目安はCompendium of Physical Activities (2011) のMETs値をもとに計算しています。')}
              </Text>
            </ScrollView>
          </>
        ) : (
          <>
            <View style={s.head}>
              <Pressable onPress={() => setPicked(null)} hitSlop={10} style={{ flexDirection: 'row', alignItems: 'center' }}>
                <ChevronLeft size={20} color={C.accentInk} />
                <Text style={s.back}>{t('種目')}</Text>
              </Pressable>
              <Pressable onPress={onClose} hitSlop={10}><X size={22} color={C.sub} /></Pressable>
            </View>
            <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 30 }} keyboardShouldPersistTaps="handled">
              <View style={s.pickedRow}>
                <Text style={{ fontSize: 34 }}>{picked.e}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={s.pickedT}>{activityName(picked.id)}</Text>
                  <Text style={s.pickedSub}>{picked.mets} METs</Text>
                </View>
              </View>
              <Text style={s.label}>{t('時間')}</Text>
              {/* 時間はダイアルで回す（筋トレの重量・回数と同じ操作にそろえる） */}
              <View style={s.wheelRow}>
                <Wheel width={110} values={MINUTES.map(String)} index={minIdx} onChange={setMinIdx} />
                <WheelUnit>{t('分')}</WheelUnit>
              </View>
              {picked.perKgKm != null && (
                <>
                  <Text style={s.label}>{t('距離（km・任意。入れると消費kcalの精度が上がります）')}</Text>
                  <TextInput style={s.km} placeholder="5.0" placeholderTextColor={C.faint}
                             keyboardType="decimal-pad" value={km} onChangeText={setKm} />
                </>
              )}
              <View style={s.kcalBox}>
                <Text style={s.kcalLbl}>{t('消費の目安')}</Text>
                <Text style={s.kcalVal} maxFontSizeMultiplier={1.3}>{t('約{n}kcal', { n: kcal.toLocaleString() })}</Text>
                <Text style={s.kcalNote}>{t('記録すると今日の「あと食べられる量」に上乗せされます')}</Text>
              </View>
              <OptionButton style={{ marginTop: 16 }} label={t('記録する（約{n}kcal消費）', { n: kcal })} onPress={save} busy={busy} />
            </ScrollView>
          </>
        )}
      </View>
    </Modal>
  );
}

const s = themed(() => ({
  wrap: { flex: 1, backgroundColor: C.bg, paddingHorizontal: 16 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  title: { ...HEAD.card, color: C.ink },
  back: { fontSize: 15, fontWeight: '800', color: C.accentInk },
  sub: { fontSize: 13, color: C.sub, lineHeight: 18, marginBottom: 10 },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.chipBg,
    borderRadius: RADIUS.input, paddingHorizontal: 12, paddingVertical: 9, marginBottom: 6,
  },
  search: { flex: 1, fontSize: 17, color: C.ink, padding: 0 },
  groupT: { fontSize: 13, fontWeight: '800', color: C.sub, marginTop: 14, marginBottom: 3 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 11, borderBottomWidth: 0.5, borderBottomColor: C.line,
  },
  rowT: { flex: 1, fontSize: 15, color: C.ink, fontWeight: '600' },
  rowMets: { fontSize: 11, color: C.faint, fontWeight: '700' },
  arrow: { fontSize: 21, color: C.faint },
  empty: { fontSize: 13, color: C.sub, textAlign: 'center', marginTop: 24 },
  note: { fontSize: 11.5, color: C.faint, lineHeight: 16, marginTop: 18 },
  pickedRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 6, marginBottom: 8 },
  pickedT: { fontSize: 21, fontWeight: '800', color: C.ink },
  pickedSub: { fontSize: 12, color: C.sub, fontWeight: '700', marginTop: 2 },
  label: { fontSize: 13, fontWeight: '700', color: C.sub, marginTop: 14, marginBottom: 4 },
  wheelRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.panel, borderRadius: RADIUS.panel, borderWidth: 1, borderColor: C.line, paddingVertical: 6,
  },
  km: {
    width: 120, backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: RADIUS.chip,
    paddingHorizontal: 12, paddingVertical: 9, fontSize: 15, color: C.ink, textAlign: 'center',
  },
  kcalBox: {
    marginTop: 16, backgroundColor: C.accentSoft, borderWidth: 1, borderColor: C.accentBorder,
    borderRadius: RADIUS.tile, padding: 14, alignItems: 'center',
  },
  kcalLbl: { fontSize: 12, fontWeight: '700', color: C.sub },
  kcalVal: { fontSize: 26, fontWeight: '900', color: C.accentInk, marginTop: 2, fontVariant: ['tabular-nums'] },
  kcalNote: { fontSize: 11.5, color: C.sub, marginTop: 4, textAlign: 'center' },
}));
