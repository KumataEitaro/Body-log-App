// 運動の種目 → lucide のアイコン（2026-09-26・熊田さん「絵文字をやめて洗練されたアイコンに」）。
//
// lib/activities.ts の ACTIVITIES（54件）に 1:1 で対応する。絵文字の `e` フィールドは他で文字列として
// 使う可能性があるので**消さない**（ここは表示専用の別テーブル）。
// 描き方は components/PlusSheet.tsx の行アイコンと同じ「薄い teal の丸地＋線アイコン」（ActivityLogSheet.tsx）。
//
// 【選び方】
//  - 種目そのものを表す絵があるものはそれ（犬の散歩=Dog・自転車=Bike・水泳=WavesLadder・釣り=FishingRod…）
//  - 「速め」の派生種目は元の種目と同じ絵にする（速さはラベルが伝える。別の絵にすると一覧で意味が割れる）
//  - 該当する絵が無い種目（野球・卓球・乗馬・柔道…）は**カテゴリ既定のアイコン**（GROUP_ICON）
//  - lucide に無い名前を書くと tsc で落ちる。追加するときは
//    `grep -c "declare const <Name>:" native/node_modules/lucide-react-native/dist/types/icons.d.ts` で確認する
import type { LucideIcon } from 'lucide-react-native';
import {
  Dog, Footprints, Route, SportShoe, Building2, ArrowUpFromLine, BrushCleaning, CookingPot, ShoppingCart, Baby, Sprout,
  PersonStanding, Bike, WavesLadder, WavesHorizontal, Mountain, Orbit, Sailboat, ChevronsUp, Repeat,
  Flower2, StretchHorizontal, Music, AudioLines, Zap, RefreshCw, BicepsFlexed,
  Goal, Volleyball, Feather, Flag, MountainSnow, Snowflake, Hand, FishingRod, TreePine, Kayak,
  Swords, HandFist, Sword, Trophy, HeartPulse,
} from 'lucide-react-native';
import { ACTIVITY_GROUPS } from './activities';

/** ACTIVITY_GROUPS の key → カテゴリ既定のアイコン（種目に固有の絵が無いときに使う） */
export const GROUP_ICON: Record<string, LucideIcon> = {
  daily: Footprints,      // 日常の動き
  cardio: HeartPulse,     // 有酸素
  studio: Flower2,        // スタジオ・自宅
  ball: Volleyball,       // 球技（lucide の唯一の「ボール」）
  outdoor: TreePine,      // アウトドア
  martial: Swords,        // 格闘技
  other: Trophy,          // その他
};

/** 種目 id → アイコン。ACTIVITIES の全 id を載せる（既定を使う種目も明示して、抜けを grep で見つけられるようにする） */
export const ACTIVITY_ICON: Record<string, LucideIcon> = {
  // 日常の動き
  walk_dog: Dog,
  walk: Footprints,
  walk_fast: Route,               // 歩くコース（散歩の Footprints と区別）
  commute: Building2,             // 街へ向かう徒歩
  stairs: ArrowUpFromLine,        // 上へ
  housework: BrushCleaning,
  cooking: CookingPot,
  shopping: ShoppingCart,
  childcare: Baby,
  garden: Sprout,
  standing: PersonStanding,
  // 有酸素
  run: SportShoe,
  run_fast: SportShoe,            // 速めは同じ絵（ラベルが速さを伝える）
  bike: Bike,
  bike_fast: Bike,
  bike_static: Bike,
  swim: WavesLadder,              // プールのはしご
  swim_hard: WavesLadder,
  hiking: Mountain,
  elliptical: Orbit,              // 楕円の軌道
  rowing: Sailboat,
  stepper: ChevronsUp,            // 段を上る
  jumprope: Repeat,               // 反復
  // スタジオ・自宅
  yoga: Flower2,
  pilates: StretchHorizontal,     // 伸ばす
  dance: Music,
  aerobics: AudioLines,           // リズム
  hiit: Zap,
  circuit: RefreshCw,             // 種目を回す
  calisthenics: BicepsFlexed,
  // 球技
  soccer: Goal,
  futsal: Goal,
  basketball: GROUP_ICON.ball,
  baseball: GROUP_ICON.ball,
  volleyball: Volleyball,
  tennis: GROUP_ICON.ball,
  badminton: Feather,             // シャトルの羽根
  tabletennis: GROUP_ICON.ball,
  golf: Flag,                     // ピンの旗
  bowling: GROUP_ICON.ball,
  // アウトドア
  surf: WavesHorizontal,
  ski: MountainSnow,
  snowboard: MountainSnow,
  skate: Snowflake,               // 氷の上
  bouldering: Hand,               // ホールドをつかむ
  fishing: FishingRod,
  horse: GROUP_ICON.outdoor,
  kayak: Kayak,
  // 格闘技
  martial: Swords,
  boxing: HandFist,
  kendo: Sword,
  judo: GROUP_ICON.martial,
  karate: HandFist,
  // その他
  sports: Trophy,
};

/** 種目 id からアイコンを引く。未登録の id はカテゴリ既定、カテゴリも不明なら Trophy */
export function activityIcon(id: string): LucideIcon {
  const hit = ACTIVITY_ICON[id];
  if (hit) return hit;
  const group = ACTIVITY_GROUPS.find((g) => g.ids.includes(id));
  return (group && GROUP_ICON[group.key]) ?? Trophy;
}
