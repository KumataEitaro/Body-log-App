// インタースティシャル広告（全画面）の判定。
//
// 全画面広告は「出しすぎ」がそのままアンインストールとレビュー低下になる一方、
// 「出なさすぎ」だと無料プランの収益が立たない。どちらの事故も式のミスで起きるので、
// 各条件の境界（30秒・10分・3回）と「課金者には絶対出ない」をここで固定する。
import {
  canShowInterstitial,
  recordInterstitialShown,
  parseInterstitialHistory,
  todayInterstitialCount,
  isInterstitialTarget,
  INTERSTITIAL_TARGETS,
  INTERSTITIAL_MIN_GAP_MS,
  INTERSTITIAL_MAX_PER_DAY,
  INTERSTITIAL_WARMUP_MS,
  INTERSTITIAL_STORE_KEY,
  EMPTY_INTERSTITIAL_HISTORY,
  type InterstitialCheck,
} from '../interstitial';

// 全条件を満たす基準ケース（各テストはここから1つだけ崩す）
const T0 = 1_800_000_000_000; // 適当な epoch ms
const OK: InterstitialCheck = {
  active: true,
  plan: 'free',
  nowMs: T0,
  sessionShown: false,
  lastShownMs: 0,
  todayCount: 0,
  appStartedMs: T0 - 60_000, // 起動から1分
  adLoaded: true,
};

describe('canShowInterstitial（全条件AND）', () => {
  it('全条件を満たすときだけ出す（基準ケース）', () => {
    expect(canShowInterstitial(OK)).toBe(true);
  });

  it('課金基盤が無効なビルド（active=false）では出さない＝広告なしを売る前に全画面を見せない', () => {
    expect(canShowInterstitial({ ...OK, active: false })).toBe(false);
  });

  it('課金者（lite/standard/premium）には出さない', () => {
    expect(canShowInterstitial({ ...OK, plan: 'lite' })).toBe(false);
    expect(canShowInterstitial({ ...OK, plan: 'standard' })).toBe(false);
    expect(canShowInterstitial({ ...OK, plan: 'premium' })).toBe(false);
  });

  it('プラン未取得（null/undefined）は無料扱いで出す（バナーの shouldShowAd と同じ物差し）', () => {
    expect(canShowInterstitial({ ...OK, plan: null })).toBe(true);
    expect(canShowInterstitial({ ...OK, plan: undefined })).toBe(true);
  });

  it('未ロードなら出さない＝遷移をロード待ちでブロックしない（最重要条件）', () => {
    expect(canShowInterstitial({ ...OK, adLoaded: false })).toBe(false);
  });

  it('アプリ起動から30秒以内は出さない（境界: 29.999秒は出さない・30秒ちょうどで出す）', () => {
    expect(canShowInterstitial({ ...OK, appStartedMs: OK.nowMs - (INTERSTITIAL_WARMUP_MS - 1) })).toBe(false);
    expect(canShowInterstitial({ ...OK, appStartedMs: OK.nowMs - INTERSTITIAL_WARMUP_MS })).toBe(true);
    // 起動と同時（0秒）は当然出さない
    expect(canShowInterstitial({ ...OK, appStartedMs: OK.nowMs })).toBe(false);
  });

  it('同一セッションで2回目は出さない（sessionShown）', () => {
    expect(canShowInterstitial({ ...OK, sessionShown: true })).toBe(false);
  });

  it('前回表示から10分未満は出さない（境界: 9分59秒999は出さない・10分ちょうどで出す）', () => {
    expect(canShowInterstitial({ ...OK, lastShownMs: OK.nowMs - (INTERSTITIAL_MIN_GAP_MS - 1) })).toBe(false);
    expect(canShowInterstitial({ ...OK, lastShownMs: OK.nowMs - INTERSTITIAL_MIN_GAP_MS })).toBe(true);
  });

  it('lastShownMs=0（未表示）は間隔条件を通す＝初回が10分待ちにならない', () => {
    expect(canShowInterstitial({ ...OK, lastShownMs: 0 })).toBe(true);
  });

  it('1日3回が上限（境界: 2回目までは出す・3回目以降は出さない）', () => {
    expect(canShowInterstitial({ ...OK, todayCount: 0 })).toBe(true);
    expect(canShowInterstitial({ ...OK, todayCount: INTERSTITIAL_MAX_PER_DAY - 1 })).toBe(true);
    expect(canShowInterstitial({ ...OK, todayCount: INTERSTITIAL_MAX_PER_DAY })).toBe(false);
    expect(canShowInterstitial({ ...OK, todayCount: INTERSTITIAL_MAX_PER_DAY + 5 })).toBe(false);
  });

  it('条件が複数欠けても出さない（AND であることの確認）', () => {
    expect(canShowInterstitial({ ...OK, plan: 'standard', adLoaded: false, sessionShown: true })).toBe(false);
  });
});

describe('recordInterstitialShown（履歴の更新）', () => {
  it('同じ日の表示は count を積み、lastMs を更新する', () => {
    const h1 = recordInterstitialShown(EMPTY_INTERSTITIAL_HISTORY, T0, '2026-09-04');
    expect(h1).toEqual({ date: '2026-09-04', count: 1, lastMs: T0 });
    const h2 = recordInterstitialShown(h1, T0 + INTERSTITIAL_MIN_GAP_MS, '2026-09-04');
    expect(h2).toEqual({ date: '2026-09-04', count: 2, lastMs: T0 + INTERSTITIAL_MIN_GAP_MS });
  });

  it('日が変わったら count を1から数え直す（1日3回のリセット）', () => {
    const prev = { date: '2026-09-04', count: 3, lastMs: T0 };
    const next = recordInterstitialShown(prev, T0 + 86_400_000, '2026-09-05');
    expect(next).toEqual({ date: '2026-09-05', count: 1, lastMs: T0 + 86_400_000 });
  });

  it('3回出した直後は上限に達し、翌日には出せるようになる（結合）', () => {
    let h = EMPTY_INTERSTITIAL_HISTORY;
    let now = T0;
    for (let i = 0; i < INTERSTITIAL_MAX_PER_DAY; i++) {
      expect(canShowInterstitial({ ...OK, nowMs: now, lastShownMs: h.lastMs, todayCount: todayInterstitialCount(h, '2026-09-04') })).toBe(true);
      h = recordInterstitialShown(h, now, '2026-09-04');
      now += INTERSTITIAL_MIN_GAP_MS;
    }
    expect(canShowInterstitial({ ...OK, nowMs: now, lastShownMs: h.lastMs, todayCount: todayInterstitialCount(h, '2026-09-04') })).toBe(false);
    // 翌日（日付が変わる）→ todayInterstitialCount が0に戻るので出せる
    expect(todayInterstitialCount(h, '2026-09-05')).toBe(0);
    expect(canShowInterstitial({ ...OK, nowMs: now + 86_400_000, lastShownMs: h.lastMs, todayCount: todayInterstitialCount(h, '2026-09-05') })).toBe(true);
  });

  it('日付を渡さなければ nowMs の JST 日付で数える', () => {
    // 2026-09-04 00:00 JST = 2026-09-03 15:00 UTC
    const ms = Date.UTC(2026, 8, 3, 15, 0, 0);
    expect(recordInterstitialShown(EMPTY_INTERSTITIAL_HISTORY, ms).date).toBe('2026-09-04');
  });
});

describe('parseInterstitialHistory（壊れた値で落ちない）', () => {
  it('未保存・空文字は「未表示」', () => {
    expect(parseInterstitialHistory(null)).toEqual(EMPTY_INTERSTITIAL_HISTORY);
    expect(parseInterstitialHistory('')).toEqual(EMPTY_INTERSTITIAL_HISTORY);
    expect(parseInterstitialHistory(undefined)).toEqual(EMPTY_INTERSTITIAL_HISTORY);
  });
  it('JSONでない・型違い・負数は安全な既定値に丸める', () => {
    expect(parseInterstitialHistory('{壊れ')).toEqual(EMPTY_INTERSTITIAL_HISTORY);
    expect(parseInterstitialHistory('null')).toEqual(EMPTY_INTERSTITIAL_HISTORY);
    expect(parseInterstitialHistory('{"date":1,"count":"x","lastMs":-5}')).toEqual(EMPTY_INTERSTITIAL_HISTORY);
    expect(parseInterstitialHistory('{"date":"2026-09-04","count":2.7,"lastMs":10}')).toEqual({ date: '2026-09-04', count: 2, lastMs: 10 });
  });
  it('保存キーは bl-interstitial（他機能のキーと衝突しない）', () => {
    expect(INTERSTITIAL_STORE_KEY).toBe('bl-interstitial');
  });
});

describe('INTERSTITIAL_TARGETS（どのドリルダウンで出すか）', () => {
  it('既定で出す: body / volume / strength / week（数字の振り返り）', () => {
    expect(isInterstitialTarget('body')).toBe(true);
    expect(isInterstitialTarget('volume')).toBe(true);
    expect(isInterstitialTarget('strength')).toBe(true);
    expect(isInterstitialTarget('week')).toBe(true);
  });
  it('既定で出さない: vitals（医療）/ cycle・photos（機微）/ nutrients・laws（読み物）', () => {
    expect(isInterstitialTarget('vitals')).toBe(false);
    expect(isInterstitialTarget('cycle')).toBe(false);
    expect(isInterstitialTarget('photos')).toBe(false);
    expect(isInterstitialTarget('nutrients')).toBe(false);
    expect(isInterstitialTarget('laws')).toBe(false);
  });
  it('過食の引き金を含む eating・許諾ダイアログが出る health も出さない', () => {
    expect(isInterstitialTarget('eating')).toBe(false);
    expect(isInterstitialTarget('health')).toBe(false);
  });
  it('未知キー・null・空文字は既定で出さない（新しい行に黙って広告が付かない）', () => {
    expect(isInterstitialTarget('brand-new-card')).toBe(false);
    expect(isInterstitialTarget(null)).toBe(false);
    expect(isInterstitialTarget(undefined)).toBe(false);
    expect(isInterstitialTarget('')).toBe(false);
  });
  it('表は1か所だけ（真を持つキーは4つ）＝出す場所が増えていないことの見張り', () => {
    const on = Object.keys(INTERSTITIAL_TARGETS).filter((k) => INTERSTITIAL_TARGETS[k]);
    expect(on.sort()).toEqual(['body', 'strength', 'volume', 'week']);
  });
});
