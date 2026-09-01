// きょうのハイライト（B-16）の選定ロジック。
// 優先順位（法則 > 過食リスク > 週間ダイジェスト > 自己ベスト > トレンド転換）と
// 「どれも無い日はnull（無理に埋めない）」を固定する。
// テストはロケール未設定（=日本語キーがそのまま返る）前提で日本語文字列を比較する。
import { pickHighlight, highlightText, lastWeekStats, recentPR, type HighlightInput } from '../highlight';

// 2026-06-15は月曜。today=火曜(6/16)を基準に組む
const TODAY = '2026-06-16';

// 全候補が不成立のベース入力（テストごとに上書きする）
function base(): HighlightInput {
  return {
    today: TODAY,
    law: null,
    bingeLevel: 'low',
    prevDate: TODAY,       // 同日判定済み＝週明け扱いにならない
    lastWeek: null,
    pr: null,
    trendDir: 'flat',
    prevTrendDir: 'flat',
  };
}

describe('pickHighlight（優先順位つきの1枚選定）', () => {
  it('直近24h以内に見つかった法則が最優先（過食リスク高より上）', () => {
    const p = pickHighlight({
      ...base(),
      law: { kind: 'comeback', p: {}, foundAt: TODAY },
      bingeLevel: 'high',
    });
    expect(p).toEqual({ kind: 'law', target: 'laws', lawKind: 'comeback', lawP: {} });
  });

  it('法則が古い（2日以上前）なら次点の過食リスク高が選ばれる', () => {
    const p = pickHighlight({
      ...base(),
      law: { kind: 'comeback', p: {}, foundAt: '2026-06-13' },
      bingeLevel: 'high',
    });
    expect(p).toEqual({ kind: 'binge', target: 'eating', reasonN: 0 });
  });

  it('週明け最初の起動（前回判定日が先週）＋先週2日以上の記録 → 週間ダイジェスト', () => {
    const p = pickHighlight({
      ...base(),
      prevDate: '2026-06-14',              // 先週の日曜
      lastWeek: { rec: 5, dW: -0.4 },
    });
    expect(p).toEqual({ kind: 'week', target: 'week', rec: 5, dW: -0.4 });
  });

  it('同じ週に判定済みなら週間ダイジェストは出ず、自己ベストへ落ちる', () => {
    const p = pickHighlight({
      ...base(),
      prevDate: '2026-06-15',              // 今週の月曜（同じ週）
      lastWeek: { rec: 5, dW: -0.4 },
      pr: { name: 'ベンチプレス', kg: 80 },
    });
    expect(p).toEqual({ kind: 'pr', target: 'strength', name: 'ベンチプレス', kg: 80 });
  });

  it('体重トレンドの方向が前回保存値と変わった → トレンド転換（flatへの変化は転換と呼ばない）', () => {
    expect(pickHighlight({ ...base(), trendDir: 'down', prevTrendDir: 'up' }))
      .toEqual({ kind: 'trend', target: 'body', dir: 'down' });
    // 動きが止まっただけ（flat）はハイライトにしない
    expect(pickHighlight({ ...base(), trendDir: 'flat', prevTrendDir: 'up' })).toBeNull();
    // 前回の保存が無い初回は比較相手がないので出さない
    expect(pickHighlight({ ...base(), trendDir: 'down', prevTrendDir: null })).toBeNull();
  });

  it('どの候補も成立しない日はnull（カードを出さない）', () => {
    expect(pickHighlight(base())).toBeNull();
  });
});

describe('highlightText（表示のたびに現在の言語で組み立て）', () => {
  it('自己ベスト: 種目名とkgが本文に入る', () => {
    const txt = highlightText({ kind: 'pr', target: 'strength', name: 'スクワット', kg: 100 });
    expect(txt.title).toBe('自己ベストを更新！');
    expect(txt.body).toBe('「スクワット」が100kgに到達。積み重ねの成果です。');
  });

  it('週間ダイジェスト: 体重変化が無ければ記録日数だけの文になる', () => {
    const t1 = highlightText({ kind: 'week', target: 'week', rec: 4, dW: 0.3 });
    expect(t1.body).toBe('先週は4日記録・体重+0.3kg。タップで週のふりかえりへ。');
    const t2 = highlightText({ kind: 'week', target: 'week', rec: 4, dW: null });
    expect(t2.body).toBe('先週は4日記録しました。タップで週のふりかえりへ。');
  });
});

describe('lastWeekStats（先週の1行の材料）', () => {
  it('先週の記録日数と「先週末 − 先々週末」の体重変化を返す', () => {
    const rows = [
      { date: '2026-06-05', intake: 1800, weight: 71.0 },   // 先々週（体重の基準）
      { date: '2026-06-08', intake: 1900, weight: null },   // 先週 月
      { date: '2026-06-10', intake: 2000, weight: 70.8 },   // 先週 水
      { date: '2026-06-13', intake: null, weight: 70.5 },   // 先週 土（摂取なし=記録日に数えない）
      { date: '2026-06-15', intake: 1700, weight: 70.2 },   // 今週（対象外）
    ];
    expect(lastWeekStats(rows, TODAY)).toEqual({ rec: 2, dW: -0.5 });
  });

  it('先週の記録が1日も無ければnull', () => {
    expect(lastWeekStats([{ date: '2026-06-15', intake: 1800, weight: 70 }], TODAY)).toBeNull();
  });
});

describe('recentPR（直近3日の自己ベスト更新）', () => {
  const pts = (xs: [string, number][]) => xs.map(([date, maxKg]) => ({ date, maxKg }));

  it('直近3日に過去より重い記録がある種目を返す（複数あれば最も重い1つ）', () => {
    const series = [
      { name: 'ベンチプレス', pts: pts([['2026-05-01', 70], ['2026-06-15', 80]]) },
      { name: 'スクワット', pts: pts([['2026-05-01', 90], ['2026-06-16', 100]]) },
    ];
    expect(recentPR(series, TODAY)).toEqual({ name: 'スクワット', kg: 100 });
  });

  it('初回記録（比較相手なし）はPRと呼ばない・3日より前の更新も対象外', () => {
    const series = [
      { name: 'デッドリフト', pts: pts([['2026-06-16', 120]]) },                    // 初回1発目
      { name: 'ベンチプレス', pts: pts([['2026-05-01', 70], ['2026-06-10', 80]]) }, // 更新が古い
    ];
    expect(recentPR(series, TODAY)).toBeNull();
  });
});
