// バッジの絵文字をLucideアイコン＋淡色サークルに置き換える。
// アイコン名はimportで明示する（存在しない名前はtscが弾く＝ビルド前に検出できる）。
import { View } from 'react-native';
import {
  Flame, Bird, Calendar, Sunrise,
  Camera, Aperture, MessageCircle, Brain, Salad, BookOpen, CheckCheck, Timer, Moon,
  Scale, Medal, Trophy, Mountain, Flag, Dumbbell, Weight, Footprints, Route, Zap, TrendingUp,
  Award, type LucideIcon,
} from 'lucide-react-native';
import { C } from '@/lib/ui';

const MAP: Record<string, LucideIcon> = {
  // 継続
  streak3: Flame, streak7: Flame, streak14: Flame, streak30: Flame, streak60: Flame, streak100: Flame,
  phoenix: Bird, weekend4: Calendar, morning14: Sunrise,
  // 行動
  photo1: Camera, photo30: Aperture, coach10: MessageCircle, coach100: Brain,
  myfood5: Salad, myfood20: BookOpen, fullday: CheckCheck, rest50: Timer, nolate7: Moon,
  // 成果
  lost1: Scale, lost3: Medal, lost5: Trophy, goal50: Mountain, goal100: Flag,
  vol10t: Weight, vol20t: Dumbbell, km50: Footprints, km100: Route, burn5000: Zap, pr5: TrendingUp,
};

export function badgeIconOf(id: string): LucideIcon { return MAP[id] ?? Award; }

/** 淡色サークルに載せたバッジアイコン。dim=未獲得のグレー表示 */
export default function BadgeIcon({ id, size = 44, dim = false, color }: {
  id: string; size?: number; dim?: boolean; color?: string;
}) {
  const Icon = badgeIconOf(id);
  const col = color ?? (dim ? C.faint : C.teal);
  return (
    <View style={{
      width: size, height: size, borderRadius: size / 2,
      backgroundColor: dim ? C.chipBg : C.accentSoft,
      borderWidth: 1, borderColor: dim ? C.line : C.accentBorder,
      alignItems: 'center', justifyContent: 'center',
    }}>
      <Icon size={size * 0.5} color={col} strokeWidth={2.2} />
    </View>
  );
}
