// バイタル記録（血圧・脈拍・血糖）カード — 概要タブ「からだ」＞バイタル
//
// 1500人ペルソナ監査Later群の本丸。健診で「血圧を気にして」と言われた層は、
// カロリーより先に上と下の数字を見ている。ここは診断の場ではなく「並べて残す」場所。
// 異常域では病名も重症度も言わず、「医療機関に相談を」の一言だけを非審判に添える。
//
// データは supabase/migration-25.sql【ユーザー実行待ち】。未適用でも壊れない
// （listVitalsが空を返す＝空状態の誘い文が出るだけ）。
import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, Pressable, TextInput, Modal, ActivityIndicator,
  StyleSheet, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import Svg, { Polyline, Line as SvgLine, Circle } from 'react-native-svg';
import { HeartPulse, Plus, Trash2 } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { supabase } from '@/lib/supabase';
import { C, rgba, themed } from '@/lib/ui';
import { t } from '@/lib/i18n';
import {
  listVitals, saveVital, deleteVital, needsDoctorNote, anyNeedsDoctorNote,
  todayJSTLocal, addDays, VITAL_RANGE, type Vital,
} from '@/lib/vitals';

const DAYS = 14;

// 入力欄の1つぶん（数字だけ・空欄OK）
function NumField({ label, unit, value, onChange, max }: {
  label: string; unit: string; value: string; onChange: (v: string) => void; max: number;
}) {
  return (
    <View style={s.field}>
      <Text style={s.fieldLabel}>{label}</Text>
      <View style={s.fieldBox}>
        <TextInput
          style={s.fieldInput} value={value}
          onChangeText={(v) => onChange(v.replace(/[^0-9]/g, '').slice(0, String(max).length))}
          keyboardType="number-pad" placeholder="—" placeholderTextColor={C.faint}
          maxFontSizeMultiplier={1.3}
        />
        <Text style={s.fieldUnit}>{unit}</Text>
      </View>
    </View>
  );
}

// 収縮期・拡張期の2本の折れ線（直近14日・値のある日だけ結ぶ簡易グラフ）
function MiniLines({ list, width }: { list: Vital[]; width: number }) {
  const pts = list.filter((v) => v.systolic != null || v.diastolic != null);
  if (pts.length < 2) return null;
  const h = 96;
  const padY = 10;
  const vals: number[] = [];
  for (const v of pts) {
    if (v.systolic != null) vals.push(v.systolic);
    if (v.diastolic != null) vals.push(v.diastolic);
  }
  const min = Math.min(...vals) - 5;
  const max = Math.max(...vals) + 5;
  const span = Math.max(1, max - min);
  const x = (i: number) => (pts.length === 1 ? width / 2 : (i / (pts.length - 1)) * width);
  const y = (v: number) => padY + (1 - (v - min) / span) * (h - padY * 2);
  const line = (sel: (v: Vital) => number | null) =>
    pts.map((v, i) => (sel(v) == null ? null : `${x(i).toFixed(1)},${y(Number(sel(v))).toFixed(1)}`))
      .filter((p): p is string => p != null).join(' ');
  const sys = line((v) => v.systolic);
  const dia = line((v) => v.diastolic);
  return (
    <View style={{ marginTop: 10 }}>
      <Svg width={width} height={h}>
        {/* 基準の薄い横線（目盛りではなく「だいたいの高さ」の手すり） */}
        <SvgLine x1={0} y1={h / 2} x2={width} y2={h / 2} stroke={C.line} strokeWidth={1} />
        {!!sys && <Polyline points={sys} fill="none" stroke={C.teal} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />}
        {!!dia && <Polyline points={dia} fill="none" stroke={C.calorieBar} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />}
        {pts.map((v, i) => (
          v.systolic == null ? null : <Circle key={`s${v.date}`} cx={x(i)} cy={y(v.systolic)} r={2.6} fill={C.teal} />
        ))}
        {pts.map((v, i) => (
          v.diastolic == null ? null : <Circle key={`d${v.date}`} cx={x(i)} cy={y(v.diastolic)} r={2.6} fill={C.calorieBar} />
        ))}
      </Svg>
      <View style={s.legend}>
        <View style={s.legendItem}><View style={[s.legendDot, { backgroundColor: C.teal }]} /><Text style={s.legendT}>{t('収縮期（上）')}</Text></View>
        <View style={s.legendItem}><View style={[s.legendDot, { backgroundColor: C.calorieBar }]} /><Text style={s.legendT}>{t('拡張期（下）')}</Text></View>
      </View>
    </View>
  );
}

export default function VitalsCard({ width = 300 }: { width?: number }) {
  const [list, setList] = useState<Vital[]>([]);
  const [uid, setUid] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // 入力中の値（文字列で持ち、保存時に数値へ）
  const [date, setDate] = useState(todayJSTLocal());
  const [sys, setSys] = useState('');
  const [dia, setDia] = useState('');
  const [pul, setPul] = useState('');
  const [glu, setGlu] = useState('');
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    setUid(session?.user?.id ?? null);
    setList(await listVitals(DAYS));
  }, []);

  useEffect(() => { load().catch(() => {}); }, [load]);

  // 開くたびに今日の既存値をプリフィル（同じ日は上書き保存になるため、消えたように見せない）
  function openSheet() {
    const today = todayJSTLocal();
    const cur = list.find((v) => v.date === today);
    setDate(today);
    setSys(cur?.systolic != null ? String(cur.systolic) : '');
    setDia(cur?.diastolic != null ? String(cur.diastolic) : '');
    setPul(cur?.pulse != null ? String(cur.pulse) : '');
    setGlu(cur?.glucose != null ? String(cur.glucose) : '');
    setNote(cur?.note ?? '');
    setErr('');
    setOpen(true);
  }

  // 空欄はnull、範囲外はNaN（呼び出し側でまとめて「範囲を超えています」に落とす）
  function parse(v: string, r: { min: number; max: number }): number | null {
    if (v.trim() === '') return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < r.min || n > r.max) return Number.NaN;
    return Math.round(n);
  }

  async function save() {
    if (!uid || busy) return;
    const next: Vital = {
      date,
      systolic: parse(sys, VITAL_RANGE.systolic),
      diastolic: parse(dia, VITAL_RANGE.diastolic),
      pulse: parse(pul, VITAL_RANGE.pulse),
      glucose: parse(glu, VITAL_RANGE.glucose),
      note: note.trim() || null,
    };
    if ([next.systolic, next.diastolic, next.pulse, next.glucose].some((n) => n != null && Number.isNaN(n))) {
      setErr(t('入力できる範囲を超えています。数字を確認してください。'));
      return;
    }
    setBusy(true); setErr('');
    try {
      const r = await saveVital(uid, next);
      if (!r.ok) { setErr(r.error); return; }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setOpen(false);
      await load();
    } finally { setBusy(false); }
  }

  async function remove(d: string) {
    if (!(await deleteVital(d))) return;
    await load();
  }

  const recent = list.filter((v) => v.date >= addDays(todayJSTLocal(), -(DAYS - 1)));
  const warn = anyNeedsDoctorNote(recent);

  return (
    <View style={s.card}>
      <View style={s.h2Row}>
        <HeartPulse size={16} color={C.teal} />
        <Text style={s.h2}>
          {t('バイタル')}
          <Text style={s.h2sub}>{t('— 血圧・脈拍・血糖')}</Text>
        </Text>
      </View>

      {recent.length === 0 ? (
        <Text style={s.muted}>{t('血圧・脈拍・血糖を残しておくと、受診のときにそのまま見せられます。')}</Text>
      ) : (
        <>
          <MiniLines list={recent} width={Math.max(120, width)} />
          <View style={[s.row, s.rowHead]}>
            <Text style={[s.cell, s.cellDate, s.headT]}>{t('日付')}</Text>
            <Text style={[s.cell, s.headT]}>{t('血圧')}</Text>
            <Text style={[s.cell, s.headT]}>{t('脈拍')}</Text>
            <Text style={[s.cell, s.headT]}>{t('血糖')}</Text>
            <View style={s.cellDel} />
          </View>
          {[...recent].reverse().map((v) => (
            <View key={v.date} style={s.row}>
              <Text style={[s.cell, s.cellDate, s.bodyT]}>{v.date.slice(5).replace('-', '/')}</Text>
              <Text style={[s.cell, s.bodyT, needsDoctorNote(v) && { color: C.amber }]}>
                {v.systolic != null || v.diastolic != null ? `${v.systolic ?? '—'}/${v.diastolic ?? '—'}` : '—'}
              </Text>
              <Text style={[s.cell, s.bodyT]}>{v.pulse ?? '—'}</Text>
              <Text style={[s.cell, s.bodyT]}>{v.glucose ?? '—'}</Text>
              <Pressable style={s.cellDel} hitSlop={8} onPress={() => remove(v.date)} accessibilityLabel={t('削除する')}>
                <Trash2 size={13} color={C.faint} />
              </Pressable>
            </View>
          ))}
          {/* 安全ガード: 診断はしない。受診の目安に触れる値があったときだけ静かに1行 */}
          {warn && <Text style={s.advice}>{t('気になる数値があります。自己判断はせず、医療機関に相談してください。')}</Text>}
        </>
      )}

      <Pressable style={s.addBtn} onPress={openSheet}>
        <Plus size={15} color={C.teal} strokeWidth={2.6} />
        <Text style={s.addT}>{t('きょうの数値を記録')}</Text>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} />
          <View style={s.sheet}>
            <View style={s.h2Row}>
              <HeartPulse size={17} color={C.teal} />
              <Text style={s.sheetTitle}>{t('バイタルを記録')}</Text>
            </View>
            {/* 日付は今日が既定。前後1日だけその場で動かせる（まとめ入力の取りこぼし対策） */}
            <View style={s.dateRow}>
              <Pressable style={s.dateBtn} onPress={() => setDate(addDays(date, -1))}>
                <Text style={s.dateBtnT}>‹</Text>
              </Pressable>
              <Text style={s.dateT}>{date === todayJSTLocal() ? t('今日') : date}</Text>
              <Pressable style={[s.dateBtn, date >= todayJSTLocal() && { opacity: 0.3 }]}
                         disabled={date >= todayJSTLocal()} onPress={() => setDate(addDays(date, 1))}>
                <Text style={s.dateBtnT}>›</Text>
              </Pressable>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled">
              <View style={s.fieldRow}>
                <NumField label={t('収縮期（上）')} unit="mmHg" value={sys} onChange={setSys} max={VITAL_RANGE.systolic.max} />
                <NumField label={t('拡張期（下）')} unit="mmHg" value={dia} onChange={setDia} max={VITAL_RANGE.diastolic.max} />
              </View>
              <View style={s.fieldRow}>
                <NumField label={t('脈拍')} unit="bpm" value={pul} onChange={setPul} max={VITAL_RANGE.pulse.max} />
                <NumField label={t('血糖')} unit="mg/dL" value={glu} onChange={setGlu} max={VITAL_RANGE.glucose.max} />
              </View>
              <TextInput
                style={s.noteInput} value={note} onChangeText={setNote} maxLength={120}
                placeholder={t('メモ（測った時間・食後など）')} placeholderTextColor={C.faint}
              />
              <Text style={s.disclaimer}>{t('このアプリは医療機器ではありません。診断や治療の判断には使えません。')}</Text>
              {!!err && <Text style={s.err}>{err}</Text>}
            </ScrollView>
            <View style={s.btnRow}>
              <Pressable style={s.btnGhost} onPress={() => setOpen(false)} disabled={busy}>
                <Text style={s.btnGhostT}>{t('キャンセル')}</Text>
              </Pressable>
              <Pressable style={[s.btnPrimary, busy && { opacity: 0.4 }]} onPress={save} disabled={busy}>
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnPrimaryT}>{t('保存する')}</Text>}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const s = themed(() => ({
  card: { backgroundColor: C.panel, borderWidth: StyleSheet.hairlineWidth, borderColor: C.hairline, borderRadius: 20, shadowColor: C.shadow, shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 2, padding: 16, marginBottom: 12 },
  h2Row: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  h2: { fontSize: 17, fontWeight: '800', color: C.ink },
  h2sub: { fontSize: 12, fontWeight: '700', color: C.faint },
  muted: { fontSize: 13, color: C.sub, lineHeight: 19 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line },
  rowHead: { borderBottomColor: C.line, paddingVertical: 4 },
  cell: { flex: 1, textAlign: 'right', fontSize: 13, fontVariant: ['tabular-nums'] },
  cellDate: { flex: 1.1, textAlign: 'left' },
  cellDel: { width: 26, alignItems: 'flex-end' },
  headT: { fontSize: 11, fontWeight: '800', color: C.faint },
  bodyT: { color: C.ink, fontWeight: '700' },
  advice: { fontSize: 12.5, color: C.amber, lineHeight: 18, marginTop: 10, fontWeight: '700' },
  addBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 12, borderWidth: 1.5, borderColor: C.accentBorder, borderRadius: 999, paddingVertical: 10, backgroundColor: C.accentSoft },
  addT: { fontSize: 13, fontWeight: '800', color: C.accentInk },
  legend: { flexDirection: 'row', gap: 12, marginTop: 4, flexWrap: 'wrap' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 10, height: 10, borderRadius: 3 },
  legendT: { fontSize: 11, color: C.faint, fontWeight: '700' },
  // ---- 入力シート ----
  backdrop: { flex: 1, justifyContent: 'center', padding: 20, backgroundColor: 'rgba(14,17,22,0.45)' },
  sheet: { backgroundColor: C.panel, borderRadius: 20, padding: 18, maxHeight: '86%', borderWidth: StyleSheet.hairlineWidth, borderColor: rgba(C.ink, 0.08), shadowColor: C.shadow, shadowOpacity: 0.18, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  sheetTitle: { fontSize: 17, fontWeight: '800', color: C.ink },
  dateRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14, marginBottom: 10 },
  dateBtn: { width: 34, height: 30, borderRadius: 10, backgroundColor: C.chipBg, alignItems: 'center', justifyContent: 'center' },
  dateBtnT: { fontSize: 17, fontWeight: '800', color: C.sub },
  dateT: { fontSize: 14, fontWeight: '800', color: C.ink, minWidth: 96, textAlign: 'center' },
  fieldRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  field: { flex: 1 },
  fieldLabel: { fontSize: 11.5, fontWeight: '800', color: C.sub, marginBottom: 4 },
  fieldBox: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.bg, borderWidth: 1, borderColor: C.line, borderRadius: 12, paddingHorizontal: 10 },
  fieldInput: { flex: 1, paddingVertical: 10, fontSize: 18, fontWeight: '800', color: C.ink, fontVariant: ['tabular-nums'] },
  fieldUnit: { fontSize: 11, fontWeight: '700', color: C.faint },
  noteInput: { backgroundColor: C.bg, borderWidth: 1, borderColor: C.line, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: C.ink },
  disclaimer: { fontSize: 11, color: C.faint, lineHeight: 16, marginTop: 8 },
  err: { fontSize: 12, color: C.coral, marginTop: 8, lineHeight: 17 },
  btnRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  btnGhost: { flex: 1, borderWidth: 1.5, borderColor: C.line, borderRadius: 999, paddingVertical: 12, alignItems: 'center', backgroundColor: C.panel },
  btnGhostT: { fontSize: 14, fontWeight: '800', color: C.sub },
  btnPrimary: { flex: 1, backgroundColor: C.teal, borderRadius: 999, paddingVertical: 12, alignItems: 'center' },
  btnPrimaryT: { fontSize: 14, fontWeight: '800', color: '#fff' },
}));
