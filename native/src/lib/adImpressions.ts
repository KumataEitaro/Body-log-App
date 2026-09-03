// 広告インプレッション（見た回数）と「広告なしで使えます」の提示回数の保存。
// 数え方・判定は lib/ads.ts（純関数）で、ここは AsyncStorage の読み書きだけ。
//
// なぜ回数を数えるのか: ペイウォールで「この1週間で広告を{n}回見ています。スタンダードなら
// 0回です。」と**事実だけ**を示すため。煽り文句のかわりに自分の数字を見せる方が、
// 静かで、かつ「広告なし」の価値が具体的に伝わる（docs/ADS.md「広告→課金の導線」）。
//
// 端末内だけに置く（サーバーへ送らない）。広告の見え方は端末とプランで決まるので
// サーバーに集約する必要が無く、送らなければプライバシー上の説明も要らない。
import AsyncStorage from '@react-native-async-storage/async-storage';
import { todayJST } from './calc';
import {
  AD_IMPRESSION_MIN_GAP_MS,
  AD_IMPRESSION_STORE_KEY,
  AD_PITCH_STORE_KEY,
  bumpDayCount,
  bumpImpression,
  dayCountOf,
  parseDayCount,
  parseImpressions,
  weeklyImpressions,
  type AdPlacement,
} from './ads';

// 枠ごとの最終カウント時刻（プロセス内のみ）。タブ往復や再レイアウトで onAdLoaded が
// 短時間に何度も来ても二重に数えない＝ユーザーに見せる数字を水増ししない
const lastCounted = new Map<string, number>();

/**
 * 広告が1枚表示されたことを記録する（バナーの読み込み成功・全画面広告の表示）。
 * 失敗しても throw しない（広告の記録のために画面を止めない）。
 * source は枠の識別子（バナーは placement、全画面は 'interstitial'）。
 */
export async function recordAdImpression(source: AdPlacement | 'interstitial'): Promise<void> {
  const now = Date.now();
  const last = lastCounted.get(source) ?? 0;
  if (now - last < AD_IMPRESSION_MIN_GAP_MS) return; // 同じ枠の短時間の重複は数えない
  lastCounted.set(source, now);
  try {
    const rows = parseImpressions(await AsyncStorage.getItem(AD_IMPRESSION_STORE_KEY));
    const next = bumpImpression(rows, todayJST());
    await AsyncStorage.setItem(AD_IMPRESSION_STORE_KEY, JSON.stringify(next));
  } catch { /* 数えられなくても表示は済んでいる */ }
}

/** 直近1週間の広告表示回数（読めなければ0＝回数行を出さない側に倒す） */
export async function readWeeklyImpressions(): Promise<number> {
  try {
    const rows = parseImpressions(await AsyncStorage.getItem(AD_IMPRESSION_STORE_KEY));
    return weeklyImpressions(rows, todayJST());
  } catch {
    return 0;
  }
}

/** 今日すでに「広告なしで使えます」を出した回数（読めなければ上限扱い＝出さない側に倒す） */
export async function readPitchShownToday(): Promise<number> {
  try {
    return dayCountOf(parseDayCount(await AsyncStorage.getItem(AD_PITCH_STORE_KEY)), todayJST());
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

/** 「広告なしで使えます」を出したことを記録する */
export async function recordPitchShown(): Promise<void> {
  try {
    const prev = parseDayCount(await AsyncStorage.getItem(AD_PITCH_STORE_KEY));
    await AsyncStorage.setItem(AD_PITCH_STORE_KEY, JSON.stringify(bumpDayCount(prev, todayJST())));
  } catch { /* 記録できなければ次回また出る（上限が甘くなるだけ） */ }
}

/** テスト用: 二重カウント抑止のプロセス内キャッシュを空にする */
export function __resetImpressionGuardForTest(): void {
  lastCounted.clear();
}
