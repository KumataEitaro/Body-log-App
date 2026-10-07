// 起動イントロ（Withings風）: ネイティブスプラッシュ（白地＋白い円盤のアイコン中央・ダークは Navy 地）をJS側で
// 同一見た目のオーバーレイに引き継ぎ、一拍見せてからアイコンをスケール＋フェードで消す。
// 2026-10-07: アイコンを白地の円盤に戻したのに合わせ、地の色は lib/brand.ts の BRAND（white / navy）に一本化。
// 明暗は**端末の外観**（Appearance）で決める＝直前に出るネイティブスプラッシュ（app.json の splash / splash.dark）と同じ判定。
// アプリ内テーマ（手動でライト固定など）は使わない: 継ぎ目を消すにはスプラッシュと同じ色でなければならず、テーマの差は
// このオーバーレイが消えたあとの本体が担う（HIG「起動画面は端末の外観に合わせる」）
// 消え始めと同時に introDone=true を流し、各画面がコンポーネントを時差入場させる。
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, Appearance } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { themed } from '@/lib/ui';
import { BRAND } from '@/lib/brand';

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
  // 端末の外観はマウント時に1回読む（起動の数百ms の間に変わることはない。変わっても次回起動で追従する）
  const coverBg = useRef(Appearance.getColorScheme() === 'dark' ? BRAND.navy : BRAND.white).current;

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
        <Animated.View style={[s.cover, { opacity: fade, backgroundColor: coverBg }]} pointerEvents={introDone ? 'none' : 'auto'}>
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
  // app.jsonのsplash設定（背景 BRAND.white / dark は BRAND.navy・imageWidth 160・画像は白い角丸タイル）と完全に同じ見た目にして、
  // ネイティブスプラッシュ→JSオーバーレイのつなぎ目を消す。地の色は描画側で coverBg を上書きする（端末の外観で決める）。
  // ここを変えるときは app.json の splash.backgroundColor / splash.dark.backgroundColor も必ず一緒に変える（色が飛ぶ）。
  // 画像（splash-icon.png）は角だけ透明な白いタイル: 白地では縁が見えず円盤だけが浮き、Navy 地では白いアイコンタイルに見える
  cover: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center', zIndex: 999,
  },
  icon: { width: 160, height: 160, resizeMode: 'contain' },
}));
