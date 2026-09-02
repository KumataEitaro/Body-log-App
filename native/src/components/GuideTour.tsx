// スポットライト式のガイドツアー（章立て版）
// - 5章×6〜9ステップ（データは content/guideChapters.ts）。各タブへ自動遷移しながら
//   対象UIだけをアンバーの発光枠でハイライトし、それ以外を暗転。対象が画面に無い機能は
//   紙芝居カード（GuideArtのミニ図解）で見せる
// - 初回は「入力のきほん」1章だけ自動再生（長い強制ツアーは離脱を生む）。
//   残りの章は章選択画面から任意再生。既読章はAsyncStorageに記録して✓を出す
// - 全ステップに「スキップ」。初回分の完了/スキップで bl-guide-done が立ち、以後は出ない
//   （既存ユーザーの既読フラグはそのまま有効＝再強制しない）
// - 設定の「使い方ガイド」からはいつでも章選択を開ける
import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
  type ReactNode, type RefObject,
} from 'react';
import {
  View, Text, Pressable, StyleSheet, Dimensions, Animated,
  ScrollView, Modal,
} from 'react-native';
import Svg, { Rect, Mask } from 'react-native-svg';
import { getFirstRunFlag, setFirstRunFlag } from '@/lib/firstrun';
import { useRouter } from 'expo-router';
import { Hand, PartyPopper, CheckCircle2, ChevronRight, X } from 'lucide-react-native';
import { C, themed } from '@/lib/ui';
import { OptionButton } from '@/components/ui/Selectable';
import { useReduceMotion } from '@/lib/motion';
import { t } from '@/lib/i18n';
import GuideArt from '@/components/GuideArt';
import {
  GUIDE_CHAPTERS, FIRST_CHAPTER,
  type GuideChapter, type GuideChapterId, type GuideStep,
} from '@/content/guideChapters';

const GUIDE_DONE_KEY = 'bl-guide-done';          // 初回ツアーの既読（旧版と共通＝互換）
const CHAPTERS_DONE_KEY = 'bl-guide-chapters';   // 読み終えた章のid配列（JSON）
const HILITE = '#f59e0b'; // ハイライト色（ドックのティールと区別するアンバー）

type Rct = { x: number; y: number; w: number; h: number };
type GuideMode = 'auto' | 'menu'; // auto=初回の自動再生（1章だけ）/ menu=章選択から任意再生

// ---- 既読章の読み書き ----
async function loadDoneChapters(): Promise<GuideChapterId[]> {
  try {
    const raw = await getFirstRunFlag(CHAPTERS_DONE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
async function saveDoneChapter(id: GuideChapterId): Promise<GuideChapterId[]> {
  const cur = await loadDoneChapters();
  const next = cur.includes(id) ? cur : [...cur, id];
  try { await setFirstRunFlag(CHAPTERS_DONE_KEY, JSON.stringify(next)); } catch { /* 表示だけの記録 */ }
  return next;
}

type Ctx = {
  active: boolean;
  start: (mode?: GuideMode) => void;
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
  const [mode, setMode] = useState<GuideMode>('menu');
  const targets = useRef(new Map<string, RefObject<View | null>>());
  const scrollers = useRef(new Map<string, (delta: number) => void>());
  const register = useCallback((key: string, ref: RefObject<View | null>) => {
    targets.current.set(key, ref);
  }, []);
  const registerScroller = useCallback((route: string, scrollBy: (delta: number) => void) => {
    scrollers.current.set(route, scrollBy);
  }, []);
  const start = useCallback((m: GuideMode = 'menu') => { setMode(m); setActive(true); }, []);
  return (
    <GuideCtx.Provider value={{ active, start, register, registerScroller }}>
      <View style={{ flex: 1 }}>
        {children}
        {/* ModalはネイティブのタブバーやFABの上にも被さる（JSのabsolute Viewでは覆えない） */}
        {active && (
          <Modal visible transparent animationType="fade" statusBarTranslucent
                 onRequestClose={() => setActive(false)}>
            <GuideOverlay mode={mode} targets={targets} scrollers={scrollers} close={() => setActive(false)} />
          </Modal>
        )}
      </View>
    </GuideCtx.Provider>
  );
}

// 画面側がガイドの自動スクロールを受け入れるためのフック
export function useGuideScroller(route: string, scrollBy: (delta: number) => void) {
  const { registerScroller } = useGuide();
  useEffect(() => { registerScroller(route, scrollBy); }, [route, registerScroller, scrollBy]);
}

type Phase = 'welcome' | 'menu' | 'steps' | 'chapterDone';

function GuideOverlay({ mode, targets, scrollers, close }: {
  mode: GuideMode;
  targets: RefObject<Map<string, RefObject<View | null>>>;
  scrollers: RefObject<Map<string, (delta: number) => void>>;
  close: () => void;
}) {
  const router = useRouter();
  const reduceMotion = useReduceMotion();
  const chapters = GUIDE_CHAPTERS();
  // 初回(auto)はウェルカム→「入力のきほん」だけ。任意再生(menu)は章選択から
  const [phase, setPhase] = useState<Phase>(mode === 'auto' ? 'welcome' : 'menu');
  const [chapter, setChapter] = useState<GuideChapter>(
    chapters.find((c) => c.id === FIRST_CHAPTER) ?? chapters[0],
  );
  const [idx, setIdx] = useState(0);
  const [doneIds, setDoneIds] = useState<GuideChapterId[]>([]);
  const [rect, setRect] = useState<Rct | null>(null);
  // ガイドを閉じた/アプリが落ちた後にタイマーやmeasureのコールバックが走っても
  // 状態更新・画面遷移をしないためのガード（クラッシュ対策）
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  useEffect(() => { loadDoneChapters().then((ids) => { if (alive.current) setDoneIds(ids); }); }, []);
  const { width: W, height: H } = Dimensions.get('window');
  const step: GuideStep | null = phase === 'steps' ? chapter.steps[idx] : null;

  // ハイライト枠のパルス（視差軽減設定では点滅させず一定の明るさに固定）
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduceMotion) { pulse.setValue(1); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: false }),
      Animated.timing(pulse, { toValue: 0, duration: 900, useNativeDriver: false }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse, reduceMotion]);
  const pulseBorder = pulse.interpolate({ inputRange: [0, 1], outputRange: ['rgba(245,158,11,0.55)', 'rgba(245,158,11,1)'] });

  // 初回ツアーの完了/スキップ: 既読フラグを立てて、未実施ならオンボーディングへ
  const finishAuto = useCallback(() => {
    setFirstRunFlag(GUIDE_DONE_KEY, '1').catch(() => {});
    // ※ 遷移先を決めてから閉じる。閉じた後に遷移すると、復帰時にクラッシュすることがある
    getFirstRunFlag('bl-onboard-done')
      .then((v) => { close(); router.navigate((v ? '/log' : '/onboarding') as never); })
      .catch(() => { close(); router.navigate('/log' as never); });
  }, [close, router]);

  // 章選択からの終了: 画面遷移せずそっと閉じる（設定画面に戻るだけ）
  const closeMenu = useCallback(() => {
    setFirstRunFlag(GUIDE_DONE_KEY, '1').catch(() => {}); // ここまで見た人に初回を再強制しない
    close();
  }, [close]);

  const playChapter = useCallback((ch: GuideChapter) => {
    setChapter(ch); setIdx(0); setPhase('steps');
  }, []);

  const next = useCallback(() => {
    if (idx + 1 >= chapter.steps.length) {
      // 章を読み終えた: 既読を記録して章の締めカードへ
      saveDoneChapter(chapter.id).then((ids) => { if (alive.current) setDoneIds(ids); });
      setPhase('chapterDone');
    } else {
      setIdx(idx + 1);
    }
  }, [idx, chapter]);

  // ステップ中のスキップ: 初回は全体を終了、任意再生は章選択へ戻る
  const skip = useCallback(() => {
    if (mode === 'auto') finishAuto();
    else { setRect(null); setPhase('menu'); }
  }, [mode, finishAuto]);

  // spotステップ: 対象タブへ自動遷移→対象が画面外なら「指で動かすような」自動スクロールで
  // 全体を可視域に入れてから測定・照射する
  useEffect(() => {
    setRect(null);
    if (!step || step.kind !== 'spot') return;
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
  }, [idx, phase, chapter]);

  const pad = 6;
  const hole = step?.kind === 'spot' && rect
    ? { x: rect.x - pad, y: rect.y - pad, w: rect.w + pad * 2, h: rect.h + pad * 2 } : null;
  const bubbleBelow = hole ? hole.y + hole.h / 2 < H / 2 : false;

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

      {/* スキップ（ステップ中は常設） */}
      {phase === 'steps' && (
        <Pressable style={s.skip} onPress={skip} hitSlop={10}>
          <Text style={s.skipT}>{mode === 'auto' ? t('スキップ ✕') : t('章をとじる ✕')}</Text>
        </Pressable>
      )}

      {step?.kind === 'spot' && step.demo === 'coach' && (
        <CoachDemoPanel
          title={step.title} text={step.text} onNext={next} H={H}
          progress={<ChapterProgress chapter={chapter} idx={idx} light />}
        />
      )}

      {/* spotの吹き出し */}
      {step?.kind === 'spot' && !step.demo && hole && (
        <View style={[s.bubble, bubbleBelow ? { top: hole.y + hole.h + 14 } : { bottom: H - hole.y + 14 }]}>
          <ChapterProgress chapter={chapter} idx={idx} />
          <Text style={s.bubbleTitle}>{step.title}</Text>
          <Text style={s.bubbleText}>{step.text}</Text>
          <Pressable style={s.nextBtn} onPress={next}>
            <Text style={s.nextBtnT}>{t('次へ')}</Text>
          </Pressable>
          <View style={[s.beak, bubbleBelow ? s.beakUp : s.beakDown, { left: Math.min(Math.max(hole.x + hole.w / 2 - 24, 30), W - 60) }]} />
        </View>
      )}

      {/* 紙芝居ステップ（対象が画面に無い機能はミニ図解で見せる） */}
      {step?.kind === 'sketch' && (
        <View style={s.cardWrap} pointerEvents="box-none">
          <View style={s.card}>
            <ChapterProgress chapter={chapter} idx={idx} />
            <GuideArt id={step.art} />
            <Text style={[s.cardTitle, { textAlign: 'left', fontSize: 18 }]}>{step.title}</Text>
            <Text style={[s.cardText, { textAlign: 'left' }]}>{step.text}</Text>
            <Pressable style={s.nextBtn} onPress={next}>
              <Text style={s.nextBtnT}>{t('次へ')}</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* ウェルカム（初回のみ） */}
      {phase === 'welcome' && (
        <View style={s.cardWrap} pointerEvents="box-none">
          <WelcomeCard onStart={() => playChapter(chapter)} onSkip={finishAuto} />
        </View>
      )}

      {/* 章選択 */}
      {phase === 'menu' && (
        <ChapterMenu chapters={chapters} doneIds={doneIds} onPick={playChapter} onClose={closeMenu} />
      )}

      {/* 章の締め（小さな祝祭） */}
      {phase === 'chapterDone' && (
        <View style={s.cardWrap} pointerEvents="box-none">
          <ChapterDoneCard
            mode={mode} chapter={chapter} allDone={doneIds.length >= chapters.length}
            reduceMotion={reduceMotion}
            onFinishAuto={finishAuto}
            onBackToMenu={() => { setRect(null); setPhase('menu'); }}
          />
        </View>
      )}
    </View>
  );
}

// 章内の進捗（章名・n/m・スプリングで伸びるバー）
function ChapterProgress({ chapter, idx, light }: { chapter: GuideChapter; idx: number; light?: boolean }) {
  const reduceMotion = useReduceMotion();
  const v = useRef(new Animated.Value(0)).current;
  const k = (idx + 1) / chapter.steps.length;
  useEffect(() => {
    if (reduceMotion) { v.setValue(k); return; }
    Animated.spring(v, { toValue: k, useNativeDriver: false, friction: 8, tension: 60 }).start();
  }, [k, v, reduceMotion]);
  return (
    <View style={{ marginBottom: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={[s.progLabel, light && { color: 'rgba(255,255,255,0.82)' }]}>{chapter.title}</Text>
        <Text style={[s.progLabel, light && { color: 'rgba(255,255,255,0.82)' }]}>{idx + 1}/{chapter.steps.length}</Text>
      </View>
      <View style={[s.progTrack, light && { backgroundColor: 'rgba(255,255,255,0.25)' }]}>
        <Animated.View style={[s.progFill, { width: v.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]} />
      </View>
    </View>
  );
}

// ===== 章選択画面 =====
function ChapterMenu({ chapters, doneIds, onPick, onClose }: {
  chapters: GuideChapter[];
  doneIds: GuideChapterId[];
  onPick: (ch: GuideChapter) => void;
  onClose: () => void;
}) {
  const allDone = chapters.every((c) => doneIds.includes(c.id));
  return (
    <View style={s.cardWrap} pointerEvents="box-none">
      <View style={[s.card, { paddingHorizontal: 16 }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
          <Text style={[s.cardTitle, { flex: 1, textAlign: 'left', marginBottom: 0 }]}>{t('使い方ガイド')}</Text>
          <Pressable onPress={onClose} hitSlop={10} style={s.menuClose}><X size={16} color={C.sub} /></Pressable>
        </View>
        <Text style={[s.cardText, { textAlign: 'left', fontSize: 13, marginBottom: 10 }]}>
          {allDone ? t('ぜんぶ読み終えました！何度でも見返せます。') : t('見たい章から、好きな順でどうぞ。')}
        </Text>
        {chapters.map((ch, i) => {
          const done = doneIds.includes(ch.id);
          return (
            <Pressable key={ch.id} style={({ pressed }) => [s.menuRow, i > 0 && s.menuRowSep, pressed && { backgroundColor: C.pressed }]}
                       onPress={() => onPick(ch)}>
              <View style={s.menuIcon}><ch.Icon size={17} color={C.teal} /></View>
              <View style={{ flex: 1 }}>
                <Text style={s.menuTitle}>{ch.title}</Text>
                <Text style={s.menuSub}>{ch.sub}</Text>
              </View>
              {done
                ? <CheckCircle2 size={18} color={C.teal} />
                : <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                    <Text style={s.menuCount}>{t('{n}ステップ', { n: ch.steps.length })}</Text>
                    <ChevronRight size={15} color={C.faint} />
                  </View>}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ===== カードステップ =====

function WelcomeCard({ onStart, onSkip }: { onStart: () => void; onSkip: () => void }) {
  return (
    <View style={s.card}>
      <View style={s.cardIcon}><Hand size={26} color={C.teal} /></View>
      <Text style={s.cardTitle}>{t('ようこそ BodyLog へ')}</Text>
      <Text style={s.cardText}>{t('まずは「入力のきほん」だけ、1分でご案内します。')}{'\n'}{t('ほかの章はあとから好きなときに見られます。')}</Text>
      <OptionButton style={{ alignSelf: 'stretch', marginTop: 14, marginBottom: 8 }} label={t('ガイドを始める')} onPress={onStart} />
      <Pressable onPress={onSkip} hitSlop={8}><Text style={s.linkT}>{t('今はしない')}</Text></Pressable>
    </View>
  );
}

// 章の締めカード: 小さな祝祭（スケールイン・視差軽減時は即表示）
function ChapterDoneCard({ mode, chapter, allDone, reduceMotion, onFinishAuto, onBackToMenu }: {
  mode: GuideMode; chapter: GuideChapter; allDone: boolean; reduceMotion: boolean;
  onFinishAuto: () => void; onBackToMenu: () => void;
}) {
  const scale = useRef(new Animated.Value(reduceMotion ? 1 : 0.8)).current;
  useEffect(() => {
    if (reduceMotion) return;
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 5, tension: 90 }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Animated.View style={[s.card, { transform: [{ scale }] }]}>
      <View style={s.cardIcon}><PartyPopper size={26} color={C.teal} /></View>
      <Text style={s.cardTitle}>{t('「{title}」はこれで完璧！', { title: chapter.title })}</Text>
      {mode === 'auto' ? (
        <>
          <Text style={s.cardText}>{t('まずは今日食べたものを1つ、下の入力欄に書いてみましょう。')}{'\n'}{t('残りの4章は、設定の「使い方ガイド」からいつでも見られます。')}</Text>
          <OptionButton style={{ alignSelf: 'stretch', marginTop: 14 }} label={t('食事を記録してみる')} onPress={onFinishAuto} />
        </>
      ) : (
        <>
          <Text style={s.cardText}>
            {allDone ? t('これで全部の章を読み終えました。あとは使いながら思い出せば大丈夫です。') : t('つづきの章も、好きなときにどうぞ。')}
          </Text>
          <OptionButton style={{ alignSelf: 'stretch', marginTop: 14 }} label={t('章の一覧へ')} onPress={onBackToMenu} />
        </>
      )}
    </Animated.View>
  );
}

// AIコーチの自動デモ: 実際のチャット画面のように、質問がタイプされ→考え中→回答が出て
// →読み進めるようにゆっくり自動スクロールする。回答が長いので全画面パネルで見せる。
function CoachDemoPanel({ title, text, onNext, H, progress }: {
  title: string; text: string; onNext: () => void; H: number; progress?: ReactNode;
}) {
  const Q = t('最近ちょっと停滞気味かも。食事に何か問題ある？');
  // デモ回答も全文を t() に通す（以前は前半3行が日本語のまま英語UIに混ざっていた・2026-09-02 自己監査）
  const A =
    t('直近7日の記録を見ると、気になる傾向が2つあります。') + '\n\n' +
    t('・炭水化物が平均96g/日と、目標160gの6割しか取れていません。糖質が少なすぎると筋グリコーゲンが枯れて、トレ後半で力が出ない・体重が水分で乱高下する原因になります') + '\n' +
    t('・一方、たんぱく質は平均132g（体重×1.6g）でしっかり確保できています💪') + '\n' +
    t('・摂取カロリーは平均1,690kcalで目標−70kcal。ペース自体は悪くありません') + '\n\n' +
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
      {progress}
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
        <Text style={s.nextBtnT}>{t('次へ')}</Text>
      </Pressable>
    </View>
  );
}

const s = themed(() => ({
  cardIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: C.accentSoft, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: 6 },
  skip: {
    position: 'absolute', top: 62, right: 16, backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6,
    zIndex: 5,
  },
  skipT: { color: '#fff', fontSize: 13, fontWeight: '800' },
  bubble: {
    position: 'absolute', left: 18, right: 18, backgroundColor: C.panel, borderRadius: 18, padding: 16,
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 10,
  },
  bubbleTitle: { fontSize: 17, fontWeight: '800', color: C.ink, marginBottom: 5 },
  bubbleText: { fontSize: 15, color: C.sub, lineHeight: 21 },
  nextBtn: { backgroundColor: HILITE, borderRadius: 999, paddingVertical: 11, alignItems: 'center', marginTop: 12 },
  nextBtnT: { color: '#fff', fontSize: 15, fontWeight: '800' },
  progLabel: { fontSize: 11, fontWeight: '800', color: C.faint },
  progTrack: { height: 4, borderRadius: 2, backgroundColor: C.track, marginTop: 4, overflow: 'hidden' },
  progFill: { height: '100%', borderRadius: 2, backgroundColor: HILITE },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingHorizontal: 4, borderRadius: 12 },
  menuRowSep: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line },
  menuIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: C.accentSoft, alignItems: 'center', justifyContent: 'center' },
  menuTitle: { fontSize: 15, fontWeight: '800', color: C.ink },
  menuSub: { fontSize: 12, color: C.sub, marginTop: 1 },
  menuCount: { fontSize: 11, color: C.faint, fontWeight: '700' },
  menuClose: { width: 28, height: 28, borderRadius: 14, backgroundColor: C.chipBg, alignItems: 'center', justifyContent: 'center' },
  demoWrap: { position: 'absolute', left: 20, right: 20, alignItems: 'stretch' },
  demoTitle: { fontSize: 21, fontWeight: '900', color: '#fff', textAlign: 'center' },
  demoLead: { fontSize: 13, color: 'rgba(255,255,255,0.82)', textAlign: 'center', lineHeight: 19, marginTop: 6, marginBottom: 14 },
  demoPhone: {
    backgroundColor: C.panel, borderRadius: 20, overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 12,
  },
  demoBar: { paddingVertical: 9, alignItems: 'center', backgroundColor: C.bg, borderBottomWidth: 1, borderBottomColor: C.line },  // 生HEX淡色はダークで浮くためトークン化
  demoBarT: { fontSize: 13, fontWeight: '800', color: C.sub },
  demoNext: { backgroundColor: HILITE, borderRadius: 999, paddingVertical: 12, alignItems: 'center', marginTop: 16, alignSelf: 'center', paddingHorizontal: 40 },
  demoUser: { alignSelf: 'flex-end', backgroundColor: C.ink, borderRadius: 14, borderBottomRightRadius: 4, paddingHorizontal: 12, paddingVertical: 8, maxWidth: '90%' },
  demoUserT: { color: C.panel, fontSize: 13, lineHeight: 18 },  // ink地（ダーク=明色）に追従
  demoAi: { alignSelf: 'flex-start', backgroundColor: C.chipBg, borderRadius: 14, borderBottomLeftRadius: 4, paddingHorizontal: 12, paddingVertical: 8, maxWidth: '92%' },  // 生HEX淡色はダークで浮くためトークン化
  demoAiT: { color: C.ink, fontSize: 13, lineHeight: 19 },
  beak: { position: 'absolute', width: 0, height: 0, borderLeftWidth: 10, borderRightWidth: 10, borderLeftColor: 'transparent', borderRightColor: 'transparent' },
  // 吹き出しの矢羽根は本体（C.panel）と同色にする（白固定だとダークで矢だけ白く浮く）
  beakUp: { top: -10, borderBottomWidth: 10, borderBottomColor: C.panel },
  beakDown: { bottom: -10, borderTopWidth: 10, borderTopColor: C.panel },
  cardWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: {
    width: '100%', maxWidth: 380, backgroundColor: C.panel, borderRadius: 22, padding: 22, alignItems: 'stretch',
    shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 12,
  },
  cardTitle: { fontSize: 21, fontWeight: '900', color: C.ink, textAlign: 'center', marginBottom: 8 },
  cardText: { fontSize: 15, color: C.sub, lineHeight: 21, textAlign: 'center' },
  linkT: { fontSize: 13, color: C.sub, textAlign: 'center', textDecorationLine: 'underline' },
}));
