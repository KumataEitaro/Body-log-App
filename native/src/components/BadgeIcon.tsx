// バッジのメダル描画（Appleのアチーブメントの語彙）。
//
// 構造: ①外周リング（線形グラデ＝金属の上下光） ②円盤の面（放射グラデ＝中心が明るい）
//       ③面の内側に落ちる影（厚みを出す） ④上面を斜めに走る光沢 ⑤中央に象徴シンボル。
// 獲得済み=カテゴリ色相のメダル、未獲得=無彩色シルエット（Appleと同じ「集める余地」の見せ方）。
// 色は必ずCトークンから導出する（lib/badgeArt）。生HEXはこのファイルに一つも置かない。
import { useId } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, RadialGradient, Stop } from 'react-native-svg';
import {
  Flame, Bird, Calendar, CalendarCheck, Sunrise,
  Camera, Aperture, MessageCircle, Brain, Salad, BookOpen, CheckCheck, Timer, Moon,
  Scale, Medal, Trophy, Mountain, Flag, Dumbbell, Weight, Footprints, Route, Zap, TrendingUp,
  Award,
  // 以下はリモート配信のバッジが名前で指せる追加分（許可リスト。同梱＝バンドルに含まれることが保証される）
  Activity, Apple, Bike, Carrot, Coffee, Crown, Droplet, Egg, Fish, Gem, Heart, HeartPulse, Leaf,
  Lightbulb, Rocket, Sparkles, Sprout, Star, Sun, Target, Waves, Wheat, Wind, Utensils, CalendarDays,
  Smile, Users, UserPlus, Share2, Pencil, ClipboardList, ListChecks, Repeat, History, Gauge,
  type LucideIcon,
} from 'lucide-react-native';
import { C } from '@/lib/ui';
import { hueOf, medalTones, silhouetteTones, spreadHues, type MedalTones } from '@/lib/badgeArt';
import { badgeById, badgeCatOf, type BadgeCat } from '@/lib/achievements';

const MAP: Record<string, LucideIcon> = {
  // 継続
  streak3: Flame, streak7: Flame, streak14: Flame, streak30: Flame, streak60: Flame, streak100: Flame,
  phoenix: Bird, weekend4: Calendar, week_promise: CalendarCheck, morning14: Sunrise,
  // 記録
  photo1: Camera, photo30: Aperture, coach10: MessageCircle, coach100: Brain,
  myfood5: Salad, myfood20: BookOpen, fullday: CheckCheck, rest50: Timer, nolate7: Moon,
  // 体重
  lost1: Scale, lost3: Medal, lost5: Trophy, goal50: Mountain, goal100: Flag,
  // 運動
  vol10t: Weight, vol20t: Dumbbell, km50: Footprints, km100: Route, burn5000: Zap, pr5: TrendingUp,
};

/**
 * リモート定義のバッジが `icon: 'Flame'` のように名前で指せるアイコンの許可リスト。
 * Lucideの全アイコンを受け付けない理由: ①名前の誤記や未知の名前で落ちない
 * ②バンドルに実際に含まれているものだけを保証する（Metroは使っていないアイコンを同梱しない）。
 * 足したいときは import に加えてここに1行書き、docs/REMOTE-CONTENT.md の一覧も更新する
 */
export const BADGE_ICONS: Record<string, LucideIcon> = {
  Flame, Bird, Calendar, CalendarCheck, CalendarDays, Sunrise, Sun, Moon, Star, Sparkles,
  Camera, Aperture, MessageCircle, Brain, Lightbulb, Pencil, ClipboardList, ListChecks, Repeat, History,
  Salad, Apple, Carrot, Coffee, Egg, Fish, Leaf, Sprout, Wheat, Utensils, BookOpen, CheckCheck, Timer,
  Scale, Medal, Trophy, Award, Crown, Gem, Mountain, Flag, Target, Rocket,
  Dumbbell, Weight, Footprints, Route, Bike, Waves, Wind, Zap, TrendingUp, Activity, Gauge,
  Heart, HeartPulse, Droplet, Smile, Users, UserPlus, Share2,
};

/** 許可リストに載っているアイコン名か（純関数・テスト対象） */
export function isAllowedBadgeIcon(name: string | undefined | null): boolean {
  return !!name && Object.prototype.hasOwnProperty.call(BADGE_ICONS, name);
}

/**
 * バッジidからアイコンを決める。①同梱の対応表 ②定義のicon名（許可リスト内） ③既定（Award）。
 * リモートで同梱バッジの文言だけ差し替えた場合も、アイコンは同梱の対応表が優先される
 */
export function badgeIconOf(id: string, iconName?: string | null): LucideIcon {
  if (MAP[id]) return MAP[id];
  const name = iconName ?? badgeById(id)?.icon;
  return (isAllowedBadgeIcon(name) ? BADGE_ICONS[name!] : undefined) ?? Award;
}

/**
 * カテゴリ別の色相。テーマのアクセント（C.teal）を「記録」に据え、
 * 継続は暖色（C.amber由来＝炎/金）、体重・運動はC.calorieBar由来の青系から派生させる。
 * アクセントと近すぎるカテゴリは spreadHues が押しのけるので、どのテーマでも4色が識別できる。
 */
export function categoryHues(): Record<BadgeCat, number> {
  const accent = hueOf(C.teal);
  const gold = hueOf(C.amber) ?? 40;
  const slate = hueOf(C.calorieBar) ?? 211;
  const [streak, body, move] = spreadHues(accent, [gold - 4, slate + 12, slate + 60]);
  return { streak, action: accent ?? gold, body, move };
}

/** 1つのメダルの配色（獲得済み=カテゴリ色相・未獲得=無彩色シルエット） */
export function tonesFor(cat: BadgeCat, earned: boolean): MedalTones {
  if (!earned) return silhouetteTones({ chipBg: C.chipBg, track: C.track, line: C.line, faint: C.faint });
  return medalTones(categoryHues()[cat]);
}

/**
 * メダル。size=グリッド56px・詳細96px・祝祭64pxを想定（可変）。
 * earned=false は無彩色シルエット（条件を満たすと色がつく、という期待を作る）。
 */
export default function BadgeIcon({ id, size = 44, earned = false, cat }: {
  id: string; size?: number; earned?: boolean; cat?: BadgeCat;
}) {
  const Icon = badgeIconOf(id);
  // グラデーションのidは同一画面に複数のメダルが並ぶため必ず一意にする（衝突すると色が混ざる）
  const key = useId().replace(/[^a-zA-Z0-9]/g, '');
  const tones = tonesFor(cat ?? badgeCatOf(id), earned);
  const iconSize = Math.round(size * 0.42);
  return (
    <View style={{
      width: size, height: size, alignItems: 'center', justifyContent: 'center',
      // 獲得済みだけ浮かせる（未獲得は面に沈んでいてよい）
      ...(earned ? {
        shadowColor: 'rgba(0,0,0,1)', shadowOpacity: 0.20,
        shadowRadius: size * 0.10, shadowOffset: { width: 0, height: size * 0.045 }, elevation: 3,
      } : null),
    }}>
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Defs>
          <RadialGradient id={`face${key}`} cx="36%" cy="28%" r="78%">
            <Stop offset="0" stopColor={tones.core} />
            <Stop offset="0.55" stopColor={tones.mid} />
            <Stop offset="1" stopColor={tones.edge} />
          </RadialGradient>
          <LinearGradient id={`rim${key}`} x1="0" y1="0" x2="0.35" y2="1">
            <Stop offset="0" stopColor={tones.rimHi} />
            <Stop offset="1" stopColor={tones.rimLo} />
          </LinearGradient>
        </Defs>
        {/* 外周リング */}
        <Circle cx="50" cy="50" r="49" fill={`url(#rim${key})`} />
        {/* 円盤の面 */}
        <Circle cx="50" cy="50" r="42" fill={`url(#face${key})`} />
        {/* 面の内側に落ちる影（リングの厚みを感じさせる） */}
        <Circle cx="50" cy="50" r="40" stroke={tones.shade} strokeWidth="4" fill="none" />
        {/* リングと面の境の細い光 */}
        <Circle cx="50" cy="50" r="44.5" stroke={tones.ring} strokeWidth="1" fill="none" />
        {/* 上面を斜めに走る光沢 */}
        <Path d="M 26 20 A 40 40 0 0 1 80 26" stroke={tones.gloss} strokeWidth="5"
              strokeLinecap="round" fill="none" />
      </Svg>
      {/* 中央の象徴シンボル（SVGの上に重ねる） */}
      <View style={{ position: 'absolute' }}>
        <Icon size={iconSize} color={tones.icon} strokeWidth={earned ? 2.4 : 2} />
      </View>
    </View>
  );
}
