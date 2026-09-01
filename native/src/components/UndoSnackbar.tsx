// 削除のUndoスナックバー（確認ダイアログの置き換え）。
// 「本当に削除しますか？」で毎回手を止めるかわりに、削除は即実行して
// 約5秒の取り消し猶予を画面下部に出す（Gmail/iOS標準の流儀・2026年主流のUXパターン）。
// 使い方: const undo = useUndoSnackbar(bottomOffset) → 破壊操作の成功後に
//         undo.show(t('削除しました'), onUndo) を呼び、undo.element を画面末尾に描く。
// 連続削除は最後の1件だけを表示する（前の件のonExpireを先に確定させる＝取り消しの取りこぼしなし）。
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Reanimated, {
  Easing, SlideInDown, SlideOutDown, useAnimatedStyle, useSharedValue, withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { C } from '@/lib/ui';
import { t } from '@/lib/i18n';
import { useReduceMotion } from '@/lib/motion';

// 猶予時間。短いと押し損ね、長いと「消えていない」不安になる（Material 3の推奨帯の中庸）
const DURATION_MS = 5000;

type Item = {
  key: number;
  label: string;
  onUndo: () => void | Promise<void>;
  onExpire?: () => void;
};

export type ShowUndo = (label: string, onUndo: () => void | Promise<void>, onExpire?: () => void) => void;

/**
 * Undoスナックバーの状態と表示要素。bottomは画面下端からの距離
 * （タブ・ドックの上に重ねる位置は画面ごとに違うため呼び出し側が決める）。
 */
export function useUndoSnackbar(bottom = 24): { show: ShowUndo; element: ReactNode } {
  const [item, setItem] = useState<Item | null>(null);
  const keyRef = useRef(0);
  // setStateの更新関数の中で副作用（onExpire）を呼ばないよう、現物はrefでも持つ
  const curRef = useRef<Item | null>(null);

  const dismiss = useCallback((key: number) => {
    if (curRef.current?.key === key) curRef.current = null;
    setItem((cur) => (cur?.key === key ? null : cur));
  }, []);

  const show = useCallback<ShowUndo>((label, onUndo, onExpire) => {
    // 連続削除: 前の1件の猶予は打ち切って確定させ、最後の1件だけを見せる
    curRef.current?.onExpire?.();
    const next: Item = { key: ++keyRef.current, label, onUndo, onExpire };
    curRef.current = next;
    setItem(next);
  }, []);

  // ラッパーは常設（アンマウント時のexitingアニメーションを生かすため）。触れない領域は素通し
  const element = (
    <View pointerEvents="box-none" style={[sw.wrap, { bottom }]}>
      {item && <SnackBar key={item.key} item={item} onDone={dismiss} />}
    </View>
  );
  return { show, element };
}

function SnackBar({ item, onDone }: { item: Item; onDone: (key: number) => void }) {
  const reduce = useReduceMotion();
  // 残り時間バー（1→0）。数字のカウントダウンより静かで、視界の端で猶予が分かる
  const progress = useSharedValue(1);
  const expired = useRef(false);

  useEffect(() => {
    // 表示時に軽い触覚を1回（「消えたが、まだ戻せる」の合図）
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    progress.value = withTiming(0, { duration: DURATION_MS, easing: Easing.linear });
    const id = setTimeout(() => {
      expired.current = true;
      item.onExpire?.();
      onDone(item.key);
    }, DURATION_MS);
    return () => clearTimeout(id);
    // itemはkey付きで作り直される（マウント中に差し替わらない）ため初回だけでよい
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fillStyle = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));

  return (
    <Reanimated.View
      // スプリング入場/退場。視差軽減設定ではアニメーションなしで即時に出し入れする
      entering={reduce ? undefined : SlideInDown.springify().damping(18)}
      exiting={reduce ? undefined : SlideOutDown.duration(180)}
      style={sw.bar}
    >
      <View style={sw.row}>
        <Text style={sw.label} numberOfLines={1}>{item.label}</Text>
        <Pressable hitSlop={10}
                   onPress={() => {
                     if (expired.current) return;   // 期限切れの直後の連打を弾く
                     Haptics.selectionAsync().catch(() => {});
                     onDone(item.key);
                     item.onUndo();
                   }}>
          <Text style={sw.undo}>{t('元に戻す')}</Text>
        </Pressable>
      </View>
      <View style={sw.track}>
        <Reanimated.View style={[sw.fill, fillStyle]} />
      </View>
    </Reanimated.View>
  );
}

const sw = StyleSheet.create({
  // 呼び出し側のbottom指定で、タブバーやインプットドックの上に重なる位置に出す
  wrap: { position: 'absolute', left: 16, right: 16, alignItems: 'center' },
  bar: {
    alignSelf: 'stretch', backgroundColor: C.panel,
    borderWidth: 1, borderColor: C.line, borderRadius: 16,
    paddingHorizontal: 14, paddingTop: 11, paddingBottom: 8,
    shadowColor: '#0e1116', shadowOpacity: 0.14, shadowRadius: 16, shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  label: { flex: 1, fontSize: 14, fontWeight: '700', color: C.ink },
  undo: { fontSize: 14, fontWeight: '800', color: C.teal },
  // 残り時間の細いプログレス（下辺に沿わせる）
  track: { height: 3, borderRadius: 2, backgroundColor: C.track, overflow: 'hidden', marginTop: 9 },
  fill: { height: 3, borderRadius: 2, backgroundColor: C.teal },
});
