// 生理周期モードのカード — 概要タブ「からだ」＞生理周期（キー 'cycle'）
//
// 1500人監査「日本ダイエット層: 女性の周期変動を説明しないグラフが停滞期離脱を生む」。
// 月経前〜月経中は水分貯留で1〜2kg増えることがある。それを「太った」と誤解した人が、
// 積み上げてきた記録ごと投げ出してしまう。**「これは水分かもしれません」と言えるだけで救われる。**
//
// 【この画面がやらないこと】
// ・**次回予測を出さない。** 「次はいつ」を書いた瞬間、避妊・妊活の判断に使われうる医療領域に入る。
//   平均周期長は「これまでの記録の平均」として過去だけを述べ、未来の日付は一切生成しない。
// ・診断しない。症状も体調も聞かない。記録するのは開始日と任意メモだけ。
// ・「痩せていない」とも「大丈夫」とも言わない。言えるのは「〜とは限りません」まで。
//
// 表示条件は親（changes.tsx）が持つ: 設定「生理周期を記録する」がONの人にだけ行が現れる（既定OFF）。
// データは supabase/migration-28.sql【ユーザー実行待ち】。未適用でも壊れない（空状態の誘い文だけ）。
import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, Pressable, TextInput, Modal, ActivityIndicator,
  StyleSheet, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { Droplet, Plus, Trash2 } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { supabase } from '@/lib/supabase';
import { C, rgba, RADIUS, SPACE, ICON, HEAD, themed } from '@/lib/ui';
import { t } from '@/lib/i18n';
import {
  listCycleStarts, saveCycleStart, deleteCycleStart,
  cycleDay, averageCycleLength, isWaterRetentionWindow, recentCycles,
  todayJSTLocal, addDays, PERIOD_BAND_DAYS, type CycleLog,
} from '@/lib/cycle';

// 「7/28」式の短い日付（スペースを稼ぐため年は出さない。CycleCardと同じ流儀）
const fmtMD = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

export default function MenstrualCycleCard({ onChanged }: { onChanged?: () => void }) {
  const [logs, setLogs] = useState<CycleLog[]>([]);
  const [uid, setUid] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [date, setDate] = useState(todayJSTLocal());
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    setUid(session?.user?.id ?? null);
    setLogs(await listCycleStarts());
  }, []);
  useEffect(() => { load().catch(() => {}); }, [load]);

  const today = todayJSTLocal();
  const starts = logs.map((l) => l.start_date);
  const day = cycleDay(starts, today);
  const avg = averageCycleLength(starts);
  const recent = recentCycles(starts, 3);
  const inWindow = isWaterRetentionWindow(starts, today);

  function openSheet() {
    setDate(today);
    setNote('');
    setErr('');
    setOpen(true);
  }

  async function save() {
    if (!uid || busy) return;
    setBusy(true); setErr('');
    try {
      const r = await saveCycleStart(uid, date, note);
      if (!r.ok) { setErr(r.error); return; }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setOpen(false);
      await load();
      onChanged?.();
    } finally { setBusy(false); }
  }

  // 打ち間違いは必ず消せるようにする（記録をやめたい人の逃げ道でもある）
  async function remove(d: string) {
    if (!(await deleteCycleStart(d))) return;
    await load();
    onChanged?.();
  }

  return (
    <View style={s.card}>
      <View style={s.h2Row}>
        <Droplet size={ICON.md} color={C.teal} />
        <Text style={s.h2}>
          {t('生理周期')}
          <Text style={s.h2sub}>{t('— 体重の増減と重ねて見る')}</Text>
        </Text>
      </View>

      {starts.length === 0 ? (
        <Text style={s.muted}>{t('月経の開始日を記録すると、体重グラフにその期間の帯が重なります。増減が周期と重なっているかを、自分の目で確かめられます。')}</Text>
      ) : day != null ? (
        <>
          <Text style={s.lead} maxFontSizeMultiplier={1.3}>{t('今日は周期{n}日目', { n: day })}</Text>
          {/* 水分の説明。断定を避け「とは限りません」で止める（安全ガードの流儀） */}
          {inWindow && (
            <Text style={s.water}>{t('この数日は水分で体重が動きやすい時期です。増えていても、体脂肪が増えたとは限りません。')}</Text>
          )}
        </>
      ) : (
        // 90日以上あいた（=lib/cycleのcycleDayがnull）。適当な日数を名乗らず、記録へ誘う
        <Text style={s.muted}>{t('最後の記録から時間がたっています。開始日を記録すると、また周期の日数が出ます。')}</Text>
      )}

      {recent.length > 0 && (
        <>
          <View style={[s.row, s.rowHead]}>
            <Text style={[s.cell, s.cellDate, s.headT]}>{t('開始日')}</Text>
            <Text style={[s.cell, s.headT]}>{t('周期の長さ')}</Text>
            <View style={s.cellDel} />
          </View>
          {recent.map((c) => (
            <View key={c.start} style={s.row}>
              <Text style={[s.cell, s.cellDate, s.bodyT]}>{fmtMD(c.start)}</Text>
              <Text style={[s.cell, s.bodyT]}>
                {c.length != null ? t('{n}日', { n: c.length }) : t('進行中')}
              </Text>
              <Pressable style={s.cellDel} hitSlop={8} onPress={() => remove(c.start)} accessibilityLabel={t('削除する')}>
                <Trash2 size={ICON.xs} color={C.faint} />
              </Pressable>
            </View>
          ))}
          {avg != null && (
            <Text style={s.avg}>{t('これまでの平均 {n}日', { n: avg })}</Text>
          )}
        </>
      )}

      <Pressable style={s.addBtn} onPress={openSheet}>
        <Plus size={ICON.sm} color={C.teal} strokeWidth={2.6} />
        <Text style={s.addT}>{starts.length === 0 ? t('開始日を記録する') : t('開始日を記録')}</Text>
      </Pressable>

      {/* 予測しないことを明記する。空欄にしておくと「そのうち予測が出る」と読まれるため、
          出さないことを約束として書く（医療領域に踏み込まないという設計判断の可視化） */}
      <Text style={s.note}>
        {t('体重グラフの薄い帯は、記録した開始日から{n}日間の目安です。周期の長さには個人差があります。', { n: PERIOD_BAND_DAYS })}
      </Text>
      <Text style={s.note}>{t('次がいつ来るかの予測はしません。このアプリは医療機器ではなく、診断や避妊・妊活の判断には使えません。')}</Text>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} />
          <View style={s.sheet}>
            <View style={s.h2Row}>
              <Droplet size={ICON.lg} color={C.teal} />
              <Text style={s.sheetTitle}>{t('開始日を記録')}</Text>
            </View>
            {/* 日付は今日が既定。‹›で前後に動かせる（あとから思い出して入れる人のため） */}
            <View style={s.dateRow}>
              <Pressable style={s.dateBtn} onPress={() => setDate(addDays(date, -1))}>
                <Text style={s.dateBtnT}>‹</Text>
              </Pressable>
              <Text style={s.dateT}>{date === today ? t('今日') : date}</Text>
              <Pressable style={[s.dateBtn, date >= today && { opacity: 0.3 }]}
                         disabled={date >= today} onPress={() => setDate(addDays(date, 1))}>
                <Text style={s.dateBtnT}>›</Text>
              </Pressable>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled">
              <TextInput
                style={s.noteInput} value={note} onChangeText={setNote} maxLength={120}
                placeholder={t('メモ（任意）')} placeholderTextColor={C.faint}
              />
              <Text style={s.disclaimer}>{t('記録はあなたにだけ見えます。ほかの人には共有されません。')}</Text>
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
  card: { backgroundColor: C.panel, borderWidth: StyleSheet.hairlineWidth, borderColor: rgba(C.ink, 0.08), borderRadius: RADIUS.card, shadowColor: C.ink, shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 2, padding: SPACE.card, marginBottom: 12 },
  h2Row: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  h2: { fontSize: HEAD.card.fontSize, fontWeight: '800', color: C.ink },
  h2sub: { fontSize: 12, fontWeight: '700', color: C.faint },
  muted: { fontSize: 13, color: C.sub, lineHeight: 19 },
  lead: { fontSize: 19, fontWeight: '800', color: C.ink, fontVariant: ['tabular-nums'] },
  water: { fontSize: 13, color: C.sub, lineHeight: 19, marginTop: 6 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line },
  rowHead: { paddingVertical: 4, marginTop: 10 },
  cell: { flex: 1, textAlign: 'right', fontSize: 13, fontVariant: ['tabular-nums'] },
  cellDate: { flex: 1.1, textAlign: 'left' },
  cellDel: { width: 26, alignItems: 'flex-end' },
  headT: { fontSize: 11, fontWeight: '800', color: C.faint },
  bodyT: { color: C.ink, fontWeight: '700' },
  avg: { fontSize: 12.5, color: C.sub, fontWeight: '700', marginTop: 8, fontVariant: ['tabular-nums'] },
  addBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 12, borderWidth: 1.5, borderColor: C.accentBorder, borderRadius: RADIUS.chip, paddingVertical: 10, backgroundColor: C.accentSoft },
  addT: { fontSize: 13, fontWeight: '800', color: C.accentInk },
  note: { fontSize: 11.5, color: C.faint, lineHeight: 17, marginTop: 8 },
  // ---- 入力シート（VitalsCardと同じ作り） ----
  backdrop: { flex: 1, justifyContent: 'center', padding: 20, backgroundColor: rgba(C.ink, 0.45) },
  sheet: { backgroundColor: C.panel, borderRadius: RADIUS.card, padding: 18, maxHeight: '86%', borderWidth: StyleSheet.hairlineWidth, borderColor: rgba(C.ink, 0.08), shadowColor: C.ink, shadowOpacity: 0.18, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  sheetTitle: { fontSize: HEAD.card.fontSize, fontWeight: '800', color: C.ink },
  dateRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14, marginBottom: 10 },
  dateBtn: { width: 34, height: 30, borderRadius: RADIUS.input, backgroundColor: C.chipBg, alignItems: 'center', justifyContent: 'center' },
  dateBtnT: { fontSize: 17, fontWeight: '800', color: C.sub },
  dateT: { fontSize: 14, fontWeight: '800', color: C.ink, minWidth: 96, textAlign: 'center' },
  noteInput: { backgroundColor: C.bg, borderWidth: 1, borderColor: C.line, borderRadius: RADIUS.input, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: C.ink },
  disclaimer: { fontSize: 11.5, color: C.faint, lineHeight: 17, marginTop: 8 },
  err: { fontSize: 12, color: C.coral, marginTop: 8, lineHeight: 17 },
  btnRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  btnGhost: { flex: 1, borderWidth: 1.5, borderColor: C.line, borderRadius: RADIUS.chip, paddingVertical: 12, alignItems: 'center', backgroundColor: C.panel },
  btnGhostT: { fontSize: 14, fontWeight: '800', color: C.sub },
  btnPrimary: { flex: 1, backgroundColor: C.teal, borderRadius: RADIUS.chip, paddingVertical: 12, alignItems: 'center' },
  btnPrimaryT: { fontSize: 14, fontWeight: '800', color: '#fff' },
}));
