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
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import Svg, { Rect, Mask } from 'react-native-svg';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { todayJST } from '@/lib/calc';
import { C } from '@/lib/ui';

const GUIDE_DONE_KEY = 'bl-guide-done';
const HILITE = '#f59e0b'; // ハイライト色（ドックのティールと区別するアンバー）

type Rct = { x: number; y: number; w: number; h: number };
type SpotStep = { kind: 'spot'; route: string; target: string; title: string; text: string; demo?: 'coach' };
type CardStep = { kind: 'card'; id: 'welcome' | 'profile' | 'goal' | 'done' };
type StepDef = SpotStep | CardStep;

const STEPS: StepDef[] = [
  { kind: 'card', id: 'welcome' },
  { kind: 'card', id: 'profile' },
  { kind: 'card', id: 'goal' },
  { kind: 'spot', route: '/log', target: 'hero', title: 'あと食べられる量', text: '残りカロリーとP/F/Cの残りが、いつもここに表示されます。' },
  { kind: 'spot', route: '/log', target: 'dock', title: '記録はここに書くだけ', text: '「バナナと卵2個」のように書いて↑を押すと、AIが栄養を計算してトレイに載せます。写真でもOK。✓保存で確定です。' },
  { kind: 'spot', route: '/training', target: 'trainInput', title: '筋トレの記録', text: '種目・kg・回数・セットを入れて保存。保存するとレストタイマーが自動で走ります。' },
  { kind: 'spot', route: '/changes', target: 'chart', title: '変化を見る', text: '体重や挙上重量の推移はここ。グラフはピンチで拡大、ドラッグで期間移動できます。' },
  { kind: 'spot', route: '/changes', target: 'gear', title: '設定はここ', text: 'プロフィールの変更・マイ食品の管理・ヘルスケア連携はこの⚙から。' },
  { kind: 'spot', route: '/coach', target: 'welcome', title: 'AIコーチ', text: '迷ったらAIコーチへ。あなたの記録データを根拠にアドバイスします。', demo: 'coach' },
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
    close();
    router.navigate('/log' as never);
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
    const tryMeasure = () => {
      tries += 1;
      const r = targets.current?.get(step.target);
      if (r?.current) {
        r.current.measureInWindow((x, y, w, h) => {
          if (!(w > 0 && h > 0)) {
            if (tries < 6) later(tryMeasure, 250); else next();
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
            later(tryMeasure, 750); // スクロール完了を待って再測定
            return;
          }
          setRect({ x, y, w, h });
        });
      } else if (tries < 6) later(tryMeasure, 250);
      else next();
    };
    later(tryMeasure, 450);
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
        <Text style={s.skipT}>スキップ ✕</Text>
      </Pressable>

      {/* spotの吹き出し */}
      {step.kind === 'spot' && hole && (
        <View style={[s.bubble, bubbleBelow ? { top: hole.y + hole.h + 14 } : { bottom: H - hole.y + 14 }]}>
          <Text style={s.bubbleTitle}>{step.title}</Text>
          <Text style={s.bubbleText}>{step.text}</Text>
          {step.demo === 'coach' && <CoachDemo />}
          <Pressable style={s.nextBtn} onPress={next}>
            <Text style={s.nextBtnT}>{lastSpot ? '最後へ' : '次へ'}</Text>
          </Pressable>
          <View style={[s.beak, bubbleBelow ? s.beakUp : s.beakDown, { left: Math.min(Math.max(hole.x + hole.w / 2 - 24, 30), W - 60) }]} />
        </View>
      )}
      {step.kind === 'spot' && !hole && (
        <View style={s.loading}><ActivityIndicator color="#fff" /></View>
      )}

      {/* カードステップ */}
      {step.kind === 'card' && (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.cardWrap} pointerEvents="box-none">
          {step.id === 'welcome' && <WelcomeCard onStart={next} onSkip={finish} />}
          {step.id === 'profile' && <ProfileCard onDone={next} />}
          {step.id === 'goal' && <GoalCard onDone={next} />}
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
      <Text style={s.cardTitle}>ようこそ BodyLog へ</Text>
      <Text style={s.cardText}>1分で使い方をご案内します。{'\n'}まずはあなたの基本情報と目標を設定して、正確なカロリー計算を始めましょう。</Text>
      <Pressable style={s.primaryBtn} onPress={onStart}><Text style={s.primaryBtnT}>ガイドを始める</Text></Pressable>
      <Pressable onPress={onSkip} hitSlop={8}><Text style={s.linkT}>今はしない</Text></Pressable>
    </View>
  );
}

function ProfileCard({ onDone }: { onDone: () => void }) {
  const [sex, setSex] = useState<'male' | 'female'>('male');
  const [height, setHeight] = useState('170');
  const [age, setAge] = useState('30');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;
      const { data: p } = await supabase.from('profiles').select('sex,height_cm,age').eq('id', session.user.id).maybeSingle();
      if (p) {
        if (p.sex) setSex(p.sex);
        if (p.height_cm != null) setHeight(String(p.height_cm));
        if (p.age != null) setAge(String(p.age));
      }
    })();
  }, []);

  async function save() {
    setBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (uid) {
        await supabase.from('profiles').update({ sex, height_cm: Number(height) || 170, age: Number(age) || 30 }).eq('id', uid);
      }
      onDone();
    } finally { setBusy(false); }
  }

  return (
    <View style={s.card}>
      <Text style={s.cardTitle}>① あなたの基本情報</Text>
      <Text style={s.cardText}>基礎代謝の計算に使います（あとで⚙から変更できます）</Text>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
        {([['male', '男性'], ['female', '女性']] as const).map(([k, l]) => (
          <Pressable key={k} style={[s.seg, sex === k && s.segOn]} onPress={() => setSex(k)}>
            <Text style={[s.segT, sex === k && { color: '#fff' }]}>{l}</Text>
          </Pressable>
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
        <View style={{ flex: 1 }}>
          <Text style={s.label}>身長(cm)</Text>
          <TextInput style={s.input} keyboardType="number-pad" value={height} onChangeText={setHeight} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.label}>年齢</Text>
          <TextInput style={s.input} keyboardType="number-pad" value={age} onChangeText={setAge} />
        </View>
      </View>
      <Pressable style={s.primaryBtn} onPress={save} disabled={busy}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryBtnT}>保存して次へ</Text>}
      </Pressable>
      <Pressable onPress={onDone} hitSlop={8}><Text style={s.linkT}>あとで設定する</Text></Pressable>
    </View>
  );
}

function GoalCard({ onDone }: { onDone: () => void }) {
  const [targetW, setTargetW] = useState('');
  const [months, setMonths] = useState(3);
  const [busy, setBusy] = useState(false);

  async function save() {
    const tw = Number(targetW);
    if (!(tw > 20)) { onDone(); return; }
    setBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (uid) {
        const d = new Date();
        d.setMonth(d.getMonth() + months);
        const targetDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const { data: g } = await supabase.from('goals').select('start_date').maybeSingle();
        if (g) {
          await supabase.from('goals').update({ target_weight: tw, target_date: targetDate }).eq('user_id', uid);
        } else {
          const { data: w } = await supabase.from('entries').select('weight').not('weight', 'is', null).order('date', { ascending: false }).limit(1);
          const startW = w?.length ? Number(w[0].weight) : tw;
          await supabase.from('goals').insert({ user_id: uid, target_weight: tw, target_date: targetDate, start_date: todayJST(), start_weight: startW });
        }
      }
      onDone();
    } finally { setBusy(false); }
  }

  return (
    <View style={s.card}>
      <Text style={s.cardTitle}>② 目標を決める</Text>
      <Text style={s.cardText}>目標から逆算して、毎日の「あと食べられる量」を計算します</Text>
      <Text style={s.label}>目標体重（kg）</Text>
      <TextInput style={s.input} keyboardType="decimal-pad" placeholder="例: 72.0" placeholderTextColor={C.faint} value={targetW} onChangeText={setTargetW} />
      <Text style={s.label}>いつまでに</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {[1, 3, 6].map((m) => (
          <Pressable key={m} style={[s.seg, months === m && s.segOn]} onPress={() => setMonths(m)}>
            <Text style={[s.segT, months === m && { color: '#fff' }]}>{m}ヶ月</Text>
          </Pressable>
        ))}
      </View>
      <Pressable style={s.primaryBtn} onPress={save} disabled={busy}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryBtnT}>保存して次へ</Text>}
      </Pressable>
      <Pressable onPress={onDone} hitSlop={8}><Text style={s.linkT}>あとで設定する</Text></Pressable>
    </View>
  );
}

// AIコーチの自動デモ: 質問が勝手にタイプされ→考え中→回答がふわっと現れる
function CoachDemo() {
  const Q = '昨日食べすぎちゃった…どうすれば？';
  const A = 'まず大丈夫、1日では太りません。今日は目標を少し緩めて、たんぱく質を多めに。挽回は2〜3日かけるのがコツです💪';
  const [qLen, setQLen] = useState(0);
  const [phase, setPhase] = useState<'typing' | 'thinking' | 'answer'>('typing');
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const iv = setInterval(() => {
      setQLen((n) => {
        if (n >= Q.length) { clearInterval(iv); setPhase('thinking'); return n; }
        return n + 1;
      });
    }, 65);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (phase !== 'thinking') return;
    const t = setTimeout(() => {
      setPhase('answer');
      Animated.timing(fade, { toValue: 1, duration: 550, useNativeDriver: true }).start();
    }, 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  return (
    <View style={s.demoWrap}>
      <View style={s.demoUser}>
        <Text style={s.demoUserT}>{Q.slice(0, qLen)}{phase === 'typing' ? '▍' : ''}</Text>
      </View>
      {phase === 'thinking' && (
        <View style={s.demoAi}><Text style={s.demoAiT}>考え中…</Text></View>
      )}
      {phase === 'answer' && (
        <Animated.View style={[s.demoAi, { opacity: fade, transform: [{ translateY: fade.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] }]}>
          <Text style={s.demoAiT}>{A}</Text>
        </Animated.View>
      )}
    </View>
  );
}

function DoneCard({ onFinish }: { onFinish: () => void }) {
  return (
    <View style={s.card}>
      <Text style={s.cardEmoji}>🎉</Text>
      <Text style={s.cardTitle}>準備完了！</Text>
      <Text style={s.cardText}>まずは今日食べたものを1つ、下の入力欄に書いてみましょう。{'\n'}続けるほどAIのアドバイスが賢くなります。</Text>
      <Pressable style={s.primaryBtn} onPress={onFinish}><Text style={s.primaryBtnT}>食事を記録してみる</Text></Pressable>
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
  demoWrap: { marginTop: 10, gap: 6 },
  demoUser: { alignSelf: 'flex-end', backgroundColor: C.ink, borderRadius: 14, borderBottomRightRadius: 4, paddingHorizontal: 12, paddingVertical: 8, maxWidth: '90%' },
  demoUserT: { color: '#fff', fontSize: 12.5, lineHeight: 18 },
  demoAi: { alignSelf: 'flex-start', backgroundColor: '#f2f4f1', borderRadius: 14, borderBottomLeftRadius: 4, paddingHorizontal: 12, paddingVertical: 8, maxWidth: '92%' },
  demoAiT: { color: C.ink, fontSize: 12.5, lineHeight: 19 },
  nextBtnT: { color: '#fff', fontSize: 13.5, fontWeight: '800' },
  beak: { position: 'absolute', width: 0, height: 0, borderLeftWidth: 10, borderRightWidth: 10, borderLeftColor: 'transparent', borderRightColor: 'transparent' },
  beakUp: { top: -10, borderBottomWidth: 10, borderBottomColor: '#fff' },
  beakDown: { bottom: -10, borderTopWidth: 10, borderTopColor: '#fff' },
  loading: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
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
