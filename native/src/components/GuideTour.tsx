// スポットライト式の初回ガイドツアー
// - 開始アナウンス → 必須項目の入力（プロフィール・目標） → 各タブへ自動遷移しながら
//   対象UIだけをアンバーの発光枠でハイライトし、それ以外を暗転。吹き出しで説明
// - 全ステップに「スキップ」。完了/スキップでAsyncStorageに記録し、以後は出ない
// - 設定の「使い方ガイド」から何度でも再実行できる
import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
  type ReactNode, type RefObject,
} from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, Dimensions, Animated,
  KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import Svg, { Rect, Mask } from 'react-native-svg';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { todayJST } from '@/lib/calc';
import { C } from '@/lib/ui';
import { OptionButton } from '@/components/ui/Selectable';
import { t } from '@/lib/i18n';

const GUIDE_DONE_KEY = 'bl-guide-done';
const HILITE = '#f59e0b'; // ハイライト色（ドックのティールと区別するアンバー）

type Rct = { x: number; y: number; w: number; h: number };
type SpotStep = { kind: 'spot'; route: string; target: string; title: string; text: string; demo?: 'coach' };
type CardStep = { kind: 'card'; id: 'welcome' | 'profile' | 'goal' | 'done' };
type StepDef = SpotStep | CardStep;

const STEPS: StepDef[] = [
  { kind: 'card', id: 'welcome' },
  { kind: 'spot', route: '/log', target: 'hero', title: t('あと食べられる量'), text: t('残りカロリーとP/F/Cの残りが、いつもここに表示されます。') },
  { kind: 'spot', route: '/log', target: 'dock', title: t('記録はここに書くだけ'), text: t('「バナナと卵2個」のように書いて↑を押すと、AIが栄養を計算してトレイに載せます。写真でもOK。✓保存で確定です。') },
  { kind: 'spot', route: '/training', target: 'trainInput', title: '運動の記録', text: '犬の散歩でもOK。種類と時間を選ぶだけで消費カロリーに反映されます。筋トレは上のセグメントで切り替え。' },
  { kind: 'spot', route: '/changes', target: 'chart', title: '変化を見る', text: '体重や挙上重量の推移はここ。グラフはピンチで拡大、ドラッグで期間移動できます。' },
  { kind: 'spot', route: '/changes', target: 'gear', title: '設定はここ', text: 'プロフィールの変更・マイ食品の管理・ヘルスケア連携はこの⚙から。' },
  { kind: 'spot', route: '/coach', target: 'welcome', title: t('AIコーチ'), text: t('迷ったらAIコーチへ。あなたの記録データを根拠にアドバイスします。'), demo: 'coach' },
  { kind: 'card', id: 'done' },
];

type Ctx = {
  active: boolean;
  start: () => void;
  register: (key: string, ref: RefObject<View | null>) => void;
  registerScroller: (route: string, scrollBy: (delta: number) => void) => void;
};
const GuideCtx = createContext<Ctx>({ active: false, start: () => {}, register: () => {}, registerScroller: () => {} });
export const useGuide = () => useContext(GuideCtx);

// 各画面がハイライト対象を登録するためのフック（refを対象Viewに渡す）
export function useGuideTarget(key: string) {
  const { register } = useGuide();
  const ref = useRef<View>(null);
  useEffect(() => { register(key, ref); }, [key, register]);
  return ref;
}

export function GuideProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState(false);
  const targets = useRef(new Map<string, RefObject<View | null>>());
  const scrollers = useRef(new Map<string, (delta: number) => void>());
  const register = useCallback((key: string, ref: RefObject<View | null>) => {
    targets.current.set(key, ref);
  }, []);
  const registerScroller = useCallback((route: string, scrollBy: (delta: number) => void) => {
    scrollers.current.set(route, scrollBy);
  }, []);
  const start = useCallback(() => setActive(true), []);
  return (
    <GuideCtx.Provider value={{ active, start, register, registerScroller }}>
      <View style={{ flex: 1 }}>
        {children}
        {active && <GuideOverlay targets={targets} scrollers={scrollers} close={() => setActive(false)} />}
      </View>
    </GuideCtx.Provider>
  );
}

// 画面側がガイドの自動スクロールを受け入れるためのフック
export function useGuideScroller(route: string, scrollBy: (delta: number) => void) {
  const { registerScroller } = useGuide();
  useEffect(() => { registerScroller(route, scrollBy); }, [route, registerScroller, scrollBy]);
}

function GuideOverlay({ targets, scrollers, close }: {
  targets: RefObject<Map<string, RefObject<View | null>>>;
  scrollers: RefObject<Map<string, (delta: number) => void>>;
  close: () => void;
}) {
  const router = useRouter();
  const [idx, setIdx] = useState(0);
  const [rect, setRect] = useState<Rct | null>(null);
  // ガイドを閉じた/アプリが落ちた後にタイマーやmeasureのコールバックが走っても
  // 状態更新・画面遷移をしないためのガード（クラッシュ対策）
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const { width: W, height: H } = Dimensions.get('window');
  const step = STEPS[idx];

  // ハイライト枠のパルス
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: false }),
      Animated.timing(pulse, { toValue: 0, duration: 900, useNativeDriver: false }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  const pulseBorder = pulse.interpolate({ inputRange: [0, 1], outputRange: ['rgba(245,158,11,0.55)', 'rgba(245,158,11,1)'] });

  const finish = useCallback(() => {
    AsyncStorage.setItem(GUIDE_DONE_KEY, '1').catch(() => {});
    // 紙芝居のあとは初回オンボーディング（プロフィール→目標）へ。済んでいれば食事タブへ
    // ※ 遷移先を決めてから閉じる。閉じた後に遷移すると、復帰時にクラッシュすることがある
    AsyncStorage.getItem('bl-onboard-done')
      .then((v) => { close(); router.navigate((v ? '/log' : '/onboarding') as never); })
      .catch(() => { close(); router.navigate('/log' as never); });
  }, [close, router]);

  const next = useCallback(() => {
    if (idx + 1 >= STEPS.length) finish();
    else setIdx(idx + 1);
  }, [idx, finish]);

  // spotステップ: 対象タブへ自動遷移→対象が画面外なら「指で動かすような」自動スクロールで
  // 全体を可視域に入れてから測定・照射する
  useEffect(() => {
    setRect(null);
    if (step.kind !== 'spot') return;
    router.navigate(step.route as never);
    let tries = 0;
    let scrolled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const later = (fn: () => void, ms: number) => { timers.push(setTimeout(fn, ms)); };
    // デモ表示のステップは、測定できなくても勝手に次へ進めない（デモを見せきる）
    const giveUp = () => { if (alive.current && !step.demo) next(); };
    const tryMeasure = () => {
      if (!alive.current) return;
      tries += 1;
      const r = targets.current?.get(step.target);
      if (r?.current) {
        r.current.measureInWindow((x, y, w, h) => {
          if (!alive.current) return;
          if (!(w > 0 && h > 0)) {
            if (tries < 14) later(tryMeasure, 120); else giveUp();
            return;
          }
          // 吹き出し分の余白を確保した可視域: 上110px〜下(H-290)px
          const topSafe = 110;
          const bottomSafe = H - 290;
          const fitH = Math.min(h, bottomSafe - topSafe);
          const desiredTop = Math.min(Math.max(y, topSafe), bottomSafe - fitH);
          const delta = y - desiredTop;
          const scroller = scrollers.current?.get(step.route);
          if (!scrolled && Math.abs(delta) > 24 && scroller) {
            scrolled = true;
            scroller(delta); // ネイティブのease(ゆっくり動き出しゆっくり止まる)でスクロール
            later(tryMeasure, 480); // スクロール完了を待って再測定
            return;
          }
          setRect({ x, y, w, h });
        });
      } else if (tries < 14) later(tryMeasure, 120);
      else giveUp();
    };
    later(tryMeasure, 160);
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx]);

  const pad = 6;
  const hole = rect ? { x: rect.x - pad, y: rect.y - pad, w: rect.w + pad * 2, h: rect.h + pad * 2 } : null;
  const bubbleBelow = hole ? hole.y + hole.h / 2 < H / 2 : false;
  const lastSpot = idx === STEPS.length - 2;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="auto">
      {/* 暗転レイヤー（spot時は対象部分だけ穴を開ける） */}
      <Svg width={W} height={H} style={StyleSheet.absoluteFill}>
        <Mask id="hole">
          <Rect x={0} y={0} width={W} height={H} fill="#fff" />
          {hole && <Rect x={hole.x} y={hole.y} width={hole.w} height={hole.h} rx={16} fill="#000" />}
        </Mask>
        <Rect x={0} y={0} width={W} height={H} fill="rgba(10,14,12,0.72)" mask="url(#hole)" />
      </Svg>

      {/* ハイライト発光枠 */}
      {hole && (
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute', left: hole.x, top: hole.y, width: hole.w, height: hole.h,
            borderWidth: 2.5, borderColor: pulseBorder, borderRadius: 16,
            shadowColor: HILITE, shadowOpacity: 0.55, shadowRadius: 14, shadowOffset: { width: 0, height: 0 },
          }}
        />
      )}

      {/* スキップ（常設） */}
      <Pressable style={s.skip} onPress={finish} hitSlop={10}>
        <Text style={s.skipT}>{t('スキップ ✕')}</Text>
      </Pressable>

      {step.kind === 'spot' && step.demo === 'coach' && (
        <CoachDemoPanel title={step.title} text={step.text} onNext={next} last={lastSpot} H={H} />
      )}

      {/* spotの吹き出し */}
      {step.kind === 'spot' && !step.demo && hole && (
        <View style={[s.bubble, bubbleBelow ? { top: hole.y + hole.h + 14 } : { bottom: H - hole.y + 14 }]}>
          <Text style={s.bubbleTitle}>{step.title}</Text>
          <Text style={s.bubbleText}>{step.text}</Text>
          <Pressable style={s.nextBtn} onPress={next}>
            <Text style={s.nextBtnT}>{lastSpot ? '最後へ' : t('次へ')}</Text>
          </Pressable>
          <View style={[s.beak, bubbleBelow ? s.beakUp : s.beakDown, { left: Math.min(Math.max(hole.x + hole.w / 2 - 24, 30), W - 60) }]} />
        </View>
      )}

      {/* カードステップ */}
      {step.kind === 'card' && (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.cardWrap} pointerEvents="box-none">
          {step.id === 'welcome' && <WelcomeCard onStart={next} onSkip={finish} />}
          {step.id === 'done' && <DoneCard onFinish={finish} />}
        </KeyboardAvoidingView>
      )}
    </View>
  );
}

// ===== カードステップ =====

function WelcomeCard({ onStart, onSkip }: { onStart: () => void; onSkip: () => void }) {
  return (
    <View style={s.card}>
      <Text style={s.cardEmoji}>👋</Text>
      <Text style={s.cardTitle}>{t('ようこそ BodyLog へ')}</Text>
      <Text style={s.cardText}>1分で使い方をご案内します。{'\n'}ツアーのあとに、あなたの現在地点と目標を一緒に設定しましょう。</Text>
      <OptionButton style={{ alignSelf: 'stretch', marginTop: 14, marginBottom: 8 }} label="ガイドを始める" onPress={onStart} />
      <Pressable onPress={onSkip} hitSlop={8}><Text style={s.linkT}>{t('今はしない')}</Text></Pressable>
    </View>
  );
}

// AIコーチの自動デモ: 実際のチャット画面のように、質問がタイプされ→考え中→回答が出て
// →読み進めるようにゆっくり自動スクロールする。回答が長いので全画面パネルで見せる。
function CoachDemoPanel({ title, text, onNext, last, H }: {
  title: string; text: string; onNext: () => void; last: boolean; H: number;
}) {
  const Q = t('最近ちょっと停滞気味かも。食事に何か問題ある？');
  const A =
    '直近7日の記録を見ると、気になる傾向が2つあります。\n\n' +
    '・炭水化物が平均96g/日と、目標160gの6割しか取れていません。糖質が少なすぎると筋グリコーゲンが枯れて、トレ後半で力が出ない・体重が水分で乱高下する原因になります\n' +
    '・一方、たんぱく質は平均132g（体重×1.6g）でしっかり確保できています💪\n' +
    '・摂取カロリーは平均1,690kcalで目標−70kcal。ペース自体は悪くありません\n\n' +
    t('おすすめは「トレする日だけ白米を150g（+250kcal）足す」こと。週の収支はまだ赤字のままなので、減量ペースを崩さずパフォーマンスだけ取り戻せます。まずは次のトレ日に試してみましょう。');
  const [qLen, setQLen] = useState(0);
  const [phase, setPhase] = useState<'typing' | 'thinking' | 'answer'>('typing');
  const fade = useRef(new Animated.Value(0)).current;
  const sv = useRef<ScrollView>(null);
  const contentH = useRef(0);
  const viewH = useRef(0);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  // 質問をタイプする
  useEffect(() => {
    const iv = setInterval(() => {
      if (!alive.current) { clearInterval(iv); return; }
      setQLen((n) => {
        if (n >= Q.length) { clearInterval(iv); setPhase('thinking'); return n; }
        return n + 1;
      });
    }, 55);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 考え中 → 回答
  useEffect(() => {
    if (phase !== 'thinking') return;
    const t2 = setTimeout(() => {
      if (!alive.current) return;
      setPhase('answer');
      Animated.timing(fade, { toValue: 1, duration: 450, useNativeDriver: true }).start();
    }, 1000);
    return () => clearTimeout(t2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // 回答が出たら、指で読み進めるようにゆっくり自動スクロール
  useEffect(() => {
    if (phase !== 'answer') return;
    let y = 0;
    const iv = setInterval(() => {
      if (!alive.current) { clearInterval(iv); return; }
      const max = Math.max(0, contentH.current - viewH.current);
      if (max <= 0) return;
      y = Math.min(y + Math.max(64, viewH.current * 0.3), max);
      sv.current?.scrollTo({ y, animated: true });
      if (y >= max) clearInterval(iv);
    }, 950);
    return () => clearInterval(iv);
  }, [phase]);

  return (
    <View style={[s.demoWrap, { top: Math.max(74, H * 0.1) }]} pointerEvents="box-none">
      <Text style={s.demoTitle}>{title}</Text>
      <Text style={s.demoLead}>{text}</Text>
      <View style={[s.demoPhone, { maxHeight: H * 0.5 }]}>
        <View style={s.demoBar}><Text style={s.demoBarT}>{t('AIコーチ')}</Text></View>
        <ScrollView
          ref={sv}
          contentContainerStyle={{ padding: 12, paddingBottom: 18, gap: 8 }}
          onLayout={(e) => { viewH.current = e.nativeEvent.layout.height; }}
          onContentSizeChange={(_w, h) => { contentH.current = h; }}
          showsVerticalScrollIndicator={false}
          scrollEnabled={false}
        >
          <View style={s.demoUser}>
            <Text style={s.demoUserT}>{Q.slice(0, qLen)}{phase === 'typing' ? '▍' : ''}</Text>
          </View>
          {phase === 'thinking' && (
            <View style={s.demoAi}><Text style={s.demoAiT}>{t('考え中…')}</Text></View>
          )}
          {phase === 'answer' && (
            <Animated.View style={[s.demoAi, { opacity: fade, transform: [{ translateY: fade.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }]}>
              <Text style={s.demoAiT}>{A}</Text>
            </Animated.View>
          )}
        </ScrollView>
      </View>
      <Pressable style={s.demoNext} onPress={onNext}>
        <Text style={s.nextBtnT}>{last ? '最後へ' : t('次へ')}</Text>
      </Pressable>
    </View>
  );
}

function DoneCard({ onFinish }: { onFinish: () => void }) {
  return (
    <View style={s.card}>
      <Text style={s.cardEmoji}>🎉</Text>
      <Text style={s.cardTitle}>{t('準備完了！')}</Text>
      <Text style={s.cardText}>まずは今日食べたものを1つ、下の入力欄に書いてみましょう。{'\n'}続けるほどAIのアドバイスが賢くなります。</Text>
      <OptionButton style={{ alignSelf: 'stretch', marginTop: 14 }} label="食事を記録してみる" onPress={onFinish} />
    </View>
  );
}

const s = StyleSheet.create({
  skip: {
    position: 'absolute', top: 62, right: 16, backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6,
  },
  skipT: { color: '#fff', fontSize: 12, fontWeight: '800' },
  bubble: {
    position: 'absolute', left: 18, right: 18, backgroundColor: '#fff', borderRadius: 18, padding: 16,
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 10,
  },
  bubbleTitle: { fontSize: 15, fontWeight: '800', color: C.ink, marginBottom: 5 },
  bubbleText: { fontSize: 13, color: C.sub, lineHeight: 20 },
  nextBtn: { backgroundColor: HILITE, borderRadius: 999, paddingVertical: 11, alignItems: 'center', marginTop: 12 },
  demoWrap: { position: 'absolute', left: 20, right: 20, alignItems: 'stretch' },
  demoTitle: { fontSize: 20, fontWeight: '900', color: '#fff', textAlign: 'center' },
  demoLead: { fontSize: 12.5, color: 'rgba(255,255,255,0.82)', textAlign: 'center', lineHeight: 19, marginTop: 6, marginBottom: 14 },
  demoPhone: {
    backgroundColor: '#fff', borderRadius: 20, overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 12,
  },
  demoBar: { paddingVertical: 9, alignItems: 'center', backgroundColor: '#f7faf9', borderBottomWidth: 1, borderBottomColor: '#eef1f0' },
  demoBarT: { fontSize: 11.5, fontWeight: '800', color: C.sub },
  demoNext: { backgroundColor: HILITE, borderRadius: 999, paddingVertical: 12, alignItems: 'center', marginTop: 16, alignSelf: 'center', paddingHorizontal: 40 },
  demoUser: { alignSelf: 'flex-end', backgroundColor: C.ink, borderRadius: 14, borderBottomRightRadius: 4, paddingHorizontal: 12, paddingVertical: 8, maxWidth: '90%' },
  demoUserT: { color: '#fff', fontSize: 12.5, lineHeight: 18 },
  demoAi: { alignSelf: 'flex-start', backgroundColor: '#f2f4f1', borderRadius: 14, borderBottomLeftRadius: 4, paddingHorizontal: 12, paddingVertical: 8, maxWidth: '92%' },
  demoAiT: { color: C.ink, fontSize: 12.5, lineHeight: 19 },
  nextBtnT: { color: '#fff', fontSize: 13.5, fontWeight: '800' },
  beak: { position: 'absolute', width: 0, height: 0, borderLeftWidth: 10, borderRightWidth: 10, borderLeftColor: 'transparent', borderRightColor: 'transparent' },
  beakUp: { top: -10, borderBottomWidth: 10, borderBottomColor: '#fff' },
  beakDown: { bottom: -10, borderTopWidth: 10, borderTopColor: '#fff' },
  cardWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: {
    width: '100%', maxWidth: 360, backgroundColor: '#fff', borderRadius: 22, padding: 22, alignItems: 'stretch',
    shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 12,
  },
  cardEmoji: { fontSize: 40, textAlign: 'center', marginBottom: 6 },
  cardTitle: { fontSize: 19, fontWeight: '900', color: C.ink, textAlign: 'center', marginBottom: 8 },
  cardText: { fontSize: 13, color: C.sub, lineHeight: 21, textAlign: 'center' },
  label: { fontSize: 11, fontWeight: '700', color: C.sub, marginTop: 12, marginBottom: 4 },
  input: { backgroundColor: C.bg, borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 12, fontSize: 16, color: C.ink },
  seg: { flex: 1, backgroundColor: C.bg, borderWidth: 1.5, borderColor: C.line, borderRadius: 999, paddingVertical: 10, alignItems: 'center' },
  segOn: { backgroundColor: C.teal, borderColor: C.teal },
  segT: { fontSize: 13, fontWeight: '700', color: C.sub },
  primaryBtn: { backgroundColor: C.teal, borderRadius: 999, paddingVertical: 14, alignItems: 'center', marginTop: 16, marginBottom: 10 },
  primaryBtnT: { color: '#fff', fontSize: 14, fontWeight: '800' },
  linkT: { fontSize: 12, color: C.sub, textAlign: 'center', textDecorationLine: 'underline' },
});
