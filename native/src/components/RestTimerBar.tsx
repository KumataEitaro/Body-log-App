// レスト中だけ画面の上に出る小さな帯（2026-09-17）。
//
// 熊田さん「戻るボタンから戻って例えば食事タブにいてもタイマーの数字が見えていて、
//           終わったら通知も来るような」
//
// iOS の「通話中」バーと同じ考え方で、**どの画面にいても残り時間が見える**ようにする。
// タップで筋トレ記録画面へ戻り、✕でレストを止められる。
//
// 置き場所は app/_layout.tsx のルート（Stack の外）。タブバーは unstable-native-tabs＝
// OS が描くので下端には割り込めず、また右下は＋ボタンの定位置なので、**上端**に出す。
// 筋トレ記録画面自身は大きなタイマーを持っているので、そこでは出さない。
import { View, Text, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, usePathname } from 'expo-router';
import { Timer, X } from 'lucide-react-native';
import { C, RADIUS, ICON, themed } from '@/lib/ui';
import { useThemeRefresh } from '@/lib/theme';
import { useRestLeft, stopRest } from '@/lib/restTimer';
import { navFrom, type NavFrom } from '@/lib/navHeader';
import { t } from '@/lib/i18n';

/** いまいるタブ → 筋トレ記録画面の戻るラベル（「‹ 食事」のように、押す前の場所を名乗る） */
function fromOf(pathname: string): NavFrom | undefined {
  for (const k of ['log', 'training', 'coach', 'changes'] as const) if (pathname.startsWith(`/${k}`)) return k;
  return undefined;
}

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

export default function RestTimerBar() {
  useThemeRefresh();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const pathname = usePathname();
  const left = useRestLeft();

  // 筋トレ記録画面にいる間は出さない（同じ数字が2つ並ぶ）
  const onLiftScreen = pathname.startsWith('/lift-session');
  if (left == null || onLiftScreen) return null;

  const done = left <= 0;
  return (
    <View pointerEvents="box-none" style={[s.wrap, { top: insets.top + 4 }]}>
      <Pressable
        onPress={() => router.push({ pathname: '/lift-session', params: navFrom(fromOf(pathname)) } as never)}
        accessibilityRole="button"
        accessibilityLabel={done ? t('レスト終了') : t('レスト中')}
        testID="rest-timer-bar"
        style={[s.pill, { backgroundColor: done ? C.teal : C.panel, borderColor: done ? C.teal : C.line }]}
      >
        <Timer size={ICON.sm} color={done ? '#fff' : C.teal} />
        <Text style={[s.label, { color: done ? '#fff' : C.sub }]}>{done ? t('レスト終了') : t('レスト')}</Text>
        <Text style={[s.time, { color: done ? '#fff' : C.ink }]}>{mmss(Math.max(0, left))}</Text>
        <Pressable
          onPress={() => { void stopRest(); }}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t('レストを止める')}
          testID="rest-timer-stop"
        >
          <X size={ICON.sm} color={done ? '#fff' : C.sub} />
        </Pressable>
      </Pressable>
    </View>
  );
}

const s = themed(() => ({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 50 },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    paddingHorizontal: 13, paddingVertical: 7,
    borderRadius: RADIUS.chip, borderWidth: 1,
    // 本文の上に浮いていることを影で示す（Android は elevation）
    shadowColor: C.shadow, shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 4,
  },
  label: { fontSize: 12, fontWeight: '700' },
  time: { fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] },
}));
