// 今日のひとこと帯の中身を選ぶ。
//
// 設計（docs/design-trainer-feedback-ux.md）:
//  ・自分のデータから出た事実が最優先（他社が真似できない部分）
//  ・採点はしない。観察と次の一手だけを渡す
//  ・毎回違うものを出す（同じものが出たら二度目から見ない）
//  ・すべてローカル計算（API課金ゼロ）
import { t } from './i18n';
import type { InsightDay } from './insights';

export type BriefMood = 'normal' | 'happy' | 'notice' | 'cheer';
export type Brief = {
  mood: BriefMood;
  /** 帯に出す1行 */
  title: string;
  /** タップで展開したときの本文（次の一手を1つ添える） */
  body: string;
  kind: string;
};

const DOW = () => [t('日'), t('月'), t('火'), t('水'), t('木'), t('金'), t('土')];

/** 予備の豆知識（データが薄い日のネタ切れ防止。優先度は最下位） */
const TIPS = (): Brief[] => [
  { kind: 'tip', mood: 'normal', title: t('たんぱく質は1食にまとめるより分けるほうが効きます'), body: t('筋肉の合成スイッチは1食ごとに入ります。1日合計が同じでも、3〜4回に分けたほうが合成の回数が増えます。') },
  { kind: 'tip', mood: 'normal', title: t('体重は「7日平均」で見ると迷いません'), body: t('1日の上下は水分と食事のタイミングでほぼ説明できます。7日平均の傾きだけを見ると、判断を誤りにくくなります。') },
  { kind: 'tip', mood: 'normal', title: t('睡眠不足の翌日は食欲ホルモンが増えます'), body: t('睡眠が短い日はグレリンが増え、レプチンが減ります。眠い日に食べたくなるのは意志の問題ではありません。') },
  { kind: 'tip', mood: 'normal', title: t('野菜から食べると血糖の波がゆるやかに'), body: t('食物繊維が先に入ると糖の吸収が遅くなり、食後の眠気と空腹の反動が減ります。') },
  { kind: 'tip', mood: 'normal', title: t('筋トレ後のたんぱく質は24時間有効です'), body: t('ゴールデンタイムは30分ではありません。トレ後1日は合成感度が高いので、その日の合計を厚くすれば十分です。') },
];

/**
 * 今日の帯を選ぶ。
 * @param days 直近28日（昇順・今日を含まない）
 * @param todayDow 今日の曜日（0=日）
 * @param weights 直近の体重列（停滞の検出用・省略可）
 * @param unreadColumn 未読コラムの先頭（優先度2）
 * @param dayIndex 日替わりローテーション用（同じ候補群でも日で変える）
 */
export function buildDailyBrief(
  days: InsightDay[],
  todayDow: number,
  weights: { date: string; weight: number }[],
  unreadColumn: { title: string; minutes: number; lead: string } | null,
  dayIndex: number,
): Brief {
  const p1: Brief[] = [];

  // --- 継続（いちばん祝いやすい事実） ---
  let streak = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].intake != null) streak++;
    else break;
  }
  if (streak >= 3) {
    p1.push({
      kind: 'streak', mood: 'happy',
      title: t('{n}日連続で記録できています', { n: streak }),
      body: t('記録の継続は、それ自体が成果です。完璧な内容である必要はなく、書いてある日が多いほどAIの分析も正確になります。'),
    });
  }

  // --- 曜日の癖（食べすぎが特定の曜日に寄っている） ---
  const overs = days.filter((d) => d.diff != null && d.diff > 200);
  if (overs.length >= 3) {
    const todayOvers = overs.filter((d) => new Date(d.date + 'T00:00:00').getDay() === todayDow).length;
    const share = todayOvers / overs.length;
    if (share >= 0.5) {
      p1.push({
        kind: 'dow', mood: 'notice',
        title: t('食べすぎの{p}%が{d}曜日。今日は{d}曜日です', { p: Math.round(share * 100), d: DOW()[todayDow] }),
        body: t('責める話ではなく、備えの話です。たんぱく質を先に厚めに摂っておくと、夜の食欲の波が小さくなります。'),
      });
    }
  }

  // --- 停滞（3週間横ばい） ---
  if (weights.length >= 6) {
    const threeWeeksAgo = weights.filter((w) => {
      const d = new Date(w.date + 'T00:00:00');
      return Date.now() - d.getTime() >= 18 * 86400000;
    });
    const recent = weights[weights.length - 1];
    const base = threeWeeksAgo[threeWeeksAgo.length - 1];
    if (base && Math.abs(recent.weight - base.weight) <= 0.3) {
      p1.push({
        kind: 'plateau', mood: 'cheer',
        title: t('体重は3週間ほぼ横ばい。焦る場面ではありません'),
        body: t('脂肪が減っていても、水分とグリコーゲンで隠れやすい時期があります。摂取記録が守れているなら、続けるのが正解です。'),
      });
    }
  }

  // --- 赤字の積み上げ（数字で褒める） ---
  const last7 = days.slice(-7).filter((d) => d.diff != null);
  const deficit = last7.reduce((a, d) => a + Math.min(0, d.diff!), 0);
  if (deficit <= -1500 && last7.length >= 4) {
    p1.push({
      kind: 'deficit', mood: 'happy',
      title: t('この7日で約{n}kcalの貯金ができています', { n: Math.abs(Math.round(deficit)).toLocaleString() }),
      body: t('脂肪1kgは約7,200kcal。数字はゆっくりでも、確実に進んでいます。'),
    });
  }

  // 優先1: 日替わりでローテーション（毎回同じ1本にしない）
  if (p1.length > 0) return p1[dayIndex % p1.length];

  // 優先2: 未読コラムの抜粋
  if (unreadColumn) {
    return {
      kind: 'column', mood: 'normal',
      title: t('{title}（{n}分で読めます）', { title: unreadColumn.title, n: unreadColumn.minutes }),
      body: unreadColumn.lead + t('　→ 相談タブの「読みもの」からどうぞ。'),
    };
  }

  // 優先3: 豆知識
  const tips = TIPS();
  return tips[dayIndex % tips.length];
}
