// インタースティシャル広告（全画面）のネイティブ側。判定は lib/interstitial.ts（純関数）で、
// ここは「事前ロード」「表示」「履歴の読み書き」だけを担う薄い層。
//
// 使い方（概要タブ）:
//   const interstitial = useInterstitial();
//   ... ドリルダウンの瞬間: setDetailKey(key) の**あと**に interstitial.maybeShow(key)
//
// 設計の要点:
//  - **遷移は必ず先に進む**。maybeShow は同期的に「出す／出さない」を決め、出さないときは
//    何もしない（await しない・ロードを待たない）。広告が無ければ何も起きなかったのと同じ挙動
//  - 事前ロードはタブのマウント時に1回だけ（＝ユーザーが概要タブを開いた時点で仕込む）。
//    表示の瞬間にロードを始める設計だと、必ず「間に合わない」か「待たせる」のどちらかになる
//  - 実ユニットIDが未設定なら**作らない**（＝出ない）。テストIDは __DEV__ のときだけ使う。
//    リリースビルドでテストIDを踏むと在庫はあるが収益は0で、しかも無効トラフィック扱いになる
//  - 同一セッション1回が上限なので、表示後に次を再ロードしない（無駄なリクエストを投げない）
//  - Expo Go・モジュール未リンク環境では ads=null で全て no-op（AdBannerView と同じ流儀）
import { useCallback, useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useGate } from './gate';
import { shouldShowAd } from './ads';
import { todayJST } from './calc';
import {
  INTERSTITIAL_STORE_KEY,
  canShowInterstitial,
  isInterstitialTarget,
  parseInterstitialHistory,
  recordInterstitialShown,
  todayInterstitialCount,
  type InterstitialHistory,
} from './interstitial';

type AdsModule = typeof import('react-native-google-mobile-ads');
// InterstitialAd のコンストラクタは protected（生成は createForAdRequest 経由）なので
// InstanceType ではなく戻り値の型を使う
type InterstitialInstance = ReturnType<AdsModule['InterstitialAd']['createForAdRequest']>;

const ads: AdsModule | null = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('react-native-google-mobile-ads') as AdsModule;
  } catch {
    return null; // Expo Go等・モジュール未リンク
  }
})();

// アプリ起動時刻。このモジュールが最初に import された時刻＝実質のプロセス起動時刻。
// 「起動から30秒は全画面を出さない」の基準（lib/interstitial.ts INTERSTITIAL_WARMUP_MS）。
const APP_STARTED_MS = Date.now();

// セッション（プロセス）内で1回出したか。モジュールスコープなので、タブを離れて戻っても、
// 別の画面から来ても共有される＝「概要タブを再マウントすれば また出る」抜け道を作らない。
let sessionShown = false;

/**
 * インタースティシャルのユニットID。
 * 実IDが無いので **環境変数が未設定なら null（＝出さない）**。
 * `EXPO_PUBLIC_ADMOB_INTERSTITIAL_IOS` / `EXPO_PUBLIC_ADMOB_INTERSTITIAL_ANDROID` を
 * Codemagic の環境変数に入れて再ビルドすると点灯する（取得手順は docs/ADS.md）。
 * __DEV__ では Google 公式のテストIDを使い、開発中の自己表示を実ユニットに当てない。
 */
export function interstitialUnitId(m: AdsModule): string | null {
  if (__DEV__) return m.TestIds.INTERSTITIAL;
  const env = Platform.OS === 'ios'
    ? process.env.EXPO_PUBLIC_ADMOB_INTERSTITIAL_IOS
    : process.env.EXPO_PUBLIC_ADMOB_INTERSTITIAL_ANDROID;
  return env && env.length > 0 ? env : null;
}

/** 履歴の読み込み（壊れた値・未保存は「未表示」扱い。失敗しても throw しない） */
export async function loadInterstitialHistory(): Promise<InterstitialHistory> {
  try {
    return parseInterstitialHistory(await AsyncStorage.getItem(INTERSTITIAL_STORE_KEY));
  } catch {
    return parseInterstitialHistory(null);
  }
}

/** 履歴の保存（失敗は黙って捨てる＝広告のためにユーザー操作を止めない） */
async function saveInterstitialHistory(h: InterstitialHistory): Promise<void> {
  try {
    await AsyncStorage.setItem(INTERSTITIAL_STORE_KEY, JSON.stringify(h));
  } catch { /* 保存できなくても表示は済んでいる。次回の判定が甘くなるだけ */ }
}

export type Interstitial = {
  /**
   * 概要タブのドリルダウンの瞬間に呼ぶ。**呼び出し側の遷移はすでに始めておくこと**
   * （この関数は遷移を待たせない・何も返さない）。
   * 対象キーでない／条件を満たさない／未ロードのときは何もしない。
   */
  maybeShow: (detailKey: string) => void;
};

/**
 * 概要タブ用のインタースティシャル。マウント時に事前ロードし、
 * ドリルダウンの瞬間に条件がそろっていれば全画面を出す。
 */
export function useInterstitial(): Interstitial {
  const { active, plan } = useGate();
  const eligible = !!ads && shouldShowAd(active, plan);

  const adRef = useRef<InterstitialInstance | null>(null);
  const loadedRef = useRef(false);
  // 履歴は「読めるまで出さない」（未読込＝null）。起動直後に判定を通してしまわない防御でもある
  const historyRef = useRef<InterstitialHistory | null>(null);
  // 有料化・課金完了で条件が変わったときに即座に効くよう、最新値を ref に写す
  const gateRef = useRef({ active, plan });
  gateRef.current = { active, plan };

  // 履歴の読み込み（1回・条件を満たしうる端末だけ）
  useEffect(() => {
    if (!eligible || historyRef.current) return;
    let alive = true;
    loadInterstitialHistory().then((h) => { if (alive) historyRef.current = h; }).catch(() => {});
    return () => { alive = false; };
  }, [eligible]);

  // 事前ロード（1回だけ）。セッションで既に出していれば作らない＝無駄なリクエストを投げない
  useEffect(() => {
    if (!ads || !eligible || sessionShown || adRef.current) return;
    const unitId = interstitialUnitId(ads);
    if (!unitId) return; // 実ユニット未設定（現状のリリースビルド）＝全画面広告は出ない
    const { InterstitialAd, AdEventType } = ads;
    let ad: InterstitialInstance;
    try {
      ad = InterstitialAd.createForAdRequest(unitId, { requestNonPersonalizedAdsOnly: true });
    } catch {
      return; // 生成に失敗しても画面は普通に動く
    }
    adRef.current = ad;
    const offs: (() => void)[] = [];
    offs.push(ad.addAdEventListener(AdEventType.LOADED, () => { loadedRef.current = true; }));
    // ロード失敗（在庫なし・通信断）は「出さない」だけ。リトライしない＝遷移のたびに
    // 失敗リクエストを積まない（次のセッションで自然に再挑戦される）
    offs.push(ad.addAdEventListener(AdEventType.ERROR, () => { loadedRef.current = false; }));
    // 閉じられたら二度と出さない（セッション1回）。ここで裏で何かを進めることはしない＝
    // 「閉じたら元の画面がそこにある」だけ（遷移は広告より先に完了している）
    offs.push(ad.addAdEventListener(AdEventType.CLOSED, () => { loadedRef.current = false; }));
    try { ad.load(); } catch { /* 失敗しても no-op */ }
    return () => {
      offs.forEach((off) => { try { off(); } catch { /* noop */ } });
      // インスタンス自体は破棄しない（アンマウント→再マウントでロードし直さない）。
      // ただしリスナーは外す（アンマウント後の setState 相当を起こさない）
    };
  }, [eligible]);

  const maybeShow = useCallback((detailKey: string) => {
    if (!ads) return;
    if (!isInterstitialTarget(detailKey)) return;   // 表で「出さない」と決めた行き先
    const ad = adRef.current;
    const h = historyRef.current;
    if (!ad || !h) return;                          // 未生成・履歴未読込＝出さない（安全側）
    const nowMs = Date.now();
    const g = gateRef.current;
    const ok = canShowInterstitial({
      active: g.active,
      plan: g.plan,
      nowMs,
      sessionShown,
      lastShownMs: h.lastMs,
      todayCount: todayInterstitialCount(h, todayJST()),
      appStartedMs: APP_STARTED_MS,
      adLoaded: loadedRef.current,
    });
    if (!ok) return;
    // ここから先は「出す」。show() は Promise だが await しない＝遷移も描画も待たせない
    sessionShown = true;
    loadedRef.current = false;
    const next = recordInterstitialShown(h, nowMs, todayJST());
    historyRef.current = next;
    saveInterstitialHistory(next).catch(() => {});
    try {
      const p = ad.show() as unknown;
      if (p && typeof (p as Promise<void>).catch === 'function') (p as Promise<void>).catch(() => {});
    } catch { /* 表示に失敗しても遷移は完了している */ }
  }, []);

  return { maybeShow };
}

/** テスト用: セッションフラグを戻す（実アプリでは呼ばない） */
export function __resetInterstitialSessionForTest(): void {
  sessionShown = false;
}
