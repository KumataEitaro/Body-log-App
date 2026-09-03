// 広告枠（全タブ共通）。AdBannerView（中身）を包み、
// 「いつ出すか」「どう消えるか」だけをここで決める。
//
// - 表示条件は useGate(): active（RCキー設定済みの課金有効ビルド）× plan が null/'free'。
//   現在の運用（RCキー未設定）では誰にも表示されない＝「広告あり無料 ↔ 広告なし有料」の差は
//   課金列車と同時にしか点灯しない（仕組みで保証・RELEASE-RISKS A1）
// - 課金完了（plan が standard 以上に変わった瞬間）は、Reanimated の高さアニメ
//   （AD_COLLAPSE_MS=180ms・easeOut）で枠を畳んでから unmount ＝「きれいに消える」。
//   下のカードがガタンと跳ね上がらない
// - 読み込み前は高さを確保しない（ラベル・導線も出さない）。読み込み前に課金が通ったら
//   畳む対象が無いので即 unmount（lib/ads.ts の状態遷移）
// - 読み込み失敗・Expo Go・モジュール無し環境では高さ0（空白の枠を見せない）
// - 1画面に最大1枠。置く場所は各タブの「閲覧領域の境目」（docs/ADS.md の枠一覧）
// - 「視差効果を減らす」ON の人にはアニメ無しで即消す（useReduceMotion）
import { useCallback, useEffect, useRef, useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import Animated, { Easing, interpolate, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { themed } from '@/lib/ui';
import { useGate } from '@/lib/gate';
import { useReduceMotion } from '@/lib/motion';
import { AD_COLLAPSE_MS, bannerMounted, nextAdSlotState, shouldShowAd, type AdPlacement, type AdSlotEvent, type AdSlotState } from '@/lib/ads';
import { recordAdImpression } from '@/lib/adImpressions';
import AdBannerView, { adsAvailable, ensureAdsInit } from '@/components/AdBannerView';

type Props = {
  /** 設置場所（計測・将来のユニット出し分け用。いまは全枠で同じユニットID） */
  placement: AdPlacement;
  /** 会話リストなど詰まった場所向けに下余白を小さくする */
  compact?: boolean;
};

// 枠の下余白（カード群の card は marginBottom:12 に合わせる）。compact は会話バブルの間隔
const GAP = 12;
const GAP_COMPACT = 8;

export default function AdSlot({ placement, compact }: Props) {
  const { active, plan } = useGate();
  const reduceMotion = useReduceMotion();
  const eligible = adsAvailable() && shouldShowAd(active, plan);

  const [state, setState] = useState<AdSlotState>(() => (eligible ? 'loading' : 'hidden'));
  const dispatch = useCallback((ev: AdSlotEvent) => setState((s) => nextAdSlotState(s, ev)), []);

  // 表示可否の変化を状態機械へ流す（課金完了 → ineligible → shown なら collapsing）
  useEffect(() => { dispatch(eligible ? 'eligible' : 'ineligible'); }, [eligible, dispatch]);
  // SDK初期化は実際に読み込みを始める端末で1回だけ
  useEffect(() => { if (state === 'loading') ensureAdsInit(); }, [state]);

  // 畳むアニメ: 直近に測った高さ → 0。h<0 は「自動高さ（アニメしていない）」の印
  const measured = useRef(0);
  const h = useSharedValue(-1);
  const startH = useSharedValue(1);
  const gap = compact ? GAP_COMPACT : GAP;
  const onCollapsed = useCallback(() => dispatch('collapsed'), [dispatch]);
  useEffect(() => {
    if (state !== 'collapsing') return;
    // 高さ未測定（読み込み直後など）・視差効果を減らす → アニメ無しで即消す
    if (measured.current <= 0 || reduceMotion) { onCollapsed(); return; }
    startH.value = measured.current;
    h.value = measured.current;
    h.value = withTiming(0, { duration: AD_COLLAPSE_MS, easing: Easing.out(Easing.cubic) }, (finished) => {
      if (finished) runOnJS(onCollapsed)();
    });
  }, [state, reduceMotion, onCollapsed, h, startH]);
  // hidden に戻ったら自動高さへ（次に出るときにアニメの残骸を引き継がない）
  useEffect(() => { if (state === 'hidden') { h.value = -1; measured.current = 0; } }, [state, h]);

  const anim = useAnimatedStyle(() => {
    if (h.value < 0) return {};
    // 高さと下余白を同じカーブで縮める（余白だけ残って「隙間」に見えるのを防ぐ）
    return { height: h.value, marginBottom: interpolate(h.value, [0, startH.value], [0, gap]) };
  });

  if (!bannerMounted(state)) return null;
  const loaded = state === 'shown' || state === 'collapsing';
  const onLayout = (e: LayoutChangeEvent) => { measured.current = e.nativeEvent.layout.height; };
  return (
    <Animated.View style={[s.wrap, loaded && { marginBottom: gap }, anim]} testID={`ad-slot-${placement}`}>
      <View onLayout={onLayout}>
        <AdBannerView
          placement={placement}
          loaded={loaded}
          onLoaded={() => {
            dispatch('loaded');
            // 「この1週間で広告を{n}回見ています」の n を数える（端末内のみ・lib/adImpressions.ts）。
            // 同じ枠の短時間の重複（タブ往復・再レイアウト）は数えない＝数字を水増ししない
            recordAdImpression(placement).catch(() => {});
          }}
          onFailed={() => dispatch('failed')}
        />
      </View>
    </Animated.View>
  );
}

const s = themed(() => ({
  // 読み込み前は余白も持たない（高さ0のまま）。見えてから gap ぶんの下余白が付く
  wrap: { overflow: 'hidden' },
}));
