// 起動イントロ（Withings風）: ネイティブスプラッシュ（白＋丸アイコン中央）をJS側で
// 同一見た目のオーバーレイに引き継ぎ、一拍見せてからアイコンをスケール＋フェードで消す。
// 消え始めと同時に introDone=true を流し、各画面がコンポーネントを時差入場させる。
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { themed } from '@/lib/ui';

// JSがロードされるまでネイティブスプラッシュを保持（失敗しても起動は続行）。
// .catch() だけでは「Promiseを返す前の同期throw」（ネイティブモジュール未リンク等）を
// 拾えないため try でも包む。モジュール評価時の副作用はErrorBoundaryより手前で走るので、
// ここが throw すると起動ごと落ちる（docs/ANDROID.md「起動クラッシュの調査手順」）
try {
  SplashScreen.preventAutoHideAsync().catch(() => {});
} catch { /* スプラッシュが早く消えるだけ */ }

const LaunchCtx = createContext<{ introDone: boolean }>({ introDone: true });
export const useLaunch = () => useContext(LaunchCtx);

const HOLD_MS = 800;      // アイコンを一拍見せる時間（ユーザー好みで長め）
const FADE_MS = 480;      // アイコンが消える時間
const FAILSAFE_MS = 2500; // readyが来ない事故（オフライン等）でも必ず開ける

export function LaunchProvider({ ready, children }: { ready: boolean; children: ReactNode }) {
  const [introDone, setIntroDone] = useState(false);
  const [gone, setGone] = useState(false);
  const fade = useRef(new Animated.Value(1)).current;
  const scale = useRef(new Animated.Value(1)).current;
  const started = useRef(false);

  useEffect(() => {
    const go = () => {
      if (started.current) return;
      started.current = true;
      SplashScreen.hideAsync().catch(() => {});
      setTimeout(() => {
        setIntroDone(true); // コンテンツの時差入場はアイコンが消え始めるのと同時に開始
        Animated.parallel([
          Animated.timing(scale, { toValue: 1.12, duration: FADE_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
          Animated.timing(fade, { toValue: 0, duration: FADE_MS, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        ]).start(() => setGone(true));
      }, HOLD_MS);
    };
    const failsafe = setTimeout(go, FAILSAFE_MS);
    if (ready) go();
    return () => clearTimeout(failsafe);
  }, [ready, fade, scale]);

  return (
    <LaunchCtx.Provider value={{ introDone }}>
      {children}
      {!gone && (
        <Animated.View style={[s.cover, { opacity: fade }]} pointerEvents={introDone ? 'none' : 'auto'}>
          <Animated.Image
            source={require('../../assets/images/splash-icon.png')}
            style={[s.icon, { transform: [{ scale }] }]}
          />
        </Animated.View>
      )}
    </LaunchCtx.Provider>
  );
}

const s = themed(() => ({
  // app.jsonのsplash設定（背景#C8FAFB＝アイコンの水色・imageWidth 160）と完全に同じ見た目にして、
  // ネイティブスプラッシュ→JSオーバーレイのつなぎ目を消す。
  // ここを変えるときは app.json の splash.backgroundColor も必ず一緒に変える（色が飛ぶ）
  cover: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: '#C8FAFB', alignItems: 'center', justifyContent: 'center', zIndex: 999,
  },
  icon: { width: 160, height: 160, resizeMode: 'contain' },
}));
