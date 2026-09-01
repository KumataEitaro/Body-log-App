// 筋トレ履歴カード（概要タブ「筋トレの成長」詳細の末尾に置く）。
// もとは運動タブにあったカードを切り出したもの。「入力は運動タブ・振り返りは概要タブ」の
// 役割分離のため、データ取得（履歴・体重）もこのコンポーネント内で自己完結させている。
//
// 【書き換え機能について】運動タブの履歴には「書き換える（入力欄へ戻す）」があったが、
// それは運動タブの入力欄（tRows）に記録を流し込む前提の機能で、概要タブには入力欄がない。
// そのためここでは長押しメニューを「削除のみ」にしている（1種目だけの削除は×で可能）。
import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert } from 'react-native';
import { BookOpen } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { syncEntriesForDate } from '@/lib/sync';
import { C } from '@/lib/ui';
import { Chip } from '@/components/ui/Selectable';
import { liftPartOf, liftPartLabel, LIFT_PARTS } from '@/lib/lifts';
import {
  groupLiftsByDay, removeLiftAt, liftSetLabel, weightLookup, volumeOf,
  type LiftEntry,
} from '@/lib/liftLog';
import { t } from '@/lib/i18n';
import { type ShowUndo } from '@/components/UndoSnackbar';

type HistRow = { id: string; date: string; text: string; at?: string | null };

// 運動タブの筋トレ保存と同じ行の形（Undoの再insert用）。
// atは元の時刻を保って日内の並びを維持する（無ければDBのnow()に任せる）
function liftRowOf(uid: string, date: string, text: string, at?: string | null) {
  return {
    user_id: uid, date, items: [], kcal: null, p: null, f: null, c: null,
    weight: null, ex: 'オフ', adj: 0, mood: '', text, photo_urls: [],
    ...(at ? { at } : {}),
  };
}

// 日見出し（例: 8/20(水)）。t()はモジュール読み込み時に評価すると言語切替に追従しないため関数内で呼ぶ
function dayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const wd = [t('日'), t('月'), t('火'), t('水'), t('木'), t('金'), t('土')];
  const dow = wd[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return t('{m}/{d}({w})', { m, d, w: dow });
}

// showUndo: 親画面（概要タブ）のUndoスナックバー。カード内に描くと絶対配置が
// カード相対になり画面下部に固定できないため、画面側のものを借りる
export default function LiftHistoryCard({ showUndo }: { showUndo?: ShowUndo }) {
  const [history, setHistory] = useState<HistRow[]>([]);
  // 自重種目の負荷は体重で変わるので、履歴の日付ごとに体重を引けるようにする
  const [weightRows, setWeightRows] = useState<{ date: string; weight: number | null }[]>([]);
  // 部位フィルタ（nullなら全部）
  const [partFilter, setPartFilter] = useState<string | null>(null);
  // ひらいている日（直近の日は最初からひらいておく）
  const [openDay, setOpenDay] = useState<string | null>(null);
  // 出す日数。ひと目で見渡せる量から始めて、必要なら遡れるようにする
  const [dayLimit, setDayLimit] = useState(10);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      // atも取る: 削除Undoの再insertで元の時刻を保つため（並びがorder by atのため）
      const { data } = await supabase.from('logs').select('id,date,text,at')
        .like('text', '🏋️%').order('at', { ascending: false }).limit(60);
      // 圏外での失敗（data=null）で既存の履歴を消さない（運動タブと同じ流儀）
      if (data) setHistory(data as HistRow[]);
    } catch { /* 圏外。手元のstateを保つ */ }
  }, []);
  useEffect(() => {
    load();
    supabase.from('entries').select('date,weight').not('weight', 'is', null)
      .order('date', { ascending: false }).limit(400)
      .then(({ data }) => setWeightRows((data as { date: string; weight: number | null }[] | null) ?? []));
  }, [load]);
  const weightAt = weightLookup(weightRows);

  // 履歴を日ごとにまとめる（食事の「その日の記録」と同じ見せ方にそろえる）
  const days = groupLiftsByDay(history, weightAt);
  const shownDay = openDay ?? days[0]?.date ?? null;
  const shownDays = days.slice(0, dayLimit);

  // 部位フィルタ。削除は元の並びのindexで行うため、entriesは絞らず描画時に飛ばす
  const matchPart = (e: LiftEntry) => partFilter == null || liftPartOf(e.name) === partFilter;
  // 日の見出しの数字は、フィルタ中はその部位ぶんだけで数え直す
  function dayStats(d: (typeof days)[number]) {
    if (partFilter == null) return { lifts: d.lifts, sets: d.sets, volume: d.volume, any: true };
    const w = weightAt(d.date);
    const names = new Set<string>();
    let sets = 0; let volume = 0; let any = false;
    for (const rec of d.records) for (const e of rec.entries) {
      if (!matchPart(e)) continue;
      any = true; names.add(e.name); sets += e.sets; volume += volumeOf(e, w);
    }
    return { lifts: names.size, sets, volume: Math.round(volume), any };
  }
  const visDays = partFilter == null ? shownDays : shownDays.filter((d) => dayStats(d).any);

  // 記録から1種目だけ取り除く（他の種目は残す）。
  // 確認は出さず即実行し、Undoで元のtext（種目一式）へ戻す
  async function deleteOneLift(rec: { id: string; text: string; entries: LiftEntry[] }, index: number, date: string) {
    const e = rec.entries[index];
    if (!e) return;
    // 復元データは削除前にメモリへ控える（textが記録の正本。行ごと消えたら同じ形で作り直す）
    const originalText = rec.text;
    const at = history.find((h) => h.id === rec.id)?.at ?? null;
    const { data: { session } } = await supabase.auth.getSession();
    const uid = session?.user?.id ?? null;
    const r = removeLiftAt(rec.entries, index);
    const q = r.kind === 'delete'
      ? supabase.from('logs').delete().eq('id', rec.id)
      : supabase.from('logs').update({ text: r.text }).eq('id', rec.id);
    const { error } = await q;
    // 削除APIが失敗したらスナックバーは出さず従来のエラーメッセージ
    if (error) { setMsg(t('削除に失敗しました。もう一度お試しください。')); return; }
    if (uid) await syncEntriesForDate(uid, date);
    setMsg(null);
    await load();
    showUndo?.(t('削除しました'), async () => {
      const { error: e2 } = r.kind === 'delete'
        ? await supabase.from('logs').insert(liftRowOf(uid ?? '', date, originalText, at))
        : await supabase.from('logs').update({ text: originalText }).eq('id', rec.id);
      if (e2) { setMsg(t('元に戻せませんでした。通信環境を確認してください。')); return; }
      if (uid) await syncEntriesForDate(uid, date);
      await load();
    });
  }

  // 記録の長押しメニュー。書き換え（入力欄へ戻す）は運動タブの入力欄に依存していたため、
  // 概要タブでは出さない＝削除のみ（冒頭のコメント参照）。削除は即実行＋Undo
  function confirmRecord(rec: { id: string; text: string }, date: string) {
    Alert.alert(t('この記録をどうしますか？'), rec.text.replace(/^🏋️ /, ''), [
      { text: t('キャンセル'), style: 'cancel' },
      { text: t('削除する'), style: 'destructive' as const, onPress: () => deleteRecordNow(rec, date) },
    ]);
  }

  // 記録まるごとの即削除＋Undo（元と同じ形の行をid無しで再insertして戻す）
  async function deleteRecordNow(rec: { id: string; text: string }, date: string) {
    const at = history.find((h) => h.id === rec.id)?.at ?? null;
    const { data: { session } } = await supabase.auth.getSession();
    const uid = session?.user?.id ?? null;
    const { error } = await supabase.from('logs').delete().eq('id', rec.id);
    if (error) { setMsg(t('削除に失敗しました。もう一度お試しください。')); return; }
    if (uid) await syncEntriesForDate(uid, date);
    setMsg(null);
    await load();
    showUndo?.(t('削除しました'), async () => {
      const { error: e2 } = await supabase.from('logs').insert(liftRowOf(uid ?? '', date, rec.text, at));
      if (e2) { setMsg(t('元に戻せませんでした。通信環境を確認してください。')); return; }
      if (uid) await syncEntriesForDate(uid, date);
      await load();
    });
  }

  return (
    <View style={s.card}>
      <View style={s.h2Row}><BookOpen size={16} color={C.teal} /><Text style={s.h2}>{t('筋トレ履歴')}</Text></View>
      {days.length === 0 && <Text style={s.muted}>{t('まだ記録がありません。今日の1セット目から始めましょう。')}</Text>}
      {/* 部位フィルタ: 「肩の日はいつだったか」を部位ごとに遡れるようにする */}
      {days.length > 0 && (() => {
        const present = new Set<string>();
        for (const d of days) for (const rec of d.records) for (const e of rec.entries) present.add(liftPartOf(e.name));
        const keys = [...LIFT_PARTS.map((x) => x.key), 'other'].filter((k) => present.has(k));
        if (keys.length < 2) return null;
        return (
          <View style={s.partRow}>
            <Chip label={t('全部')} selected={partFilter == null} onPress={() => setPartFilter(null)} />
            {keys.map((k) => (
              <Chip key={k} label={t(liftPartLabel(k))} selected={partFilter === k}
                    onPress={() => setPartFilter((cur) => (cur === k ? null : k))} />
            ))}
          </View>
        );
      })()}
      {visDays.map((d) => {
        const open = shownDay === d.date;
        const st = dayStats(d);
        return (
          <View key={d.date}>
            {/* 日の見出し: たたんだままでもその日の手応えが数字で分かる */}
            <Pressable style={s.dayHead} onPress={() => setOpenDay(open ? '' : d.date)} hitSlop={4}>
              <Text style={s.dayDate}>{dayLabel(d.date)}</Text>
              <Text style={s.daySum} numberOfLines={1}>
                {t('{n}種目', { n: st.lifts })}・{t('{n}セット', { n: st.sets })}
                {st.volume > 0 ? `・${st.volume.toLocaleString()}kg` : ''}
              </Text>
              <Text style={s.dayCaret}>{open ? '▴' : '▾'}</Text>
            </Pressable>
            {open && d.records
              .filter((rec) => partFilter == null || rec.entries.some(matchPart))
              .map((rec) => (
              <View key={rec.id}>
                {rec.entries.length === 0 && partFilter == null && (
                  <Pressable style={s.liftRow} onLongPress={() => confirmRecord(rec, d.date)} delayLongPress={450}>
                    <Text style={s.liftName}>{rec.text.replace(/^🏋️ /, '')}</Text>
                  </Pressable>
                )}
                {rec.entries.map((e, ix) => (matchPart(e) ? (
                  <Pressable key={`${rec.id}-${ix}`} style={s.liftRow}
                             onLongPress={() => confirmRecord(rec, d.date)} delayLongPress={450}>
                    <Text style={s.liftName} numberOfLines={1}>{e.name}</Text>
                    <Text style={s.liftSet}>{liftSetLabel(e, t('自重'))}</Text>
                    <Pressable onPress={() => deleteOneLift(rec, ix, d.date)} hitSlop={10}>
                      <Text style={s.liftX}>×</Text>
                    </Pressable>
                  </Pressable>
                ) : null))}
              </View>
            ))}
          </View>
        );
      })}
      {days.length > shownDays.length && (
        <Pressable style={s.moreBtn} onPress={() => setDayLimit((n) => n + 10)} hitSlop={6}>
          <Text style={s.moreBtnT}>{t('さらに前の{n}日を見る', { n: Math.min(10, days.length - shownDays.length) })}</Text>
        </Pressable>
      )}
      {days.length > 0 && <Text style={s.histHint}>{t('行を長押しで削除、×でその種目だけ削除できます')}</Text>}
      {msg && <Text style={s.err}>{msg}</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: C.panel, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(14,17,22,0.08)', borderRadius: 20, shadowColor: '#0e1116', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 2, padding: 14, marginBottom: 12 },
  h2: { fontSize: 17, fontWeight: '800', color: C.ink },
  h2Row: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  muted: { fontSize: 15, color: C.sub },
  partRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8, marginBottom: 2 },
  dayHead: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 9, borderTopWidth: 0.5, borderTopColor: C.line,
  },
  dayDate: { fontSize: 13, fontWeight: '800', color: C.ink, fontVariant: ['tabular-nums'] },
  daySum: { flex: 1, fontSize: 13, color: C.sub, fontWeight: '700' },
  dayCaret: { fontSize: 15, color: C.sub, fontWeight: '800' },
  liftRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 7, paddingLeft: 10, borderTopWidth: 0.5, borderTopColor: C.line,
  },
  liftName: { flex: 1, fontSize: 15, color: C.ink, fontWeight: '600' },
  liftSet: { fontSize: 15, color: C.sub, fontWeight: '700', fontVariant: ['tabular-nums'] },
  liftX: { fontSize: 17, color: C.coral, fontWeight: '800', paddingHorizontal: 2 },
  moreBtn: { alignSelf: 'center', paddingVertical: 9, paddingHorizontal: 14, marginTop: 6 },
  moreBtnT: { fontSize: 13, color: C.teal, fontWeight: '800' },
  histHint: { fontSize: 13, color: C.faint, marginTop: 8 },
  err: { fontSize: 13, fontWeight: '700', color: C.coral, marginTop: 6 },
});
