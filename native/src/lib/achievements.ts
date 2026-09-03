// 実績（バッジ）とストリークの判定。
//
// 方針:
//  ・判定に使うデータは本人のDB行（entries/logs/my_foods/ai_usage）＋端末カウンタ。
//  ・「獲得済み」はAsyncStorageに永続化（一度取ったバッジは条件から外れても消えない）。
//  ・ストリークには週1回の「お守り」（1日の抜けを週1回まで自動でつなぐ）。
//    失う恐怖だけのストリークは折れた瞬間に退会を招くため、毒抜きとして必須。
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { todayJST } from './calc';
import { parseLiftText, effectiveKg, weightLookup } from './liftLog';
import { t } from './i18n';
import {
  evaluateDeclarativeBadge, getRemoteContent, mergeById, onRemoteContentChange, pickL10n,
  type BadgeCondition, type BadgeMetrics, type RemoteBadge,
} from './remoteContent';

const EARNED_KEY = 'bl-badges-earned';   // { [id]: 'YYYY-MM-DD' }
const REST_COUNT_KEY = 'bl-rest-count';  // レストタイマー起動回数（端末ローカル）
// 「この端末で一度でも評価したバッジidの集合」（JSON配列）。
// あとから定義を増やしたバッジを遡って通知するために必要（planBadgeUnlocksのコメント参照）
const SEEN_DEFS_KEY = 'bl-badges-seen-defs';
const UNSEEN_KEY = 'bl-badges-unseen';   // 未読（実績ページでまだ見ていない）獲得id
const BANNER_KEY = 'bl-badges-banner';   // 食事タブの帯がまだ未消化の獲得id
// ソフト週目標（'7'|'5'|'4'|'3'・未設定=毎日）。「1日欠け→全崩壊」の完璧主義を
// 週◯日でOKの自己契約に緩めるためのキー。設定画面と実績ページが共有する
export const WEEK_GOAL_KEY = 'bl-week-goal';

// バッジのカテゴリ。実績ページの見出しと、メダルの色相（lib/badgeArt）の両方に効く。
// 4分割なのは「継続／記録／体重／運動」がユーザーの頭の中の分け方であり、
// 色相を4つに割り当てられる最小単位でもあるため（旧'result'は体重と運動に分けた）
export type BadgeCat = 'streak' | 'action' | 'body' | 'move';

export type Badge = {
  id: string;
  emoji: string;
  name: string;
  desc: string;                 // 未獲得時に出す条件文
  cat: BadgeCat;
  // 獲得条件の宣言的DSL（lib/remoteContent）。あるものは evaluateDeclarativeBadge で判定し、
  // 無いもの（不死鳥・週末・週の約束・全部入り・深夜ゼロ・五合目・登頂）はコードで判定する
  when?: BadgeCondition[];
  // Lucideのアイコン名（リモート定義用。同梱のバッジは components/BadgeIcon の対応表を使う）
  icon?: string;
  remote?: boolean;             // true=リモート配信で増えた定義
};

export type BadgeState = Badge & { earnedOn: string | null };

// ===== 日付ヘルパー =====
function shiftDate(d: string, n: number): string {
  const dt = new Date(d + 'T00:00:00');
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
function weekKey(d: string): string {
  // 月曜はじまりの週キー
  const dt = new Date(d + 'T00:00:00');
  dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

/**
 * 記録ストリーク（お守り＝1日の抜けを週1回まで自動でつなぐ）。
 * recordedは記録がある日付の集合。todayが未記録でもストリークは切らない（今日はまだ終わっていない）。
 * 戻り値: { days, usedFreeze } usedFreeze=直近でお守りが効いた日（表示用・なければnull）
 */
export function calcStreak(recorded: Set<string>, today: string): { days: number; usedFreeze: string | null } {
  let days = 0;
  let usedFreeze: string | null = null;
  const freezeUsedWeeks = new Set<string>();
  let d = recorded.has(today) ? today : shiftDate(today, -1);
  // 今日も昨日も無いなら0（お守りは「連続の途中の1日」だけを救う）
  if (!recorded.has(d)) return { days: 0, usedFreeze: null };
  for (let i = 0; i < 1000; i++) {
    if (recorded.has(d)) {
      days++;
      d = shiftDate(d, -1);
      continue;
    }
    // 抜けた日: その週でまだお守り未使用＆さらに前日は記録がある（連続の途中）なら救済
    const wk = weekKey(d);
    if (!freezeUsedWeeks.has(wk) && recorded.has(shiftDate(d, -1))) {
      freezeUsedWeeks.add(wk);
      if (!usedFreeze) usedFreeze = d;
      d = shiftDate(d, -1);
      continue;
    }
    break;
  }
  return { days, usedFreeze };
}

/**
 * 今週（月曜起点）の記録状況。days=月〜日の記録有無、count=記録日数。
 * 週の起点はcalcStreakのお守りや週別バランスと同じweekKey（月曜）に統一する。
 */
export function calcWeekProgress(recorded: Set<string>, today: string): { count: number; days: boolean[]; todayIdx: number } {
  const mon = weekKey(today);
  const days = Array.from({ length: 7 }, (_, i) => recorded.has(shiftDate(mon, i)));
  const todayIdx = Math.round((Date.parse(today) - Date.parse(mon)) / 86400000);
  return { count: days.filter(Boolean).length, days, todayIdx };
}

/**
 * 週の約束バッジの判定: 直近4週すべてで記録日数>=goal。
 * 今週は進行中で「まだ守れていない」と誤判定しうるため、完了した先週から遡る
 * （weekend4と同じ考え方）。
 */
export function weekPromiseOk(recorded: Set<string>, today: string, goal: number): boolean {
  for (let w = 1; w <= 4; w++) {
    const mon = shiftDate(weekKey(today), -7 * w);
    let n = 0;
    for (let i = 0; i < 7; i++) if (recorded.has(shiftDate(mon, i))) n++;
    if (n < goal) return false;
  }
  return true;
}

/** 過去に一度でも折れて、その後30日以上つないだか（不死鳥） */
export function hadComeback(recordedSorted: string[], today: string): boolean {
  // 記録日を古い順に走査し、「2日以上の穴」の後に30日連続があればtrue
  let run = 1;
  for (let i = 1; i < recordedSorted.length; i++) {
    const gap = (Date.parse(recordedSorted[i]) - Date.parse(recordedSorted[i - 1])) / 86400000;
    if (gap <= 1) run++;
    else if (gap >= 3 && i > 5) run = 1;   // 折れた（お守りでも救えない穴）
    else run = 1;
    if (run >= 30 && i > 30) {
      // 折れた実績が手前にあるか
      for (let j = 1; j <= i - run + 1; j++) {
        const g = (Date.parse(recordedSorted[j]) - Date.parse(recordedSorted[j - 1])) / 86400000;
        if (g >= 3) return true;
      }
    }
  }
  return false;
}

// ===== バッジ定義 =====
// 条件は可能な限り宣言的DSL（when）で書く。ここでDSLを使うのは、リモート配信のバッジと
// 同じ評価器（evaluateDeclarativeBadge）を同梱バッジでも通す＝評価器が本番で毎日検証されるため。
const ge = (metric: BadgeCondition['metric'], value: number): BadgeCondition[] => [{ metric, op: '>=', value }];

function bundledBadgeDefs(): Badge[] {
  return [
    // 継続
    { id: 'streak3', emoji: '🔥', name: t('種火'), desc: t('3日連続で記録する'), cat: 'streak', when: ge('streak', 3) },
    { id: 'streak7', emoji: '🔥', name: t('焚き火'), desc: t('7日連続で記録する'), cat: 'streak', when: ge('streak', 7) },
    { id: 'streak14', emoji: '🔥', name: t('かがり火'), desc: t('14日連続で記録する'), cat: 'streak', when: ge('streak', 14) },
    { id: 'streak30', emoji: '🕯️', name: t('松明'), desc: t('30日連続で記録する'), cat: 'streak', when: ge('streak', 30) },
    { id: 'streak60', emoji: '🏮', name: t('篝火の主'), desc: t('60日連続で記録する'), cat: 'streak', when: ge('streak', 60) },
    { id: 'streak100', emoji: '🌋', name: t('百日行'), desc: t('100日連続で記録する'), cat: 'streak', when: ge('streak', 100) },
    // 以下3つはDSLで書けない（履歴の形・週の構造・自己契約の有無）ためコード判定
    { id: 'phoenix', emoji: '🐦‍🔥', name: t('不死鳥'), desc: t('途切れたあと、もう一度30日つなぐ'), cat: 'streak' },
    { id: 'weekend4', emoji: '📅', name: t('週末も欠かさず'), desc: t('土日を含む週を4週連続で記録する'), cat: 'streak' },
    { id: 'week_promise', emoji: '🤝', name: t('週の約束'), desc: t('自分で決めた週目標を4週連続で守った'), cat: 'streak' },
    { id: 'morning14', emoji: '🌅', name: t('朝型'), desc: t('朝（10時まで）の記録を累計14日'), cat: 'streak', when: ge('morningDays', 14) },
    // 記録（アプリを使いこなす行動）
    { id: 'photo1', emoji: '📸', name: t('はじめての写真解析'), desc: t('写真から食事を解析する'), cat: 'action', when: ge('photoCount', 1) },
    { id: 'photo30', emoji: '🎞️', name: t('カメラの達人'), desc: t('写真解析を累計30枚'), cat: 'action', when: ge('photoCount', 30) },
    { id: 'coach10', emoji: '💬', name: t('相談上手'), desc: t('AI相談を累計10往復'), cat: 'action', when: ge('coachCount', 10) },
    { id: 'coach100', emoji: '🧠', name: t('AIの相棒'), desc: t('AI相談を累計100往復'), cat: 'action', when: ge('coachCount', 100) },
    { id: 'myfood5', emoji: '🥣', name: t('マイ食品コレクター'), desc: t('マイ食品を5個登録する'), cat: 'action', when: ge('myFoodCount', 5) },
    { id: 'myfood20', emoji: '📚', name: t('自分だけの食品辞典'), desc: t('マイ食品を20個登録する'), cat: 'action', when: ge('myFoodCount', 20) },
    // 同日一致・7日連続の複合条件はコード判定
    { id: 'fullday', emoji: '💯', name: t('全部入りの一日'), desc: t('食事・運動・体重を同じ日に記録する'), cat: 'action' },
    { id: 'rest50', emoji: '⏱️', name: t('ジムの相棒'), desc: t('レストタイマーを累計50回使う'), cat: 'action', when: ge('restCount', 50) },
    { id: 'nolate7', emoji: '🌙', name: t('深夜ゼロ週間'), desc: t('21時以降の食事なしで7日間記録する'), cat: 'action' },
    // 体重
    { id: 'lost1', emoji: '⚖️', name: t('最初の1kg'), desc: t('開始時から体重-1kg'), cat: 'body', when: ge('weightLossKg', 1) },
    { id: 'lost3', emoji: '🏅', name: t('-3kg'), desc: t('開始時から体重-3kg'), cat: 'body', when: ge('weightLossKg', 3) },
    { id: 'lost5', emoji: '🏆', name: t('-5kg'), desc: t('開始時から体重-5kg'), cat: 'body', when: ge('weightLossKg', 5) },
    // 目標系は「目標体重が設定されているか」という前提条件を持つためコード判定
    { id: 'goal50', emoji: '⛰️', name: t('五合目'), desc: t('目標体重までの道のりの半分を越える'), cat: 'body' },
    { id: 'goal100', emoji: '🚩', name: t('登頂'), desc: t('目標体重に到達する'), cat: 'body' },
    // 運動
    { id: 'vol10t', emoji: '🐘', name: t('月間10トン'), desc: t('挙上ボリューム（重量×回数）が月間10t'), cat: 'move', when: ge('liftVolumeMonthKg', 10000) },
    { id: 'vol20t', emoji: '🦏', name: t('月間20トン'), desc: t('挙上ボリュームが月間20t'), cat: 'move', when: ge('liftVolumeMonthKg', 20000) },
    { id: 'km50', emoji: '🏃', name: t('月間50km'), desc: t('有酸素の距離が月間50km'), cat: 'move', when: ge('cardioKmMonth', 50) },
    { id: 'km100', emoji: '🛣️', name: t('月間100km'), desc: t('有酸素の距離が月間100km'), cat: 'move', when: ge('cardioKmMonth', 100) },
    { id: 'burn5000', emoji: '🔋', name: t('週5,000kcal'), desc: t('運動の消費が週に5,000kcal'), cat: 'move', when: ge('burnKcalWeek', 5000) },
    { id: 'pr5', emoji: '📈', name: t('記録更新×5'), desc: t('自己ベストを5回更新する'), cat: 'move', when: ge('prCount', 5) },
  ];
}

/** リモート定義（多言語オブジェクト）→ 表示言語で解決した Badge */
export function badgeFromRemote(r: RemoteBadge): Badge {
  return {
    id: r.id,
    emoji: r.emoji ?? '🏅',
    name: pickL10n(r.name),
    desc: pickL10n(r.desc),
    cat: r.cat,
    when: Array.isArray(r.when) ? r.when : [r.when],
    icon: r.icon,
    remote: true,
  };
}

/**
 * 表示・評価に使うバッジ定義＝同梱＋リモート（idで統合。同idはリモートが上書き＝文言差し替え、
 * 新idは末尾に追加）。文言は表示のたびに現在の言語で組み直す
 */
export function badgeDefs(): Badge[] {
  const remote = getRemoteContent().badges;
  if (remote.length === 0) return bundledBadgeDefs();
  return mergeById(bundledBadgeDefs(), remote.map(badgeFromRemote));
}

// id→カテゴリの対応（メダルの色相に使う。翻訳を伴わないので一度作れば使い回せる。
// リモート定義が届いて集合が変わったら作り直す）
let catCache: Record<string, BadgeCat> | null = null;
// モジュール評価時に走る唯一の副作用。ここが throw すると achievements.ts を import した
// 画面が丸ごと読み込めず、ErrorBoundaryより手前で落ちる（Androidの起動クラッシュ調査で
// 「トップレベル副作用は全部包む」と決めた・docs/ANDROID.md）。購読が張れなくても
// 失うのは「リモート定義が届いたときのキャッシュ破棄」だけで、バッジ自体は同梱定義で出る
try {
  onRemoteContentChange(() => { catCache = null; });
} catch { /* 購読できなくても同梱定義でバッジは出る */ }
export function badgeCatOf(id: string): BadgeCat {
  if (!catCache) {
    catCache = {};
    for (const b of badgeDefs()) catCache[b.id] = b.cat;
  }
  return catCache[id] ?? 'action';
}

/** id→定義（帯や通知で名前を引くため。表示のたびに現在の言語で組み直す） */
export function badgeById(id: string): Badge | undefined {
  return badgeDefs().find((b) => b.id === id);
}

// ===== 獲得の確定と「遡及通知」 =====

export type BadgeUnlock = {
  id: string;
  retro: boolean;   // true=あとから定義が増えたバッジを、過去の記録で遡って獲得した
};

export type BadgeUnlockInput = {
  defIds: string[];                    // 現在のバッジ定義id（定義順）
  ok: Record<string, boolean>;         // 今回の判定結果
  earned: Record<string, string>;      // 既存の獲得日（id→YYYY-MM-DD）
  seen: string[] | null;               // 評価済みid集合。null=このキーがまだ無い
  today: string;
};

export type BadgeUnlockPlan = {
  earned: Record<string, string>;      // 保存すべき獲得日
  seen: string[];                      // 保存すべき評価済みid集合
  unlocks: BadgeUnlock[];              // 祝祭・帯・未読に出すもの
  silent: string[];                    // 静かに獲得したもの（通知しない）
  firstEver: boolean;                  // この端末で初めての評価だったか
};

/**
 * 「いま条件を満たしたバッジ」のうち、どれを通知するかを決める純関数。
 *
 * 解きたい問題:
 *  ①あとからバッジ定義を増やしたとき、既存ユーザーの過去の記録で条件を満たしているものは
 *   「静かに獲得済みになる」だけで、獲得に気づけない（＝バッジが機能していない原因のひとつ）。
 *  ②一方で、機種変更や再インストール直後は「1年ぶんの記録」に対して30個が一斉に成立する。
 *   ここで全部を祝うと祝祭がノイズになり、体験としては何も祝っていないのと同じになる。
 *
 * 設計:
 *  ・SEEN_DEFS_KEY に「この端末で一度でも評価したバッジidの集合」を持つ。
 *  ・**この端末で初めて実績を評価した瞬間だけ**（seenキーが無く、かつ獲得履歴も空）、
 *   条件を満たすものを silent として静かに確定する（＝再インストール時の暴発をここで止める）。
 *  ・2回目以降は、条件成立を通常どおり通知する。そのうち
 *   「seenに無いid＝このアップデートで増えた定義」は retro=true として区別し、
 *   まとめ文（「3つのバッジを獲得しました」）で見せる。
 *  ・seenは定義から消えたidも残す（消して再登場したときに遡及通知が再発しないため）。
 *
 * 注意: 既存ユーザーの初回移行（seen=null・earnedあり）はfirstEverにしない。
 * 獲得履歴があるなら「この端末で評価済み」であり、そこで黙らせると本物の獲得を1回取り落とす。
 */
export function planBadgeUnlocks(input: BadgeUnlockInput): BadgeUnlockPlan {
  const { defIds, ok, seen, today } = input;
  const earned: Record<string, string> = { ...input.earned };
  const firstEver = seen == null && Object.keys(earned).length === 0;
  const seenSet = new Set(seen ?? []);
  const unlocks: BadgeUnlock[] = [];
  const silent: string[] = [];

  for (const id of defIds) {
    if (earned[id]) continue;          // 既に獲得済み（条件から外れても消さない）
    if (!ok[id]) continue;             // まだ条件を満たしていない
    earned[id] = today;                // 獲得日は初回のみ記録
    if (firstEver) { silent.push(id); continue; }
    // seenキーがある＝定義集合を記録済み。そこに無いidは「あとから増えた定義」＝遡及獲得
    unlocks.push({ id, retro: seen != null && !seenSet.has(id) });
  }

  // 評価済み集合を更新（既知のid＋今回の定義id。順序は既知→定義順で安定させる）
  const seenNext = [...(seen ?? [])];
  for (const id of defIds) if (!seenSet.has(id)) seenNext.push(id);

  return { earned, seen: seenNext, unlocks, silent, firstEver };
}

// ===== 未読バッジ（気づける導線） =====
// unseen=実績ページを開くまで残る未読数（🔥チップと設定の実績行の赤ドット）
// banner=食事タブの帯（一度きり。×またはタップで消化）

async function readIds(key: string): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(key);
    const arr = JSON.parse(raw || '[]');
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
}

/** 未読バッジ数（0なら何も出さない） */
export async function unseenBadgeCount(): Promise<number> {
  return (await readIds(UNSEEN_KEY)).length;
}

/** 実績ページを見たら未読を消す（帯も同時に消化する＝二重に知らせない） */
export async function markBadgesSeen(): Promise<void> {
  try { await AsyncStorage.multiRemove([UNSEEN_KEY, BANNER_KEY]); } catch { /* 次回また消す */ }
}

/** 食事タブの帯に出す獲得id（未消化のもの） */
export async function peekBadgeBanner(): Promise<string[]> {
  return readIds(BANNER_KEY);
}

/** 帯を消化する（タップ／×で呼ぶ。未読ドットは実績ページを開くまで残す） */
export async function consumeBadgeBanner(): Promise<void> {
  try { await AsyncStorage.removeItem(BANNER_KEY); } catch { /* 次回また消す */ }
}

export async function bumpRestCount(): Promise<void> {
  try {
    const n = Number(await AsyncStorage.getItem(REST_COUNT_KEY)) || 0;
    await AsyncStorage.setItem(REST_COUNT_KEY, String(n + 1));
  } catch { /* 実績が遅れるだけ */ }
}

export type AchievementReport = {
  streak: number;
  usedFreeze: string | null;
  // 通算の記録日数と目標到達。★レビュー依頼の判定（lib/reviewPrompt.ts）が使う材料でもある
  recordedDays: number;
  goalReached: boolean;
  // ソフト週目標の進捗（実績ページの「今週」ブロック用）。
  // goal=自己契約の日数（未設定は7=毎日）、days=月〜日の記録有無
  week: { goal: number; count: number; days: boolean[]; todayIdx: number };
  badges: BadgeState[];
  newIds: string[];    // 今回の評価で新たに獲得し、通知（祝祭）に出すもの
  retroIds: string[];  // そのうち「あとから増えた定義」を過去の記録で獲得したもの
  // 「いつでも共有」用の素材（実績ページの共有ハブが使う）
  share: {
    today: { kcal: number; p: number; f: number; c: number } | null;
    workout: { label: string; kcal: number; minutes: number; km: number | null } | null;
    pr: { name: string; kg: number; date: string } | null;
  };
};

// 同時評価の抑止。実績ページ・🔥チップ・食事タブの帯が同じ瞬間に評価を始めても
// クエリは1回で済ませる（未読・帯の二重登録も防ぐ）
let evalInFlight: Promise<AchievementReport> | null = null;
let lastEvalAt = 0;
const EVAL_MIN_INTERVAL = 10 * 60_000;   // 画面に入るたびに数クエリ投げないための間隔

/** 全バッジを評価し、新規獲得を永続化して返す（同時呼び出しは1回にまとめる） */
export function evaluateAchievements(): Promise<AchievementReport> {
  if (evalInFlight) return evalInFlight;
  const p = runEvaluate();
  evalInFlight = p;
  p.then(() => { /* 成功時のみ間隔を更新（失敗は次の機会に再挑戦させる） */ lastEvalAt = Date.now(); })
    .catch(() => {})
    .finally(() => { if (evalInFlight === p) evalInFlight = null; });
  return p;
}

/**
 * 「気づける導線」用の軽い入口。評価が走っていればそれを待ち、
 * 直近に評価済みなら何もしない（force=保存直後など、確実に見たいとき）。
 */
export async function maybeEvaluateBadges(force = false): Promise<void> {
  if (evalInFlight) { await evalInFlight.catch(() => {}); return; }
  if (!force && Date.now() - lastEvalAt < EVAL_MIN_INTERVAL) return;
  try { await evaluateAchievements(); } catch { /* 導線が出ないだけ */ }
}

async function runEvaluate(): Promise<AchievementReport> {
  const today = todayJST();
  const from400 = shiftDate(today, -400);

  const [entriesRes, logsRes, foodsRes, usageRes, goalRes, restRaw, earnedRaw, weekGoalRaw, seenRaw] = await Promise.all([
    supabase.from('entries').select('date,intake,weight,p,f,c').gte('date', from400).order('date', { ascending: true }).limit(1000),
    supabase.from('logs').select('date,at,text,adj,ex_km,ex_minutes').gte('date', from400).order('date', { ascending: true }).limit(2000),
    supabase.from('my_foods').select('id').limit(50),
    supabase.from('ai_usage').select('photo_count,coach_count').limit(1000),
    supabase.from('goals').select('target_weight,start_weight').maybeSingle(),
    AsyncStorage.getItem(REST_COUNT_KEY),
    AsyncStorage.getItem(EARNED_KEY),
    AsyncStorage.getItem(WEEK_GOAL_KEY),
    AsyncStorage.getItem(SEEN_DEFS_KEY),
  ]);
  const entries = (entriesRes.data ?? []) as { date: string; intake: number | null; weight: number | null; p?: number | null; f?: number | null; c?: number | null }[];
  const logs = (logsRes.data ?? []) as { date: string; at: string | null; text: string; adj: number | null; ex_km: number | null; ex_minutes: number | null }[];
  const foodsN = (foodsRes.data ?? []).length;
  const photoN = (usageRes.data ?? []).reduce((a, r) => a + (Number((r as { photo_count?: number }).photo_count) || 0), 0);
  const coachN = (usageRes.data ?? []).reduce((a, r) => a + (Number((r as { coach_count?: number }).coach_count) || 0), 0);
  const restN = Number(restRaw) || 0;

  // 記録がある日（食事 or 体重 or 運動、どれかを書いた日）
  const recorded = new Set<string>();
  for (const e of entries) if (e.intake != null || e.weight != null) recorded.add(e.date);
  for (const r of logs) recorded.add(r.date);
  const recordedSorted = [...recorded].sort();

  const { days: streak, usedFreeze } = calcStreak(recorded, today);

  // ソフト週目標（未設定は7=毎日と同じ意味。壊れた値も7に倒す）
  const weekGoal = ['3', '4', '5', '7'].includes(weekGoalRaw ?? '') ? Number(weekGoalRaw) : 7;
  const week = { goal: weekGoal, ...calcWeekProgress(recorded, today) };

  // 週末も欠かさず（直近4週）
  let weekend4 = true;
  for (let w = 0; w < 4; w++) {
    const base = shiftDate(weekKey(today), -7 * (w + 1)); // 先週から遡る（今週は進行中）
    const sat = shiftDate(base, 5), sun = shiftDate(base, 6);
    if (!recorded.has(sat) || !recorded.has(sun)) { weekend4 = false; break; }
  }
  // 朝型（10時までの記録がある日 累計14日）
  const morningDays = new Set(logs.filter((r) => r.at && new Date(r.at).getHours() < 10).map((r) => r.date)).size;
  // 全部入りの一日
  const exDays = new Set(logs.filter((r) => r.text.startsWith('🏋️') || r.text.startsWith('🏃')).map((r) => r.date));
  const fullday = entries.some((e) => e.intake != null && e.weight != null && exDays.has(e.date));
  // 深夜ゼロ週間: 直近7日すべて記録があり、21時以降の食事記録がない
  const last7 = Array.from({ length: 7 }, (_, i) => shiftDate(today, -i - 1));
  const lateDays = new Set(logs.filter((r) => r.at && new Date(r.at).getHours() >= 21 && !r.text.startsWith('🏋️') && !r.text.startsWith('🏃')).map((r) => r.date));
  const nolate7 = last7.every((d) => recorded.has(d) && !lateDays.has(d));

  // 体重系
  const weights = entries.filter((e) => e.weight != null).map((e) => ({ date: e.date, w: Number(e.weight) }));
  const startW = weights[0]?.w ?? null;
  const minW = weights.length ? Math.min(...weights.map((x) => x.w)) : null;
  const lost = startW != null && minW != null ? startW - minW : 0;
  const target = goalRes.data?.target_weight != null ? Number(goalRes.data.target_weight) : null;
  const gStart = goalRes.data?.start_weight != null ? Number(goalRes.data.start_weight) : startW;
  const goalHalf = target != null && gStart != null && minW != null && gStart > target
    ? minW <= gStart - (gStart - target) / 2 : false;
  const goalDone = target != null && minW != null ? minW <= target : false;

  // 筋トレボリューム（月別）と自己ベスト更新回数
  const wLookup = weightLookup(weights.map((x) => ({ date: x.date, weight: x.w })));
  const volByMonth = new Map<string, number>();
  const bestSoFar = new Map<string, { kg: number; date: string }>();
  let prCount = 0;
  for (const r of logs) {
    if (!r.text.startsWith('🏋️')) continue;
    for (const e2 of parseLiftText(r.text)) {
      const kg = effectiveKg(e2, wLookup(r.date));
      volByMonth.set(r.date.slice(0, 7), (volByMonth.get(r.date.slice(0, 7)) ?? 0) + kg * e2.reps * e2.sets);
      const prev = bestSoFar.get(e2.name)?.kg ?? 0;
      if (kg > prev) { bestSoFar.set(e2.name, { kg, date: r.date }); if (prev > 0) prCount++; }
    }
  }
  const maxVol = Math.max(0, ...volByMonth.values());
  // 有酸素の月間km・週間消費kcal
  const kmByMonth = new Map<string, number>();
  const kcalByWeek = new Map<string, number>();
  for (const r of logs) {
    if (r.ex_km != null) kmByMonth.set(r.date.slice(0, 7), (kmByMonth.get(r.date.slice(0, 7)) ?? 0) + Number(r.ex_km));
    if ((r.text.startsWith('🏃') || r.text.startsWith('🏋️')) && r.adj != null && Number(r.adj) > 0) {
      const wk = weekKey(r.date);
      kcalByWeek.set(wk, (kcalByWeek.get(wk) ?? 0) + Number(r.adj));
    }
  }
  const maxKm = Math.max(0, ...kmByMonth.values());
  const maxWeekKcal = Math.max(0, ...kcalByWeek.values());

  // ===== 判定 =====
  // ①DSLで書ける条件は、メトリクスに数値を並べて evaluateDeclarativeBadge に任せる
  //   （リモートで増えたバッジも同じ経路で判定される＝コード追加なしで新バッジが機能する）
  const metrics: BadgeMetrics = {
    streak, recordedDays: recorded.size, morningDays,
    photoCount: photoN, coachCount: coachN, myFoodCount: foodsN, restCount: restN,
    weightLossKg: lost, liftVolumeMonthKg: maxVol, cardioKmMonth: maxKm, burnKcalWeek: maxWeekKcal,
    prCount, weekCount: week.count,
  };
  // ②DSLで書けない条件だけコードで判定する
  const codeOk: Record<string, boolean> = {
    phoenix: hadComeback(recordedSorted, today),
    weekend4,
    // 週の約束: 自分で週目標を設定した状態でだけ判定する（未設定=契約していない）
    week_promise: weekGoalRaw != null && weekPromiseOk(recorded, today, weekGoal),
    fullday, nolate7,
    goal50: goalHalf, goal100: goalDone,
  };
  const defs = badgeDefs();
  const ok: Record<string, boolean> = {};
  for (const b of defs) ok[b.id] = b.when ? evaluateDeclarativeBadge(b, metrics) : (codeOk[b.id] ?? false);

  // ===== 獲得の確定（通知するか静かに確定するかは planBadgeUnlocks が決める） =====
  let earnedPrev: Record<string, string> = {};
  try { earnedPrev = JSON.parse(earnedRaw || '{}'); } catch { /* 壊れていたら作り直す */ }
  let seenPrev: string[] | null = null;
  if (seenRaw != null) {
    try {
      const arr = JSON.parse(seenRaw);
      seenPrev = Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
    } catch { seenPrev = []; }
  }
  // リモートで増えた定義もdefsに含まれるので、seen集合に無いid＝遡及通知（retro）がそのまま働く
  const plan = planBadgeUnlocks({ defIds: defs.map((b) => b.id), ok, earned: earnedPrev, seen: seenPrev, today });
  const newIds = plan.unlocks.map((u) => u.id);
  const retroIds = plan.unlocks.filter((u) => u.retro).map((u) => u.id);

  try {
    const writes: [string, string][] = [];
    if (plan.unlocks.length > 0 || plan.silent.length > 0) writes.push([EARNED_KEY, JSON.stringify(plan.earned)]);
    if (seenRaw == null || plan.seen.length !== (seenPrev?.length ?? 0)) writes.push([SEEN_DEFS_KEY, JSON.stringify(plan.seen)]);
    if (newIds.length > 0) {
      // 未読・帯は積む（前回ぶんを見ていないうちに次を獲得しても取りこぼさない）
      const unseen = [...new Set([...(await readIds(UNSEEN_KEY)), ...newIds])];
      const banner = [...new Set([...(await readIds(BANNER_KEY)), ...newIds])];
      writes.push([UNSEEN_KEY, JSON.stringify(unseen)], [BANNER_KEY, JSON.stringify(banner)]);
    }
    if (writes.length > 0) await AsyncStorage.multiSet(writes);
  } catch { /* 次回また拾う */ }

  const earned = plan.earned;
  const badges: BadgeState[] = defs.map((b) => ({ ...b, earnedOn: earned[b.id] ?? null }));

  // ===== 「いつでも共有」用の素材 =====
  const todayEntry = entries.find((e) => e.date === today && e.intake != null);
  const lastWorkout = [...logs].reverse().find((r) => r.text.startsWith('🏃') || r.text.startsWith('🏋️')) ?? null;
  const wkKcal = lastWorkout
    ? (lastWorkout.adj != null && Number(lastWorkout.adj) > 0
      ? Math.round(Number(lastWorkout.adj))
      : Number(lastWorkout.text.match(/約([\d,]+)kcal/)?.[1]?.replace(/,/g, '') ?? 0))
    : 0;
  const wkMin = lastWorkout
    ? (lastWorkout.ex_minutes != null ? Number(lastWorkout.ex_minutes) : Number(lastWorkout.text.match(/(\d+)分/)?.[1] ?? 0))
    : 0;
  const prTop = [...bestSoFar.entries()].sort((a, b) => b[1].kg - a[1].kg)[0] ?? null;
  const share: AchievementReport['share'] = {
    today: todayEntry ? {
      kcal: Math.round(Number(todayEntry.intake)),
      p: Number(todayEntry.p) || 0, f: Number(todayEntry.f) || 0, c: Number(todayEntry.c) || 0,
    } : null,
    workout: lastWorkout ? {
      label: lastWorkout.text.replace(/^(🏋️|🏃)️?\s*/u, '').split(/[（(【]/)[0].trim().slice(0, 22) || t('ワークアウト'),
      kcal: wkKcal, minutes: wkMin,
      km: lastWorkout.ex_km != null ? Number(lastWorkout.ex_km) : null,
    } : null,
    pr: prTop ? { name: prTop[0], kg: Math.round(prTop[1].kg), date: prTop[1].date } : null,
  };

  return { streak, usedFreeze, recordedDays: recorded.size, goalReached: goalDone, week, badges, newIds, retroIds, share };
}

// ===== 軽量ストリーク（食事タブの🔥チップ用。日付列だけの2クエリ＋5分キャッシュ） =====
let streakCache: { at: number; days: number } | null = null;
export async function quickStreak(): Promise<number> {
  if (streakCache && Date.now() - streakCache.at < 5 * 60_000) return streakCache.days;
  const today = todayJST();
  const from = shiftDate(today, -400);
  const [e, l] = await Promise.all([
    supabase.from('entries').select('date').gte('date', from).limit(1000),
    supabase.from('logs').select('date').gte('date', from).limit(2000),
  ]);
  const recorded = new Set<string>([
    ...((e.data ?? []) as { date: string }[]).map((r) => r.date),
    ...((l.data ?? []) as { date: string }[]).map((r) => r.date),
  ]);
  const { days } = calcStreak(recorded, today);
  streakCache = { at: Date.now(), days };
  return days;
}
/** 保存直後などにキャッシュを無効化して最新の🔥を出す */
export function invalidateStreak(): void { streakCache = null; }
