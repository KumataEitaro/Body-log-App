// おかえりフロー（B-12）: 3日以上あいて戻ってきた人に見せる、責めない1画面。
//
// このアプリのL4思想「失敗の日にいちばん優しい」の中核。
// 記録が途切れた人がアプリを開く瞬間は、罪悪感がいちばん高い瞬間でもある。
// そこで数字（何日空いたか）を突きつけると、開いたこと自体を後悔させてしまう。
// だから「◯日ぶり」とは絶対に言わず、「休憩だった」と再定義して、
// 再開のハードルを「体重1つ（それも任意）」まで下げる。
//
// 発火判定はこのコンポーネント内に閉じ込める（log.tsxは巨大なので配線を増やさない）:
//  ・最後の記録日（logsの最新date）が3日以上前 かつ 過去に記録が1件以上ある
//  ・同じ空白期間には一度だけ（AsyncStorageに「表示時の最終記録日」を覚え、同値なら出さない）
import { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, Modal, KeyboardAvoidingView, Platform } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getFirstRunFlag, setFirstRunFlag } from '@/lib/firstrun';
import { Flame } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { syncEntriesForDate } from '@/lib/sync';
import { invalidateStreak } from '@/lib/achievements';
import { todayJST } from '@/lib/calc';
import { useUnits, displayToKg } from '@/lib/units';
import { confirmOutlierWeight } from '@/lib/guard';
import { C, themed } from '@/lib/ui';
import { t } from '@/lib/i18n';
import MoodFace from '@/components/MoodFace';

const SHOWN_KEY = 'bl-comeback-shown';   // 最後に表示した際の「最終記録日」

export default function ComebackSheet({ onSaved }: {
  onSaved?: () => void;   // 体重を保存して再開したとき（親のデータ再読込用）
}) {
  const units = useUnits();
  const [visible, setVisible] = useState(false);
  const [uid, setUid] = useState<string | null>(null);
  const [weight, setWeight] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);   // 保存成功→短いお祝い→自動で閉じる
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // マウント時に一度だけ判定する。表示中に他のModalと重ならないよう、
  // 発火はマウント直後のみ（食事タブの他のシートはユーザー操作でしか開かない）
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const userId = session?.user?.id;
        if (!userId) return;
        // 最後の記録日を1クエリで取得（日付降順の先頭）。記録ゼロ＝完全新規には出さない
        const { data } = await supabase.from('logs')
          .select('date').order('date', { ascending: false }).limit(1);
        const last = data?.[0]?.date ? String(data[0].date) : null;
        if (!last) return;
        const gapDays = Math.round((Date.parse(todayJST()) - Date.parse(last)) / 86400000);
        if (!(gapDays >= 3)) return;
        // 同じ空白期間には一度だけ。「表示した」時点で記憶する（閉じ方を問わない）
        if ((await getFirstRunFlag(SHOWN_KEY)) === last) return;
        await setFirstRunFlag(SHOWN_KEY, last);
        if (!alive) return;
        setUid(userId);
        setVisible(true);
        // 開いたときの触覚は最小限に（お祝いの通知触覚はやりすぎ。静かに寄り添う）
        Haptics.selectionAsync().catch(() => {});
      } catch { /* おかえり演出は本体機能に影響させない（出せなくても害ゼロ） */ }
    })();
    return () => {
      alive = false;
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  function close() {
    setVisible(false);
    setErr(null);
  }

  // 「保存して再開」: 体重が入っていればlogs→entriesの既存経路で保存、空ならそのまま閉じる
  async function saveAndResume() {
    if (busy || done) return;
    const raw = weight.trim();
    if (!raw) { close(); return; }
    // 入力は表示単位（kg/lb）。DBは常にkgで保存する（体重クイック入力と同じ流儀）
    const w = displayToKg(Number(raw), units.weight);
    if (!uid || !(w > 20 && w < 300)) { setErr(t('体重の値を確認してください。')); return; }
    setBusy(true);
    try {
      // G8: 空白明けは特に打ち間違いが起きやすい（久しぶりで単位や桁の感覚がズレる）。
      // 前回の記録体重を取り、±15%以上ずれていたら保存前に一度だけ確かめる
      const { data: prevRows } = await supabase.from('entries')
        .select('weight').not('weight', 'is', null).order('date', { ascending: false }).limit(1);
      const prevW = prevRows?.length ? Number(prevRows[0].weight) : null;
      if (!(await confirmOutlierWeight(prevW, w))) return;
      const today = todayJST();
      // 食事タブの体重クイック入力と同じ経路: logsへ1行→entriesへ日次サマリー同期（upsert）
      await supabase.from('logs').insert({
        user_id: uid, date: today, items: [], kcal: null, p: null, f: null, c: null,
        weight: Math.round(w * 10) / 10, ex: 'オフ', adj: 0, mood: '', text: '', photo_urls: [],
      });
      await syncEntriesForDate(uid, today);
      invalidateStreak();   // 今日の記録で🔥チップを最新化
      setErr(null);
      setDone(true);
      onSaved?.();
      // お祝いを一拍見せてから、自分から静かに退場する（閉じる操作を求めない）
      closeTimer.current = setTimeout(() => setVisible(false), 1800);
    } catch {
      setErr(t('保存に失敗しました。もう一度お試しください。'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <KeyboardAvoidingView style={s.wrap} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.body}>
          {/* 顔＋見出し: 空白を「おかえり」で迎える（数えあげない） */}
          <Animated.View entering={FadeInDown.duration(400).delay(80)} style={s.heroBlock}>
            <View style={s.faceRing}>
              <MoodFace level={4} size={64} color={C.teal} />
            </View>
            <Text style={s.title}>{t('おかえりなさい')}</Text>
            <Text style={s.sub}>{t('空白は失敗じゃなくて、休憩です。今日からまた、1行だけ。')}</Text>
          </Animated.View>

          {/* やさしい一言: 「積み上げは消えていない」ことを先に保証する */}
          <Animated.View entering={FadeInDown.duration(400).delay(220)} style={s.noteCard}>
            <Flame size={18} color={C.teal} />
            <Text style={s.noteText}>{t('前回までの記録はぜんぶ残っています。AIもあなたの法則を覚えています。')}</Text>
          </Animated.View>

          {done ? (
            // 保存後: 短いお祝いだけ見せて自動で閉じる
            <Animated.View entering={FadeInDown.duration(300)} style={s.doneCard}>
              <Text style={s.doneText}>{t('おかえりなさい。今日から再開です 🎉')}</Text>
            </Animated.View>
          ) : (
            <>
              {/* 任意の再開アクション: 体重1つだけ。空のままでも何も損なわれない */}
              <Animated.View entering={FadeInDown.duration(400).delay(360)} style={s.inputBlock}>
                <Text style={s.inputLabel}>{t('もしよければ、いまの体重だけ（空欄のままでも大丈夫）')}</Text>
                <View style={s.inputRow}>
                  <TextInput
                    style={s.wInput} keyboardType="decimal-pad" placeholder="—" placeholderTextColor={C.faint}
                    value={weight} onChangeText={(v) => { setWeight(v); setErr(null); }} maxLength={6}
                  />
                  <Text style={s.wUnit}>{units.weight}</Text>
                </View>
                {err && <Text style={s.err}>{err}</Text>}
                <Pressable
                  style={({ pressed }) => [s.primaryBtn, (pressed || busy) && { opacity: 0.75 }]}
                  onPress={saveAndResume} disabled={busy}>
                  <Text style={s.primaryBtnT}>{t('保存して再開')}</Text>
                </Pressable>
              </Animated.View>

              {/* 逃げ道を明るく用意する: 閉じることは失敗ではない */}
              <Animated.View entering={FadeInDown.duration(400).delay(480)}>
                <Pressable onPress={close} hitSlop={10} style={s.softClose}>
                  <Text style={s.softCloseT}>{t('そっと閉じる（開いてくれただけで十分です）')}</Text>
                </Pressable>
              </Animated.View>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = themed(() => ({
  wrap: { flex: 1, backgroundColor: C.bg },
  body: { flex: 1, paddingHorizontal: 24, justifyContent: 'center', paddingBottom: 40 },
  heroBlock: { alignItems: 'center', marginBottom: 22 },
  faceRing: {
    width: 104, height: 104, borderRadius: 52, alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.accentSoft, borderWidth: 1, borderColor: C.accentBorder, marginBottom: 18,
  },
  title: { fontSize: 27, fontWeight: '800', color: C.ink, letterSpacing: -0.3 },
  sub: { fontSize: 15, color: C.sub, lineHeight: 23, textAlign: 'center', marginTop: 10 },
  noteCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 16,
    paddingHorizontal: 15, paddingVertical: 13, marginBottom: 22,
  },
  noteText: { flex: 1, fontSize: 13.5, color: C.ink, lineHeight: 20 },
  inputBlock: { marginBottom: 18 },
  inputLabel: { fontSize: 13, fontWeight: '700', color: C.sub, marginBottom: 8 },
  inputRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 4,
  },
  wInput: { flex: 1, fontSize: 21, fontWeight: '700', color: C.ink, paddingVertical: 10, fontVariant: ['tabular-nums'] },
  wUnit: { fontSize: 15, fontWeight: '700', color: C.sub },
  err: { fontSize: 12.5, color: C.coral, marginTop: 7 },
  primaryBtn: {
    marginTop: 12, backgroundColor: C.teal, borderRadius: 999,
    paddingVertical: 14, alignItems: 'center',
  },
  primaryBtnT: { fontSize: 16, fontWeight: '800', color: '#fff' },
  doneCard: {
    backgroundColor: C.tealWeak, borderRadius: 16, paddingVertical: 18, paddingHorizontal: 16,
    alignItems: 'center',
  },
  doneText: { fontSize: 15.5, fontWeight: '800', color: C.successInk, textAlign: 'center', lineHeight: 22 },
  softClose: { alignSelf: 'center', paddingVertical: 10, paddingHorizontal: 8 },
  softCloseT: { fontSize: 13.5, color: C.faint, fontWeight: '600' },
}));
