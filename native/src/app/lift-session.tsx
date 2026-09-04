// 筋トレ記録画面（全画面・Stack）。運動タブの「筋トレを記録する」から開く。
//
// ジムで「レストを見ながら」使う画面なので、上部にレストタイマーを常時出し、
// その下にセット行（1行=1セット: 種目・重量・回数）を積んでいく。
//   ・＋セット …… 前セットの種目・重量・回数を引き継いだ行を足し、ダイアルを開く（9→7→5 は回数だけ回す）
//   ・行タップ …… そのセットの重量と回数を同じダイアルで直す
//   ・自重種目 …… 加重/補助を1本のダイアル（−60〜+60kg・0=自重）で選ぶ（lib/liftSession.ts）
//   ・セットを決めるとレストが自動で始まる（終了で触覚＋バイブ）。長さはダイアルで選び 'bl-rest-sec' に記憶
// 保存は既存の記録（logs.text `🏋️ …`・adj=0）にそのまま落とす（lib/liftSession.ts sessionText）。
// 集計・e1RM・PR判定・オフラインキュー・履歴カードは従来のまま動く。
// セッション中の状態は AsyncStorage（bl-lift-session）に持ち、アプリを切り替えても消えない。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useThemeRefresh } from '@/lib/theme';
import { View, Text, Pressable, ScrollView, Alert, Vibration } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { Timer, Plus, Dumbbell, X } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { syncEntriesForDate } from '@/lib/sync';
import { enqueue, flush, pendingCount, isNetworkError } from '@/lib/offlineQueue';
import { C, RADIUS, SPACE, ICON, themed } from '@/lib/ui';
import { todayJST } from '@/lib/calc';
import { t } from '@/lib/i18n';
import { isBodyweightLift, loadCustomLifts } from '@/lib/lifts';
import { parseLiftText, liftSetLabel, effectiveKg, weightLookup } from '@/lib/liftLog';
import {
  LIFT_SESSION_KEY, REST_DEFAULT_SEC, REST_CHOICES, type LiftSessionState, type SessionSet,
  parseSessionState, serializeSessionState, restLeftSec, nextSet, newSetId, setReady, setToEntry,
  sessionText, sessionVolume, loadLabel,
} from '@/lib/liftSession';
import { epley1RM, parse1RMs, repsNeededFor } from '@/lib/rm';
import { bumpRestCount } from '@/lib/achievements';
import { bumpFoodFreq, readFoodFreq, foodScores } from '@/lib/foods';
import LiftPicker from '@/components/LiftPicker';
import SetDial from '@/components/SetDial';
import RestDial, { fmtRest } from '@/components/RestDial';
import PlateCalc from '@/components/PlateCalc';
import { OptionButton } from '@/components/ui/Selectable';

type HistRow = { id: string; date: string; text: string };

const mmss = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;

export default function LiftSessionScreen() {
  useThemeRefresh(); // テーマ変更で再描画（再マウントはしない・lib/theme.ts）
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ date?: string }>();
  const paramDate = typeof params.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : todayJST();

  // ===== セッション状態（端末に保持） =====
  const [st, setSt] = useState<LiftSessionState | null>(null);
  const loaded = useRef(false);
  useEffect(() => {
    (async () => {
      const [raw, restRaw] = await Promise.all([
        AsyncStorage.getItem(LIFT_SESSION_KEY).catch(() => null),
        AsyncStorage.getItem('bl-rest-sec').catch(() => null),
      ]);
      const restSec = REST_CHOICES.includes(Number(restRaw)) ? Number(restRaw) : REST_DEFAULT_SEC;
      const prev = parseSessionState(raw);
      // 途中のセッション（セットが1つ以上）があれば再開。無ければ運動タブで見ていた日付で新規
      if (prev && prev.sets.length > 0) setSt({ ...prev, restSec: REST_CHOICES.includes(prev.restSec) ? prev.restSec : restSec });
      else setSt({ date: paramDate, sets: [], restSec, restEndsAt: null, startedAt: Date.now() });
      loaded.current = true;
      loadCustomLifts();
    })();
  }, [paramDate]);
  useEffect(() => {
    if (!loaded.current || !st) return;
    AsyncStorage.setItem(LIFT_SESSION_KEY, serializeSessionState(st)).catch(() => {});
  }, [st]);
  const update = useCallback((patch: Partial<LiftSessionState>) => setSt((p) => (p ? { ...p, ...patch } : p)), []);

  // ===== 参照データ: 履歴（前回参照・RMフィードバック）と体重（自重種目の実負荷） =====
  const [history, setHistory] = useState<HistRow[]>([]);
  const [weightRows, setWeightRows] = useState<{ date: string; weight: number | null }[]>([]);
  const [actFreq, setActFreq] = useState<Record<string, number>>({});
  useEffect(() => {
    supabase.from('logs').select('id,date,text').like('text', '🏋️%').order('at', { ascending: false }).limit(60)
      .then(({ data }) => { if (data) setHistory(data as HistRow[]); }, () => {});
    supabase.from('entries').select('date,weight').not('weight', 'is', null).order('date', { ascending: false }).limit(400)
      .then(({ data }) => setWeightRows((data as { date: string; weight: number | null }[] | null) ?? []), () => {});
    setActFreq(foodScores(readFoodFreq()));
  }, []);
  const weightAt = useMemo(() => weightLookup(weightRows), [weightRows]);
  const myWeight = weightRows.length > 0 && weightRows[0].weight != null ? Number(weightRows[0].weight) : null;

  /** 同じ種目の直近記録（前回参照・新しい行の初期値） */
  function lastRecordOf(name: string): { text: string; kg: number; reps: number; date: string } | null {
    const nm = name.trim();
    if (!nm) return null;
    for (const h of history) {
      for (const e of parseLiftText(h.text)) {
        if (e.name !== nm) continue;
        return { text: liftSetLabel(e, t('自重')), kg: e.kg, reps: e.reps, date: h.date };
      }
    }
    return null;
  }
  // よく使う種目（保存の実績順・上位6件）＝種目ピッカーを開かずに1タップで足せる
  const favLifts = useMemo(() => Object.entries(actFreq)
    .filter(([k]) => k.startsWith('lift:')).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k]) => k.slice('lift:'.length)), [actFreq]);

  // ===== レストタイマー（終了時刻ベース。バックグラウンドでも進む） =====
  const [now, setNow] = useState(Date.now());
  const restEndsAt = st?.restEndsAt ?? null;
  const restSec = st?.restSec ?? REST_DEFAULT_SEC;
  const left = restLeftSec(restEndsAt, now);
  const fired = useRef<number | null>(null);
  useEffect(() => {
    if (restEndsAt == null) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [restEndsAt]);
  useEffect(() => {
    // 0になった瞬間に一度だけ知らせる（同じ終了時刻で二度鳴らさない）
    if (left === 0 && restEndsAt != null && fired.current !== restEndsAt) {
      fired.current = restEndsAt;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      try { Vibration.vibrate(500); } catch { /* 端末設定次第 */ }
    }
  }, [left, restEndsAt]);
  function startRest() {
    update({ restEndsAt: Date.now() + restSec * 1000 });
    setNow(Date.now());
    bumpRestCount();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }
  function stopRest() { update({ restEndsAt: null }); }
  const [restDial, setRestDial] = useState(false);
  function pickRest(sec: number) {
    AsyncStorage.setItem('bl-rest-sec', String(sec)).catch(() => {});
    // 動作中なら残りを新しい長さで測り直す
    update({ restSec: sec, restEndsAt: restEndsAt != null ? Date.now() + sec * 1000 : null });
    setRestDial(false);
  }

  // ===== セット行の編集 =====
  const sets = st?.sets ?? [];
  const [dial, setDial] = useState<{ set: SessionSet; isNew: boolean } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [plateOpen, setPlateOpen] = useState(false);
  /** 指定種目の新しい行を作ってダイアルを開く。初期値は同種目の直近セット > 前回記録 > 既定 */
  function addSetFor(name: string) {
    const lastSame = [...sets].reverse().find((x) => x.name === name) ?? null;
    let set: SessionSet;
    if (lastSame) set = nextSet(lastSame);
    else {
      const prev = lastRecordOf(name);
      set = { id: newSetId(), name, kg: prev ? prev.kg : (isBodyweightLift(name) ? 0 : 40), reps: prev ? prev.reps : 8 };
    }
    setDial({ set, isNew: true });
  }
  /** ＋セット: 直前の行を引き継ぐ（種目が無ければピッカーへ） */
  function addSet() {
    const last = sets[sets.length - 1];
    if (!last) { setPickerOpen(true); return; }
    setDial({ set: nextSet(last), isNew: true });
  }
  function onDialPick(kg: number, reps: number) {
    if (!dial) return;
    const s2 = { ...dial.set, kg, reps };
    update({ sets: dial.isNew ? [...sets, s2] : sets.map((x) => (x.id === s2.id ? s2 : x)) });
    setDial(null);
    // セットを終えた＝レスト開始（レストを見ながら次のセットへ）
    if (dial.isNew) startRest();
  }
  function removeSet(id: string) { update({ sets: sets.filter((x) => x.id !== id) }); }

  const volume = sessionVolume(sets, isBodyweightLift, myWeight);
  const readySets = sets.filter((x) => setReady(x, isBodyweightLift));
  const words = { bw: t('自重'), plus: t('加重'), assist: t('補助') };

  // ===== 保存 =====
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  async function save() {
    if (!st) return;
    const text = sessionText(sets, isBodyweightLift);
    if (!text) { setMsg(t('セットを1つ以上入れてください。')); return; }
    setSaving(true); setMsg(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) return;
      const row = {
        user_id: uid, date: st.date, items: [], kcal: null, p: null, f: null, c: null,
        weight: null, ex: 'オフ', adj: 0, mood: '', text, photo_urls: [],
      };
      let error: { message: string } | null = null;
      try { ({ error } = await supabase.from('logs').insert(row)); }
      catch (e) { error = { message: String((e as Error)?.message ?? e) }; }
      const names = [...new Set(readySets.map((x) => x.name.trim()))];
      if (error && isNetworkError(error)) {
        // 圏外: 端末に積んで成功扱い（電波が戻ったら運動タブの起点で自動送信）
        await enqueue(row);
        for (const n of names) bumpFoodFreq('lift:' + n);
        await finishSaved(t('圏外のため端末に保存しました。電波が戻ったら自動で同期されます。'));
        return;
      }
      if (error) { setMsg(t('保存に失敗しました。もう一度お試しください。')); return; }
      await syncEntriesForDate(uid, st.date);
      for (const n of names) bumpFoodFreq('lift:' + n);
      await finishSaved(await feedbackFor(names[0]));
      pendingCount().then((n) => { if (n > 0) flush().catch(() => {}); }).catch(() => {});
    } finally { setSaving(false); }
  }
  /** RMフィードバック: そのセッションの最高e1RMを目標・自己ベストと照合して一言返す */
  async function feedbackFor(name: string | undefined): Promise<string> {
    let fb = t('保存しました。継続が最強の種目です💪');
    if (!name) return fb;
    try {
      let est = 0; let bestKg = 0; let bestReps = 0;
      for (const x of readySets.filter((x) => x.name.trim() === name)) {
        const loadKg = effectiveKg(setToEntry(x, isBodyweightLift), myWeight);
        const e = Math.round(epley1RM(loadKg, x.reps));
        if (e > est) { est = e; bestKg = loadKg; bestReps = x.reps; }
      }
      if (est <= 0) return fb;
      let bestPast = 0;
      for (const h of history) for (const p of parse1RMs(h.text, weightAt(h.date))) {
        if (p.name === name) bestPast = Math.max(bestPast, Math.round(p.est));
      }
      const { data: tg } = await supabase.from('training_goals').select('target_kg').eq('name', name).maybeSingle();
      const goalKg = tg ? Math.round(Number(tg.target_kg)) : null;
      if (goalKg && est >= goalKg) {
        fb = t('🎉 目標達成！{name} 推定MAX {est}kg（目標{goal}kg超え）。次の目標を設定しよう', { name, est, goal: goalKg });
      } else if (goalKg) {
        const need = repsNeededFor(goalKg, bestKg);
        fb = t('おしい！RM換算だとMAX {est}kg。目標{goal}kgまであと{left}kg', { est, goal: goalKg, left: goalKg - est })
          + (need && need > bestReps ? t('（{kg}kgなら{need}回で到達）', { kg: bestKg, need }) : '');
      } else if (bestPast > 0 && est > bestPast) {
        fb = t('自己ベスト更新💪 {name} 推定MAX {est}kg（前回比 +{d}kg）', { name, est, d: est - bestPast });
      } else {
        fb = t('保存しました。{name} 推定MAX {est}kg（RM換算）', { name, est });
      }
    } catch { /* フィードバックが取れなくても保存は成功している */ }
    return fb;
  }
  async function finishSaved(fb: string) {
    await AsyncStorage.removeItem(LIFT_SESSION_KEY).catch(() => {});
    loaded.current = false;   // 消した直後に空セッションを書き戻さない
    setSaved(fb);
    update({ sets: [], restEndsAt: null });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }
  function startAnother() {
    setSaved(null); setMsg(null);
    setSt({ date: paramDate, sets: [], restSec, restEndsAt: null, startedAt: Date.now() });
    loaded.current = true;
  }
  function discard() {
    if (sets.length === 0) { AsyncStorage.removeItem(LIFT_SESSION_KEY).catch(() => {}); router.back(); return; }
    Alert.alert(t('このセッションを破棄しますか？'), t('{n}セットの入力が消えます。保存はされません。', { n: sets.length }), [
      { text: t('キャンセル'), style: 'cancel' },
      { text: t('破棄する'), style: 'destructive', onPress: () => {
        loaded.current = false;
        AsyncStorage.removeItem(LIFT_SESSION_KEY).catch(() => {});
        router.back();
      } },
    ]);
  }

  const isToday = st?.date === todayJST();
  const dateLabel = st ? st.date.slice(5).replace('-', '/') : '';
  const restPct = left != null && restSec > 0 ? Math.max(0, Math.min(100, (left / restSec) * 100)) : 0;
  const currentName = sets[sets.length - 1]?.name ?? null;
  const prev = currentName ? lastRecordOf(currentName) : null;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Stack.Screen options={{
        headerShown: true, title: t('筋トレを記録'), headerBackTitle: t('戻る'),
        headerTintColor: C.teal, headerShadowVisible: false,
        headerStyle: { backgroundColor: C.bg }, headerTitleStyle: { color: C.ink },
      }} />

      {/* ===== レストタイマー（常時見える。スクロールしない固定部） ===== */}
      <View style={[s.restPanel, left != null && left > 0 && s.restPanelOn, left === 0 && s.restPanelDone]}>
        <View style={s.restBarTrack}><View style={[s.restBarFill, { width: `${restPct}%` }]} /></View>
        <View style={s.restHead}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Timer size={ICON.sm} color={C.teal} />
            <Text style={s.restL}>{t('レスト')}</Text>
          </View>
          {/* 長さはダイアルで選ぶ（ボタン列は廃止） */}
          <Pressable style={s.restLenBtn} onPress={() => setRestDial(true)} hitSlop={8}>
            <Text style={s.restLenT}>{fmtRest(restSec)} ▾</Text>
          </Pressable>
        </View>
        {/* MM:SSは1行固定のため文字サイズ拡大は上限1.3 */}
        <Text style={[s.restN, left === 0 && { color: C.successInk }]} maxFontSizeMultiplier={1.3}>
          {left == null ? mmss(restSec) : left > 0 ? mmss(left) : t('終了💪 次のセットへ')}
        </Text>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
          <Pressable style={s.restBtn} onPress={startRest} hitSlop={6}>
            <Text style={s.restBtnT}>{left == null || left === 0 ? t('▶ 開始') : t('↻ やり直す')}</Text>
          </Pressable>
          {left != null && (
            <Pressable style={s.restBtnGhost} onPress={stopRest} hitSlop={6}>
              <Text style={s.restBtnGhostT}>{t('停止')}</Text>
            </Pressable>
          )}
        </View>
      </View>

      <ScrollView contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 28 }]} keyboardShouldPersistTaps="handled">
        {saved ? (
          // ===== 保存後 =====
          <View style={s.savedBox}>
            <Text style={s.savedT}>{saved}</Text>
            <OptionButton style={{ marginTop: 14 }} label={t('運動タブへ戻る')} onPress={() => router.back()} />
            <OptionButton style={{ marginTop: 8 }} variant="tonal" label={t('続けて記録する')} onPress={startAnother} />
          </View>
        ) : (
          <>
            {st && !isToday && (
              <Text style={s.dateNote}>{t('{d} の記録として保存します', { d: dateLabel })}</Text>
            )}

            {/* ===== セット行 ===== */}
            {sets.length === 0 ? (
              <View style={s.emptyBox}>
                <Dumbbell size={ICON.hero} color={C.teal} />
                <Text style={s.emptyT}>{t('種目を選んで1セット目を入れましょう')}</Text>
                <Text style={s.emptySub}>{t('重量と回数はダイアルで回すだけ。セットを決めるとレストが自動で始まります。')}</Text>
              </View>
            ) : (
              <View style={s.list}>
                {sets.map((x, i) => {
                  const bw = isBodyweightLift(x.name);
                  const showName = i === 0 || sets[i - 1].name !== x.name;
                  const setNo = sets.slice(0, i + 1).filter((y) => y.name === x.name).length;
                  const load = bw && myWeight ? effectiveKg(setToEntry(x, isBodyweightLift), myWeight) : null;
                  return (
                    <View key={x.id}>
                      {showName && <Text style={s.liftName}>{x.name}</Text>}
                      <Pressable style={s.setRow} onPress={() => setDial({ set: x, isNew: false })}>
                        <Text style={s.setNo}>{setNo}</Text>
                        <View style={[s.cell, { flex: 1.3 }]}>
                          <Text style={s.cellT} numberOfLines={1}>{loadLabel(x.kg, bw, words)}</Text>
                          {load != null && <Text style={s.cellSub}>{t('実負荷 約{n}kg', { n: load })}</Text>}
                        </View>
                        <View style={s.cell}>
                          <Text style={s.cellT}>{x.reps}<Text style={s.cellUnit}> {t('回')}</Text></Text>
                        </View>
                        <Pressable onPress={() => removeSet(x.id)} hitSlop={10} style={{ padding: 4 }}>
                          <X size={ICON.sm} color={C.faint} />
                        </Pressable>
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            )}

            {/* 前回参照（いま積んでいる種目） */}
            {prev && currentName && (
              <Text style={s.prevRef}>{t('前回: {name} {rec}（{date}）', { name: currentName, rec: prev.text, date: prev.date.slice(5).replace('-', '/') })}</Text>
            )}

            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
              <OptionButton style={{ flex: 1.2 }} variant="teal" label={t('＋ セット')} onPress={addSet}
                            leading={<Plus size={ICON.md} color="#fff" strokeWidth={ICON.strokeBold} />} />
              <OptionButton style={{ flex: 1 }} variant="tonal" label={sets.length === 0 ? t('種目を選ぶ') : t('別の種目')} onPress={() => setPickerOpen(true)} />
            </View>
            {/* よく使う種目は1タップで足せる */}
            {favLifts.length > 0 && (
              <View style={s.favRow}>
                {favLifts.map((n) => (
                  <Pressable key={n} style={s.favChip} onPress={() => addSetFor(n)}>
                    <Text style={s.favChipT}>{n}</Text>
                  </Pressable>
                ))}
              </View>
            )}

            {/* まとめと保存 */}
            {readySets.length > 0 && (
              <View style={s.sumRow}>
                <Text style={s.sumT}>{t('{n}セット', { n: readySets.length })}</Text>
                <Text style={s.sumT}>{t('総挙上 {v}kg', { v: volume.toLocaleString() })}</Text>
                <Pressable onPress={() => setPlateOpen(true)} hitSlop={8}>
                  <Text style={s.plateLink}>{t('プレート計算')}</Text>
                </Pressable>
              </View>
            )}
            {msg && <Text style={s.msg}>{msg}</Text>}
            <OptionButton style={{ marginTop: 14 }} label={t('保存する')} onPress={save} busy={saving} disabled={readySets.length === 0} />
            <Pressable onPress={discard} hitSlop={8} style={{ alignSelf: 'center', marginTop: 14 }}>
              <Text style={s.discard}>{sets.length === 0 ? t('とじる') : t('セッションを破棄')}</Text>
            </Pressable>
          </>
        )}
      </ScrollView>

      {dial && (
        <SetDial
          name={dial.set.name}
          bw={isBodyweightLift(dial.set.name)}
          initialKg={dial.set.kg}
          initialReps={dial.set.reps}
          bodyWeight={myWeight}
          subtitle={(() => {
            const p = lastRecordOf(dial.set.name);
            return p ? t('前回: {name} {rec}（{date}）', { name: dial.set.name, rec: p.text, date: p.date.slice(5).replace('-', '/') }) : undefined;
          })()}
          onClose={() => setDial(null)}
          onPick={onDialPick}
        />
      )}
      {restDial && <RestDial initial={restSec} onClose={() => setRestDial(false)} onPick={pickRest} />}
      {plateOpen && (
        <PlateCalc initial={[...sets].reverse().map((x) => x.kg).find((n) => n > 0) ?? 60} onClose={() => setPlateOpen(false)} />
      )}
      <LiftPicker
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        history={history.flatMap((h) => parseLiftText(h.text).map((x) => x.name))}
        onPick={(name) => { setPickerOpen(false); addSetFor(name); }}
      />
    </View>
  );
}

const s = themed(() => ({
  scroll: { padding: SPACE.screen },
  // レストタイマー（上部固定）
  restPanel: {
    marginHorizontal: SPACE.screen, marginTop: 8, marginBottom: 4,
    backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: RADIUS.tile,
    paddingHorizontal: 14, paddingVertical: 10, overflow: 'hidden',
  },
  restPanelOn: { backgroundColor: C.accentBadge, borderColor: C.accentBorder },
  restPanelDone: { backgroundColor: C.successWeak, borderColor: C.success },
  restBarTrack: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 3 },
  restBarFill: { height: 3, backgroundColor: C.teal, borderRadius: 2 },
  restHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  restL: { fontSize: 13, fontWeight: '800', color: C.ink },
  restLenBtn: { borderWidth: 1, borderColor: C.line, backgroundColor: C.panel, borderRadius: RADIUS.chip, paddingHorizontal: 10, paddingVertical: 4 },
  restLenT: { fontSize: 12, fontWeight: '800', color: C.accentInk, fontVariant: ['tabular-nums'] },
  restN: { fontSize: 40, fontWeight: '900', color: C.accentInk, fontVariant: ['tabular-nums'], textAlign: 'center', marginTop: 2, lineHeight: 46 },
  restBtn: { flex: 1, backgroundColor: C.teal, borderRadius: RADIUS.chip, paddingVertical: 9, alignItems: 'center' },
  restBtnT: { fontSize: 14, fontWeight: '800', color: '#fff' },   // アクセント塗り面の上の白文字は固定色
  restBtnGhost: { flex: 1, borderWidth: 1.5, borderColor: C.line, backgroundColor: C.panel, borderRadius: RADIUS.chip, paddingVertical: 9, alignItems: 'center' },
  restBtnGhostT: { fontSize: 14, fontWeight: '800', color: C.sub },
  dateNote: { fontSize: 12, fontWeight: '700', color: C.amber, marginBottom: 8, textAlign: 'center' },
  // 空状態
  emptyBox: { alignItems: 'center', gap: 6, paddingVertical: 26, paddingHorizontal: 16 },
  emptyT: { fontSize: 15, fontWeight: '800', color: C.ink, textAlign: 'center' },
  emptySub: { fontSize: 13, color: C.sub, textAlign: 'center', lineHeight: 18 },
  // セット行
  list: { gap: 2 },
  liftName: { fontSize: 15, fontWeight: '800', color: C.ink, marginTop: 10, marginBottom: 4 },
  setRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: RADIUS.input,
    paddingVertical: 10, paddingHorizontal: 10, marginBottom: 6,
  },
  setNo: { width: 22, fontSize: 13, fontWeight: '800', color: C.faint, textAlign: 'center', fontVariant: ['tabular-nums'] },
  cell: { flex: 1, backgroundColor: C.bg, borderRadius: RADIUS.input, paddingVertical: 8, paddingHorizontal: 10 },
  cellT: { fontSize: 17, fontWeight: '800', color: C.ink, fontVariant: ['tabular-nums'] },
  cellUnit: { fontSize: 12, fontWeight: '700', color: C.sub },
  cellSub: { fontSize: 11, fontWeight: '700', color: C.accentInk, marginTop: 1 },
  prevRef: { fontSize: 13, color: C.sub, marginTop: 8, lineHeight: 18 },
  favRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  favChip: { backgroundColor: C.chipBg, borderWidth: 1, borderColor: C.line, borderRadius: RADIUS.chip, paddingHorizontal: 12, paddingVertical: 7 },
  favChipT: { fontSize: 13, fontWeight: '700', color: C.sub },
  sumRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 16 },
  sumT: { fontSize: 13, fontWeight: '800', color: C.sub, fontVariant: ['tabular-nums'] },
  plateLink: { fontSize: 13, fontWeight: '800', color: C.accentInk, marginLeft: 'auto', textDecorationLine: 'underline' },
  msg: { fontSize: 14, fontWeight: '700', color: C.coral, marginTop: 10 },
  discard: { fontSize: 13, fontWeight: '700', color: C.sub, textDecorationLine: 'underline' },
  // 保存後
  savedBox: { backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: RADIUS.card, padding: SPACE.card, marginTop: 8 },
  savedT: { fontSize: 15, fontWeight: '700', color: C.successInk, lineHeight: 22 },
}));
