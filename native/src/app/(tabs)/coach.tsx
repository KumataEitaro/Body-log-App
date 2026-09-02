// AIコーチ相談タブ: 本人データを根拠に回答
// 初期状態は中央寄せのウェルカムUI（アイコン+2x2クイック質問）。会話開始後は通常のタイムライン
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform, Alert, Modal, Animated } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ArrowUp, Utensils, TrendingDown, Dumbbell, Moon, ChevronDown, History, X, MessageCircle, Sparkles, SquarePen, type LucideIcon } from 'lucide-react-native';
import * as Crypto from 'expo-crypto';
import * as Haptics from 'expo-haptics';
import { Keyboard } from 'react-native';
import { useGate } from '@/lib/gate';
import CrownBadge from '@/components/CrownBadge';
import { useKeyboardVisible } from '@/lib/useKeyboardVisible';
import AiCoachLogo from '@/components/AiCoachLogo';
import { apiPost } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { C, sheetTopPad, RADIUS, SPACE, ICON, HEAD, themed } from '@/lib/ui';
import StatusBarMask from '@/components/StatusBarMask';
import { useGuideTarget } from '@/components/GuideTour';
import VoiceHintButton from '@/components/VoiceHintButton';
import HeaderGear from '@/components/HeaderGear';
import { t, apiLang } from '@/lib/i18n';
import { useRouter } from 'expo-router';
import AskCatalog from '@/components/AskCatalog';
import ColumnReader from '@/components/ColumnReader';
import { featuredQuestions } from '@/content/askExamples';
import { validateAction, isApplicable, type CoachAction, type ApplyPlan } from '@/lib/coachAction';
import { setPendingMeal } from '@/lib/pendingMeal';
import { todayJST } from '@/lib/calc';
import { useReduceMotion } from '@/lib/motion';

type Msg = { role: 'user' | 'ai'; text: string; action?: CoachAction; applied?: boolean; upgrade?: boolean };

// 相談セッションのID（UUID v4）。expo-cryptoが使えない環境（jest等）ではMath.random版に
// フォールバックする（秘匿用途ではなく「今日はじめて見たIDか」の識別にしか使わないため十分）
function newSessionId(): string {
  try { return Crypto.randomUUID(); } catch { /* フォールバックへ */ }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// 過去の相談は端末に保存して日付で振り返れるようにする
type HistEntry = { d: string; role: 'user' | 'ai'; text: string };
const HIST_KEY = 'bl-coach-history';
const HIST_MAX = 800;

// 毎回同じ4つでは飽きるので日付で入れ替える（カタログから巡回して取る）
const ICONS: LucideIcon[] = [Utensils, TrendingDown, Dumbbell, Moon];
const quickList = (): { Icon: LucideIcon; t: string }[] => {
  const dayIndex = Math.floor(Date.now() / 86_400_000);
  return featuredQuestions(dayIndex, 4).map((q, i) => ({ Icon: ICONS[i % ICONS.length], t: q }));
};

// AI回答の軽量リッチ表示: **太字**・「・」箇条書き・空行をネイティブに描画（Wall of Text対策）
function RichText({ text, style }: { text: string; style: object }) {
  const bold = (s2: string) =>
    s2.split(/\*\*(.+?)\*\*/g).map((p, j) => (j % 2 === 1 ? <Text key={j} style={{ fontWeight: '800' }}>{p}</Text> : p));
  return (
    <View>
      {text.split('\n').map((ln, i) => {
        if (ln.trim() === '') return <View key={i} style={{ height: 7 }} />;
        const m = ln.match(/^[・\-•]\s?(.*)$/);
        if (m) {
          return (
            <View key={i} style={{ flexDirection: 'row', marginTop: 2 }}>
              <Text style={[style, { marginRight: 5 }]}>・</Text>
              <Text style={[style, { flex: 1 }]}>{bold(m[1])}</Text>
            </View>
          );
        }
        return <Text key={i} style={style}>{bold(ln)}</Text>;
      })}
    </View>
  );
}

export default function CoachScreen() {
  const router = useRouter();
  const gate = useGate();
  // 王冠ゲーティング: AI相談はスタンダード以上（新ティア）。バナー表示中も入力欄は
  // 触れるようにして体験を完全に殺さない（送信の瞬間にペイウォールへ＝moment of intent）
  const coachLocked = gate.gated('coach');
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const inputRef = useRef<TextInput>(null);   // 音声ボタンからのフォーカス先
  const insets = useSafeAreaInsets();
  const welcomeTarget = useGuideTarget('welcome');
  const kbVisible = useKeyboardVisible();
  const [histOpen, setHistOpen] = useState(false);
  const [histQ, setHistQ] = useState('');
  const [hist, setHist] = useState<HistEntry[]>([]);

  // 入力欄の縁パルス（食事タブの入力ドックと同じ流儀）。
  // 全開の縁を重ねてopacityだけをネイティブで往復させる（色補間はJS負荷が高いため）
  const glow = useRef(new Animated.Value(0)).current;
  const reduceMotion = useReduceMotion();
  useEffect(() => {
    if (reduceMotion) { glow.setValue(0.4); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(glow, { toValue: 1, duration: 1250, useNativeDriver: true }),
      Animated.timing(glow, { toValue: 0, duration: 1250, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [glow, reduceMotion]);

  // セッション制: 「新しい相談を始める」から次に始めるまでが1セッション（使用回数はセッション開始時のみ1消費）。
  // IDは端末生成のUUID。永続化しない＝アプリ再起動で自然に新セッションになる
  const sessionIdRef = useRef<string>(newSessionId());
  function newSession() {
    sessionIdRef.current = newSessionId();
    setMsgs([]);
    setInput('');
  }

  // 制約プロフィール（profiles.constraints_note）が未設定の人にだけ「前提を設定」導線を見せる。
  // 列が無い旧DB（migration-22未適用）ではエラー → 保存できない導線を出さないためリンクも出さない
  const [hasConstraints, setHasConstraints] = useState(true);
  useFocusEffect(useCallback(() => {
    let alive = true;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) return;
      const { data, error } = await supabase.from('profiles').select('constraints_note').eq('id', uid).maybeSingle();
      if (!alive || error) return;
      setHasConstraints(!!String((data as { constraints_note?: string | null } | null)?.constraints_note ?? '').trim());
    })();
    return () => { alive = false; };
  }, []));

  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }, [msgs, busy]);

  // 他タブで開いたキーボードを引き継がない（入力欄をタップしたときだけ立ち上げる）
  useFocusEffect(useCallback(() => { Keyboard.dismiss(); }, []));

  // 相談履歴のロード＆追記（端末ローカル・日付検索用）
  useEffect(() => {
    AsyncStorage.getItem(HIST_KEY).then((raw) => {
      if (raw) { try { setHist(JSON.parse(raw)); } catch { /* 壊れていたら空から */ } }
    });
  }, []);
  function logHist(role: 'user' | 'ai', text: string) {
    setHist((prev) => {
      const next = [...prev, { d: new Date().toISOString(), role, text }].slice(-HIST_MAX);
      AsyncStorage.setItem(HIST_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }

  // 検索（日付 "8/15"・"2026/8/15" or キーワード）→ 日付ごとにグループ化（新しい日が上）
  const histGroups = useMemo(() => {
    const q = histQ.trim().toLowerCase();
    const fmt = (iso: string) => {
      const t = new Date(iso);
      return `${t.getFullYear()}/${t.getMonth() + 1}/${t.getDate()}`;
    };
    const groups: { date: string; items: HistEntry[] }[] = [];
    for (const e of hist) {
      const date = fmt(e.d);
      if (q && !date.includes(q) && !date.slice(5).includes(q) && !e.text.toLowerCase().includes(q)) continue;
      const g = groups[groups.length - 1];
      if (g && g.date === date) g.items.push(e);
      else groups.push({ date, items: [e] });
    }
    return groups.reverse();
  }, [hist, histQ]);

  // ペイウォールへ（バナー・ロック中の送信の共通口）
  function openCoachPaywall() {
    Keyboard.dismiss();
    Haptics.selectionAsync().catch(() => {});
    // typed routesが動的srcを知らないためas never（changes.tsxと同じ流儀）
    router.push('/paywall?src=coach' as never);
  }

  async function send(q: string) {
    const question = q.trim();
    if (!question || busy) return;
    // ロック中は送信の瞬間にペイウォールへ。入力文は消さない（戻ってきてすぐ続けられる）
    if (coachLocked) { openCoachPaywall(); return; }
    const history = msgs.slice(-6);
    setMsgs((m) => [...m, { role: 'user', text: question }]);
    logHist('user', question);
    setInput('');
    setBusy(true);
    try {
      const { ok, json } = await apiPost<{ ok: boolean; answer?: string; action?: CoachAction | null; error?: string; code?: string }>(
        '/api/coach', { question, history, lang: apiLang(), sessionId: sessionIdRef.current });
      if (!ok || !json?.ok || !json.answer) {
        // code:'plan_limit'（本日のセッション上限）はアップグレード導線つきで案内する
        setMsgs((m) => [...m, {
          role: 'ai',
          text: json?.error || t('うまく答えられませんでした。もう一度お試しください。'),
          upgrade: json?.code === 'plan_limit',
        }]);
        return;
      }
      // 検証を通らない提案はカードを出さない（押しても何も起きないボタンを見せないため）
      const action = json.action && isApplicable(json.action, todayJST()) ? json.action : undefined;
      setMsgs((m) => [...m, { role: 'ai', text: json.answer!, action }]);
      logHist('ai', json.answer!);
    } catch {
      setMsgs((m) => [...m, { role: 'ai', text: t('通信に失敗しました。電波状況を確認してください。') }]);
    } finally {
      setBusy(false);
    }
  }

  // 目標の適用中フラグ。確認ダイアログを二重に開いて二重に書き込むのを防ぐ
  const [applying, setApplying] = useState(false);

  /** 結果を必ず画面に出す。無言で終わる経路を作らないための共通口 */
  function note(text: string) {
    setMsgs((m) => [...m, { role: 'ai', text }]);
  }

  /**
   * AI提案の目標を承認制で適用する（確認ダイアログ→goals/training_goals更新）。
   *
   * ここは「押したのに何も起きない」が起きやすい場所なので、次を守っている：
   *  ・書き込む前に lib/coachAction で検証し、弾いた理由を必ず表示する
   *  ・更新後は影響行数を確認する。goalsは1ユーザー1行で、行が無いときの
   *    update はエラーなしの0件更新になるため、成功と区別できない
   *  ・成功・失敗・弾いた、のどの経路でも必ずメッセージか適用済み表示が出る
   */
  function applyAction(a: CoachAction) {
    if (applying) return;
    const v = validateAction(a, todayJST());
    if (!v.ok) {
      note(v.reason + t('（「概要」タブの目標から手動で設定できます）'));
      return;
    }
    // 献立はトレイに載せるだけ（確定は食事タブの✓保存）なので確認ダイアログを挟まない
    if (v.plan.table === 'tray') {
      setPendingMeal(v.plan.items);
      setMsgs((m) => m.map((x) => (x.action === a ? { ...x, applied: true } : x)));
      router.push('/(tabs)/log');
      return;
    }
    Alert.alert(t('目標を更新しますか？'), a.label, [
      { text: t('キャンセル'), style: 'cancel' },
      { text: t('適用する'), onPress: () => runApply(v.plan, a) },
    ]);
  }

  async function runApply(plan: ApplyPlan, a: CoachAction) {
    setApplying(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) { note(t('ログインの有効期限が切れています。もう一度ログインしてからお試しください。')); return; }

      // 影響した行を返させて、本当に書き換わったかを確かめる
      // 献立（tray）はapplyActionで処理済み。ここに来るのはDBに書く2種類だけ
      if (plan.table === 'tray') return;
      const res = plan.table === 'goals'
        ? await supabase.from('goals').update(plan.patch).eq('user_id', uid).select('user_id')
        : await supabase.from('training_goals')
            .upsert({ user_id: uid, name: plan.name, target_kg: plan.targetKg }, { onConflict: 'user_id,name' })
            .select('id');

      if (res.error) {
        note(t('目標の更新に失敗しました（{msg}）。「概要」タブから手動で設定してください。', { msg: res.error.message }));
        return;
      }
      if (!res.data || res.data.length === 0) {
        // goalsの行がまだ無い場合。開始体重や開始日が必要なのでここでは作らず、設定へ案内する
        note(t('目標がまだ登録されていないため更新できませんでした。「概要」タブの目標から先に登録してください。'));
        return;
      }
      setMsgs((m) => m.map((x) => (x.action === a ? { ...x, applied: true } : x)));
    } catch (e) {
      note(t('目標の更新中に問題が起きました（{msg}）。もう一度お試しください。', {
        msg: e instanceof Error ? e.message : String(e),
      }));
    } finally {
      setApplying(false);
    }
  }

  const empty = msgs.length === 0 && !busy;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={[s.wrap, { paddingBottom: insets.bottom + 6 }]}>
        <Text style={[s.pageTitle, { marginTop: insets.top + 8 }]}>{t('相談')}</Text>
        {empty ? (
          /* ===== Empty State: 中央寄せのウェルカムUI（キーボード表示中はスクロールしてロゴまで見える） ===== */
          <ScrollView
            contentContainerStyle={s.welcomeScroll}
            keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}>
            <View style={s.welcomeWrap} ref={welcomeTarget} collapsable={false}
                  onStartShouldSetResponder={() => { Keyboard.dismiss(); return false; }}>
              <View style={{ marginBottom: 14 }}><AiCoachLogo size={72} /></View>
              <Text style={s.welcomeTitle}>{t('AIコーチに相談する')}</Text>
              <Text style={s.welcomeSub}>{t('直近の食事・体重・栄養ログをもとにアドバイスします')}</Text>
              <View style={s.quickGrid}>
                {quickList().map((q) => (
                  <Pressable key={q.t} style={({ pressed }) => [s.quickCard, pressed && { opacity: 0.7 }]} onPress={() => send(q.t)}>
                    <q.Icon color={C.teal} size={ICON.hero} strokeWidth={ICON.stroke} />
                    <Text style={s.quickT}>{q.t}</Text>
                  </Pressable>
                ))}
              </View>

              {/* 例が4つだけでは「自分の記録を読んで答える」ことが伝わらないため、全体をここから見せる */}
              <Pressable style={({ pressed }) => [s.moreBtn, pressed && { opacity: 0.7 }]}
                         onPress={() => setCatalogOpen(true)}>
                <Sparkles size={15} color={C.teal} />
                <Text style={s.moreBtnT}>{t('ほかに何が聞ける？')}</Text>
              </Pressable>

              {/* 読みもの: 質問する前に読んで分かることも多いので、聞く場所の隣に置く */}
              <ColumnReader variant="compact" />
            </View>
          </ScrollView>
        ) : (
          /* ===== 会話タイムライン ===== */
          <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={{ paddingTop: 4, paddingBottom: 8 }}
                      keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
            {msgs.map((m, i) => (
              <View key={i}>
                <View style={[s.bubble, m.role === 'user' ? s.bUser : s.bAi]}>
                  {m.role === 'ai'
                    ? <RichText text={m.text} style={s.bubbleT} />
                    : <Text style={[s.bubbleT, { color: C.panel }]}>{m.text}</Text>}
                </View>
                {/* プラン上限（429 plan_limit）のときだけ、上限到達の文脈つきペイウォールへの導線 */}
                {m.upgrade && (
                  <Pressable hitSlop={8} style={{ alignSelf: 'flex-start', marginBottom: 8, marginTop: -2 }}
                             onPress={() => router.push('/paywall?src=limit_coach' as never)}>
                    <Text style={{ color: C.teal, fontWeight: '700', fontSize: 14 }}>{t('プランを見る →')}</Text>
                  </Pressable>
                )}
                {/* 目標変更の提案アクションカード（承認制） */}
                {m.action && (
                  <View style={s.actionCard}>
                    <Text style={s.actionLabel}>💡 {m.action.label}</Text>
                    {m.applied ? (
                      <Text style={s.actionDone}>
                        {m.action.kind === 'meal'
                          ? t('✓ トレイに入れました（食事タブで量を調整して保存）')
                          : t('✓ 適用しました（「概要」タブに反映）')}
                      </Text>
                    ) : (
                      <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                        <Pressable style={[s.actionBtn, applying && { opacity: 0.5 }]} disabled={applying}
                                   onPress={() => applyAction(m.action!)}>
                          <Text style={s.actionBtnT}>
                            {applying ? t('適用中…') : m.action.kind === 'meal' ? t('🍽 この献立を食事トレイに入れる') : t('この目標を適用する')}
                          </Text>
                        </Pressable>
                        {m.action.kind !== 'meal' && (
                          <Pressable style={s.actionAlt}
                                     onPress={() => router.push({ pathname: '/settings', params: { open: m.action!.kind === 'training' ? 'goalT' : 'goalW', ts: String(Date.now()) } })}>
                            <Text style={s.actionAltT}>{t('⚙ 設定で細かく調整')}</Text>
                          </Pressable>
                        )}
                      </View>
                    )}
                  </View>
                )}
              </View>
            ))}
            {busy && (
              <View style={[s.bubble, s.bAi, { flexDirection: 'row', gap: 8, alignItems: 'center' }]}>
                <ActivityIndicator size="small" color={C.teal} />
                <Text style={s.bubbleT}>{t('データを確認しています…')}</Text>
              </View>
            )}
          </ScrollView>
        )}

        {/* 入力ドック（食事タブと同じ見た目に統一。テーマ色で発光する） */}
        <AskCatalog visible={catalogOpen} onClose={() => setCatalogOpen(false)} onPick={(q) => send(q)} />

        {/* 王冠バナー: ロック中も入力欄は隠さない（書ける→送る瞬間に誘う）。タップでもペイウォールへ */}
        {coachLocked && (
          <Pressable style={({ pressed }) => [s.gateBanner, pressed && { opacity: 0.8 }]} onPress={openCoachPaywall}>
            <CrownBadge size={14} />
            <Text style={s.gateBannerT}>{t('AI相談はスタンダードから。1つの相談の中は往復無制限です')}</Text>
          </Pressable>
        )}

        <View style={s.inRow}>
          {/* 発光レイヤ: 食事タブの入力ドックと同じ縁パルス（opacityのみネイティブ駆動） */}
          <Animated.View pointerEvents="none" style={[s.inGlow, { opacity: glow }]} />
          {kbVisible ? (
            <Pressable style={s.pencilBadge} onPress={() => Keyboard.dismiss()} hitSlop={6}>
              <ChevronDown color={C.teal} size={ICON.xl} strokeWidth={ICON.stroke} />
            </Pressable>
          ) : (
            <View style={s.pencilBadge}>
              <MessageCircle color={C.teal} size={ICON.md} strokeWidth={ICON.stroke} />
            </View>
          )}
          <TextInput ref={inputRef} style={s.input} placeholder={t('相談してみる…')} placeholderTextColor={C.sub}
                     value={input} onChangeText={setInput} multiline />
          {/* 音声入力の道しるべ（食事タブの入力ドックと同じ流儀）。文字を打ち始めたら畳んで
              テキストに幅を渡す */}
          {!(kbVisible && input.trim().length > 0) && (
            <VoiceHintButton mode="coach" onFocusInput={() => inputRef.current?.focus()} />
          )}
          <Pressable
            style={[s.sendInline, (busy || !input.trim()) && { opacity: 0.35 }]}
            onPress={() => send(input)} disabled={busy || !input.trim()} hitSlop={6}>
            <ArrowUp color="#fff" size={ICON.md} strokeWidth={ICON.strokeBold} />
          </Pressable>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <Text style={[s.disclaimer, { flex: 1 }]}>{t('医療的な診断はできません。深刻な不調が続く場合は医療機関へ。')}</Text>
          {/* 制約プロフィール未設定のときだけの導線（プロフィール編集シートへディープリンク） */}
          {!hasConstraints && (
            <Pressable hitSlop={8}
                       onPress={() => router.push({ pathname: '/settings', params: { open: 'profile', ts: String(Date.now()) } })}>
              <Text style={s.presetLink}>{t('前提を設定（アレルギー・苦手など）')}</Text>
            </Pressable>
          )}
        </View>
      </View>
      <StatusBarMask />
      <HeaderGear />
      {/* 左上: 相談履歴（⚙とミラー配置） */}
      <Pressable style={[s.histBtn, { top: insets.top + 8 }]} onPress={() => { Keyboard.dismiss(); setHistOpen(true); }} hitSlop={10}>
        <History size={16} color={C.sub} />
      </Pressable>
      {/* ＋新しい相談: sessionId再生成＋画面クリア（会話中だけ表示。履歴ボタンと同じ流儀） */}
      {!empty && (
        <Pressable style={[s.histBtn, { top: insets.top + 8, right: 92 }]} accessibilityLabel={t('＋新しい相談')}
                   onPress={() => { Keyboard.dismiss(); newSession(); }} hitSlop={10}>
          <SquarePen size={16} color={C.sub} />
        </Pressable>
      )}

      {/* ===== 相談履歴モーダル: 日付グループ＋日付/キーワード検索 ===== */}
      <Modal visible={histOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setHistOpen(false)}>
        <View style={s.histWrap}>
          <View style={s.histHead}>
            <Text style={s.histTitle}>{t('相談履歴')}</Text>
            <Pressable onPress={() => setHistOpen(false)} hitSlop={10}><X size={ICON.xl} color={C.sub} /></Pressable>
          </View>
          <TextInput
            style={s.histSearch} placeholder={t('日付やキーワードで検索（例: 8/15、タンパク質）')} placeholderTextColor={C.faint}
            value={histQ} onChangeText={setHistQ} returnKeyType="search" clearButtonMode="while-editing"
          />
          {histGroups.length === 0 ? (
            <Text style={s.histEmpty}>{hist.length === 0 ? 'まだ相談履歴がありません。' : t('該当する履歴が見つかりません。')}</Text>
          ) : (
            <ScrollView style={{ flex: 1 }} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled">
              {histGroups.map((g) => (
                <View key={g.date} style={{ marginBottom: 16 }}>
                  <Text style={s.histDate}>{g.date}</Text>
                  {g.items.map((e, i) => (
                    <View key={i} style={[s.bubble, e.role === 'user' ? s.bUser : s.bAi]}>
                      {e.role === 'ai'
                        ? <RichText text={e.text} style={s.bubbleT} />
                        : <Text style={[s.bubbleT, { color: C.panel }]}>{e.text}</Text>}
                    </View>
                  ))}
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const s = themed(() => ({
  wrap: { flex: 1, paddingHorizontal: SPACE.screen, paddingBottom: 6 },
  welcomeScroll: { flexGrow: 1, justifyContent: 'center', paddingBottom: 10 },
  welcomeWrap: { alignItems: 'center', paddingBottom: 30 },
  welcomeIcon: {
    width: 76, height: 76, borderRadius: 38, backgroundColor: C.panel,
    borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center', marginBottom: 14,
  },
  welcomeTitle: { ...HEAD.section, color: C.ink },
  welcomeSub: { fontSize: 13, color: C.sub, marginTop: 6, marginBottom: 20, textAlign: 'center', lineHeight: 19 },
  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center' },
  moreBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    alignSelf: 'center', marginTop: 16,
    borderWidth: 1.5, borderColor: C.accentBorder, backgroundColor: C.accentSoft,
    borderRadius: RADIUS.chip, paddingVertical: 10, paddingHorizontal: 18,
  },
  moreBtnT: { fontSize: 15, fontWeight: '800', color: C.teal },
  quickCard: {
    width: '46%', backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: RADIUS.panel,
    paddingVertical: 14, paddingHorizontal: 12, alignItems: 'center', gap: 6,
  },
  quickEmoji: { fontSize: 21 },
  quickT: { fontSize: 13, fontWeight: '700', color: C.ink, textAlign: 'center', lineHeight: 18 },
  bubble: { borderRadius: RADIUS.panel, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 8, maxWidth: '88%' },
  bUser: { backgroundColor: C.ink, alignSelf: 'flex-end', borderBottomRightRadius: 6 },
  bAi: { backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, alignSelf: 'flex-start', borderBottomLeftRadius: 6 },
  bubbleT: { fontSize: 17, lineHeight: 22, color: C.ink },
  actionCard: {
    alignSelf: 'flex-start', maxWidth: '88%', backgroundColor: C.accentBadge,
    borderWidth: 1, borderColor: C.teal, borderRadius: RADIUS.tile, padding: 12, marginBottom: 8, marginTop: -2,
  },
  actionLabel: { fontSize: 15, fontWeight: '700', color: C.ink, lineHeight: 21 },
  actionBtn: { backgroundColor: C.teal, borderRadius: RADIUS.chip, paddingVertical: 9, paddingHorizontal: 16 },
  actionAlt: { borderWidth: 1.5, borderColor: C.teal, borderRadius: RADIUS.chip, paddingVertical: 8, paddingHorizontal: 14, backgroundColor: C.panel },
  actionAltT: { color: C.teal, fontSize: 13, fontWeight: '800' },
  actionBtnT: { color: '#fff', fontSize: 13, fontWeight: '800' },
  actionDone: { color: C.teal, fontSize: 13, fontWeight: '800', marginTop: 8 },
  // 食事タブの入力ドック（log.tsxのs.dock）と同じ見た目（角丸18・アクセント縁・teal影）
  inRow: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 4, marginTop: 6,
    backgroundColor: C.panel, borderWidth: 2.5, borderColor: C.accentBorder, borderRadius: 18,
    paddingHorizontal: 9, paddingVertical: 8,
    shadowColor: C.teal, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.12, elevation: 8,
  },
  // log.tsxのs.dockGlowと同じ（全開の縁を重ねてopacityだけ往復させる）
  inGlow: {
    position: 'absolute', top: -2.5, left: -2.5, right: -2.5, bottom: -2.5,
    borderWidth: 2.5, borderColor: C.teal, borderRadius: 18,
    shadowColor: C.teal, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.25,
  },
  pencilBadge: {
    width: 32, height: 32, borderRadius: 10, backgroundColor: C.accentBadge,
    alignItems: 'center', justifyContent: 'center', marginBottom: 1,
  },
  input: { flex: 1, minHeight: 32, maxHeight: 100, fontSize: 17, fontWeight: '600', color: C.ink, paddingTop: 6, paddingBottom: 6, paddingHorizontal: 4 },
  sendInline: { backgroundColor: C.teal, width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', marginBottom: 0 },
  kbDismiss: { width: 28, height: 32, alignItems: 'center', justifyContent: 'center', marginRight: 2 },
  // 王冠バナー（入力ドックの上）。責め色にせずCrownBadgeと同じ「開けるお楽しみ」トーン
  gateBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6,
    backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: RADIUS.tile,
    paddingHorizontal: 12, paddingVertical: 9,
  },
  gateBannerT: { flex: 1, fontSize: 12.5, fontWeight: '700', color: C.ink, lineHeight: 17 },
  disclaimer: { fontSize: 11, color: C.faint, marginTop: 5 },
  presetLink: { fontSize: 11, color: C.teal, fontWeight: '800', marginTop: 5 },
  pageTitle: { ...HEAD.page, color: C.ink, marginBottom: 10, marginLeft: 2 },
  histBtn: {
    position: 'absolute', right: 54, zIndex: 30,
    width: 30, height: 30, borderRadius: 9,
    borderWidth: 1, borderColor: C.line, backgroundColor: C.panel,
    alignItems: 'center', justifyContent: 'center',
  },
  histWrap: { flex: 1, backgroundColor: C.bg, padding: SPACE.screen, paddingTop: sheetTopPad(18) },
  histHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  histTitle: { ...HEAD.card, color: C.ink },
  histSearch: {
    backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: RADIUS.input,
    paddingHorizontal: 12, paddingVertical: 9, fontSize: 15, color: C.ink, marginBottom: 12,
  },
  histDate: { fontSize: 13, fontWeight: '800', color: C.sub, marginBottom: 6 },
  histEmpty: { fontSize: 15, color: C.sub, marginTop: 24, textAlign: 'center' },
}));
