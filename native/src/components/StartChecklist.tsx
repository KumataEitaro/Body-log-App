// スタートチェックリスト（新規ユーザーの最初の1週間の道しるべ）
// 狙い: オンボ直後の「次に何をすればいいか分からない」を消し、看板機能
// （つぶやき入力・写真解析・AI相談・法則につながる記録習慣）を最初の数日で全部体験させる。
//  ・6項目すべて既存データから自動判定（手動チェックなし＝やれば勝手に✓が付く）
//  ・表示は登録から14日以内。全完了した瞬間に祝祭→24時間たつと自動で消える
//  ・途中でも×でいつでも消せる（責めない。cards.hideなので⊕から戻せる）
import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Animated } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getFirstRunFlag, setFirstRunFlag } from '@/lib/firstrun';
import * as Haptics from 'expo-haptics';
import { Check, ChevronRight, ListChecks, PartyPopper, X } from 'lucide-react-native';
import { C, themed } from '@/lib/ui';
import { t } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import { getDailyReminderPrefs } from '@/lib/notify';
import { MinusBadge } from '@/components/CardLayout';

// 全完了した瞬間のepoch(ms)。これを起点に「翌日から自動で消える」を判定する
const DONE_KEY = 'bl-start-checklist-done';
const COACH_HIST_KEY = 'bl-coach-history';   // 相談タブのローカル履歴（coach.tsxと同じキー）

const CHECK_IDS = ['profile', 'meal', 'photo', 'weight', 'coach', 'notify'] as const;
type CheckId = typeof CHECK_IDS[number];
type Checks = Record<CheckId, boolean>;

/**
 * 表示判定（純関数・テスト対象）:
 *  ・登録（auth.userのcreated_at）から14日以内であること
 *  ・全完了から24時間が経過していないこと（完了直後〜翌日は祝祭を見せてから消える）
 */
export function shouldShowChecklist(
  createdAtIso: string | null | undefined, doneAtMs: number | null, now: number,
): boolean {
  const created = createdAtIso ? Date.parse(createdAtIso) : NaN;
  if (!Number.isFinite(created) || now - created > 14 * 86400000) return false;
  if (doneAtMs != null && now - doneAtMs >= 24 * 3600000) return false;
  return true;
}

export default function StartChecklist({ editing, onHide, onFocusInput, onTakePhoto, onFocusWeight, refreshKey, onVisible, suppressed }: {
  editing: boolean;
  onVisible?: (v: boolean) => void;   // 表示条件（14日以内・未完了）を満たしているかを親へ知らせる（ヒーロー直下の調停 lib/logCards.ts の候補に使う）
  suppressed?: boolean;               // 親の調停で今回は枠が無いとき。判定は続けるが描かない
  onHide: () => void;          // cards.hide('checklist')（⊕からいつでも戻せる）
  onFocusInput: () => void;    // 入力ドックへフォーカス（つぶやき入力）
  onTakePhoto: () => void;     // 写真ボタン（カメラ撮影→AI解析）
  onFocusWeight: () => void;   // 体重クイック入力へフォーカス
  refreshKey?: number;         // 親のデータが変わったら再判定するための合図（例: 当日ログ件数）
}) {
  const router = useRouter();
  const [show, setShow] = useState(false);
  const [checks, setChecks] = useState<Checks | null>(null);
  const [allDone, setAllDone] = useState(false);
  // プロフィールと目標のどちらが欠けているかで誘導先のシートを変える
  const missingProfile = useRef(true);

  // 進捗ミニバー（n/6・スプリング）。widthアニメのためJS駆動（小さなバーなので負荷は無視できる）
  const progress = useRef(new Animated.Value(0)).current;

  const refresh = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) { setShow(false); onVisible?.(false); return; }
      const doneRaw = await getFirstRunFlag(DONE_KEY);
      const doneAt = doneRaw != null && Number.isFinite(Number(doneRaw)) ? Number(doneRaw) : null;
      if (!shouldShowChecklist((user as { created_at?: string }).created_at, doneAt, Date.now())) {
        setShow(false);
        onVisible?.(false);
        return;
      }
      // 判定クエリはすべてlimit 1系（存在確認だけ）で軽く
      const [profRes, goalRes, mealRes, photoRes, weightRes, coachRes, coachLocalRaw, notif] = await Promise.all([
        supabase.from('profiles').select('height_cm').eq('id', user.id).maybeSingle(),
        supabase.from('goals').select('target_weight').maybeSingle(),
        supabase.from('logs').select('id').not('kcal', 'is', null).limit(1),
        supabase.from('ai_usage').select('photo_count').gt('photo_count', 0).limit(1),
        supabase.from('entries').select('date').not('weight', 'is', null).limit(1),
        supabase.from('ai_usage').select('coach_count').gt('coach_count', 0).limit(1),
        AsyncStorage.getItem(COACH_HIST_KEY),
        getDailyReminderPrefs(),
      ]);
      const hasProfile = (profRes.data as { height_cm?: number | null } | null)?.height_cm != null;
      const hasGoal = (goalRes.data as { target_weight?: number | null } | null)?.target_weight != null;
      missingProfile.current = !hasProfile;
      let coachLocal = false;
      try { coachLocal = (JSON.parse(coachLocalRaw || '[]') as unknown[]).length > 0; } catch { /* 壊れていたら未相談扱い */ }
      const next: Checks = {
        profile: hasProfile && hasGoal,
        meal: ((mealRes.data as unknown[] | null)?.length ?? 0) > 0,
        photo: ((photoRes.data as unknown[] | null)?.length ?? 0) > 0,
        weight: ((weightRes.data as unknown[] | null)?.length ?? 0) > 0,
        coach: coachLocal || ((coachRes.data as unknown[] | null)?.length ?? 0) > 0,
        notify: notif.mode !== 'off',
      };
      const done = CHECK_IDS.every((k) => next[k]);
      setChecks(next);
      setAllDone(done);
      setShow(true);
      onVisible?.(true);
      // 全完了の初検出: 祝祭（成功ハプティクス）＋完了時刻を永続化（翌日から自動で消える起点）
      if (done && doneAt == null) {
        await setFirstRunFlag(DONE_KEY, String(Date.now()));
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      }
    } catch { setShow(false); onVisible?.(false); /* 判定に失敗しても画面は壊さない */ }
  }, [onVisible]);

  // マウント時＋タブがフォーカスされるたびに再判定（記録して戻ってきたら✓が付く）
  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));
  // 同じ画面のまま記録が増えたときも追従（親から当日ログ件数などを合図にもらう）
  useEffect(() => { refresh(); }, [refreshKey, refresh]);

  const doneCount = checks ? CHECK_IDS.filter((k) => checks[k]).length : 0;
  useEffect(() => {
    Animated.spring(progress, { toValue: doneCount / CHECK_IDS.length, useNativeDriver: false, friction: 8, tension: 60 }).start();
  }, [doneCount, progress]);

  if (!show || !checks || suppressed) return null;

  // 未完了行のタップ→該当機能へ誘導（既存の遷移手段だけを使う）
  const go: Record<CheckId, () => void> = {
    profile: () => router.push({ pathname: '/settings', params: { open: missingProfile.current ? 'profile' : 'goal', ts: String(Date.now()) } }),
    meal: onFocusInput,
    photo: onTakePhoto,
    weight: onFocusWeight,
    coach: () => router.push('/coach' as never),
    notify: () => router.push('/settings' as never),
  };
  const labels: Record<CheckId, string> = {
    profile: t('プロフィールと目標を設定する'),
    meal: t('最初の食事を、つぶやきで記録する'),
    photo: t('写真で1回記録してみる'),
    weight: t('体重を1回記録する'),
    coach: t('AIに1回相談してみる'),
    notify: t('通知を設定する（記録がない日だけ）'),
  };

  return (
    <View style={[s.card, allDone && s.cardDone]}>
      <MinusBadge editing={editing} onPress={onHide} />
      <View style={s.head}>
        {allDone
          ? <PartyPopper size={17} color={C.teal} />
          : <ListChecks size={17} color={C.teal} />}
        <Text style={s.title}>{t('スタートチェックリスト')}</Text>
        <Text style={s.count}>{doneCount}/{CHECK_IDS.length}</Text>
        {/* 途中でもいつでも消せる（責めない。⊕の「表示する項目を編集」から戻せる） */}
        <Pressable onPress={onHide} hitSlop={10} accessibilityLabel={t('スタートチェックリスト') + ' ×'}>
          <X size={16} color={C.faint} />
        </Pressable>
      </View>

      {/* 進捗ミニバー（スプリング） */}
      <View style={s.barTrack}>
        <Animated.View style={[s.barFill, {
          width: progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
        }]} />
      </View>

      {allDone ? (
        <Text style={s.doneT}>{t('ぜんぶ完了！あなたの記録生活、いいスタートです 🎉')}</Text>
      ) : (
        <Text style={s.lead}>{t('最初の1週間で、ぜんぶ試してみましょう。やれば自動で✓が付きます。')}</Text>
      )}

      {CHECK_IDS.map((k, i) => {
        const done = checks[k];
        return (
          <Pressable key={k} disabled={done}
                     style={({ pressed }) => [s.row, i === CHECK_IDS.length - 1 && { borderBottomWidth: 0, paddingBottom: 2 }, pressed && { opacity: 0.6 }]}
                     onPress={() => { Haptics.selectionAsync().catch(() => {}); go[k](); }}>
            <View style={[s.circle, done && s.circleDone]}>
              {done && <Check size={13} color="#fff" strokeWidth={3.5} />}
            </View>
            {/* 完了は取り消し線なし・薄くするだけ（打ち消しではなく「済んだ」の表現） */}
            <Text style={[s.rowT, done && s.rowTDone]} numberOfLines={2}>{labels[k]}</Text>
            {!done && <ChevronRight size={15} color={C.faint} />}
          </Pressable>
        );
      })}
    </View>
  );
}

const s = themed(() => ({
  card: {
    backgroundColor: C.panel, borderRadius: 18, padding: 14, marginBottom: 12,
    borderWidth: StyleSheet.hairlineWidth, borderColor: C.hairline,
    shadowColor: C.shadow, shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 2,
  },
  cardDone: { backgroundColor: C.accentSoft, borderColor: C.tealWeak },
  head: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  title: { flex: 1, fontSize: 15, fontWeight: '800', color: C.ink },
  count: { fontSize: 13, fontWeight: '900', color: C.accentInk, fontVariant: ['tabular-nums'], marginRight: 4 },
  barTrack: { height: 6, borderRadius: 3, backgroundColor: C.track, marginTop: 10, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 3, backgroundColor: C.teal },
  lead: { fontSize: 12, color: C.sub, lineHeight: 17, marginTop: 8, marginBottom: 2 },
  doneT: { fontSize: 13.5, fontWeight: '800', color: C.successInk, lineHeight: 19, marginTop: 8, marginBottom: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line },
  circle: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: C.line, alignItems: 'center', justifyContent: 'center', backgroundColor: C.chipBg },
  circleDone: { backgroundColor: C.teal, borderColor: C.teal },
  rowT: { flex: 1, fontSize: 13.5, fontWeight: '700', color: C.ink, lineHeight: 18 },
  rowTDone: { color: C.sub, opacity: 0.6 },
}));
