import {
  EVENT_DEFAULT_KCAL, clampEventKcal, eventTitleOf, eventKindOf, quickDates,
  nextEvent, eventBandText, perDayAdjust, perDayAdjustText, EVENT_KINDS,
} from '../eventPlan';

describe('eventPlan: 種類とタイトルの往復', () => {
  it('全ての種類でタイトル→種類が元に戻る（DBに種類カラムを足さない設計の前提）', () => {
    for (const k of EVENT_KINDS) {
      expect(eventKindOf(eventTitleOf(k))).toBe(k);
    }
  });

  it('既存データの「🍖 チートデイ」は cheat として読める（後方互換）', () => {
    expect(eventKindOf('🍖 チートデイ')).toBe('cheat');
  });

  it('未知のタイトル・null は other に寄せる（落とさない）', () => {
    expect(eventKindOf('🕊 リカバリー枠')).toBe('other');
    expect(eventKindOf(null)).toBe('other');
    expect(eventKindOf(undefined)).toBe('other');
    expect(eventKindOf('')).toBe('other');
  });

  it('飲み会の既定は外食より大きい（アルコール＋〆のぶんを見込むため）', () => {
    expect(EVENT_DEFAULT_KCAL.drink).toBeGreaterThan(EVENT_DEFAULT_KCAL.eatout);
  });
});

describe('eventPlan: kcalの丸め', () => {
  it('100刻みに丸め、範囲外は端に寄せる', () => {
    expect(clampEventKcal(840)).toBe(800);
    expect(clampEventKcal(850)).toBe(900);
    expect(clampEventKcal(0)).toBe(100);
    expect(clampEventKcal(99999)).toBe(3000);
  });

  it('数値でない入力でも落ちない', () => {
    expect(clampEventKcal(Number.NaN)).toBe(EVENT_DEFAULT_KCAL.other);
    expect(clampEventKcal(Number.POSITIVE_INFINITY)).toBe(EVENT_DEFAULT_KCAL.other);
  });
});

describe('eventPlan: 日付チップ', () => {
  it('今日・明日・明後日を返す（月をまたいでも正しい）', () => {
    const q = quickDates('2026-09-30');
    expect(q.map((x) => x.iso)).toEqual(['2026-09-30', '2026-10-01', '2026-10-02']);
  });
});

describe('eventPlan: 帯に出す予定の選び方', () => {
  const evs = [
    { date: '2026-09-01', title: '🍻 飲み会', extra_kcal: 900 },   // 過去
    { date: '2026-09-06', title: '🍖 チートデイ', extra_kcal: 1000 },
    { date: '2026-09-05', title: '🍻 飲み会', extra_kcal: 900 },
    { date: '2026-09-30', title: '🍽 外食', extra_kcal: 600 },     // 7日より先
  ];

  it('いちばん近い未来の1件だけを返す', () => {
    expect(nextEvent(evs, '2026-09-04')?.date).toBe('2026-09-05');
  });

  it('過去の予定は出さない（終わった予定の帯は行動につながらない）', () => {
    expect(nextEvent([evs[0]], '2026-09-04')).toBeNull();
  });

  it('当日は出す（境界: 差0日）', () => {
    expect(nextEvent(evs, '2026-09-05')?.date).toBe('2026-09-05');
  });

  it('withinDays より先の予定は出さない（帯が常設になると読まれなくなる）', () => {
    expect(nextEvent([evs[3]], '2026-09-04')).toBeNull();
    expect(nextEvent([evs[3]], '2026-09-24')?.date).toBe('2026-09-30'); // ちょうど6日後
  });

  it('空配列で落ちない', () => {
    expect(nextEvent([], '2026-09-04')).toBeNull();
  });
});

describe('eventPlan: 帯の文面', () => {
  const ev = { date: '2026-09-05', title: '🍻 飲み会', extra_kcal: 900 };

  it('当日・前日・それ以前で言い方が変わる', () => {
    expect(eventBandText(ev, '2026-09-05')).toContain('今日');
    expect(eventBandText(ev, '2026-09-04')).toContain('明日');
    expect(eventBandText(ev, '2026-09-02')).toContain('3日後');
  });

  it('当日の文面は我慢を促さない（貯金は終わっていて、使う日だから）', () => {
    const s = eventBandText(ev, '2026-09-05');
    expect(s).not.toContain('我慢');
    expect(s).not.toContain('控え');
  });

  it('種類の名前が入る', () => {
    expect(eventBandText(ev, '2026-09-04')).toContain('飲み会');
    expect(eventBandText({ ...ev, title: '🍖 チートデイ' }, '2026-09-04')).toContain('チートデイ');
  });
});

describe('eventPlan: 1日あたりの調整量', () => {
  it('spread: 目標日までの残日数で割る', () => {
    // 900kcal を 2026-09-04 → 2026-10-04（30日）で割る
    expect(perDayAdjust(900, '2026-09-04', '2026-09-05', '2026-10-04', null)).toBe(30);
  });

  it('window: 指定日数で割る（目標日は関係ない）', () => {
    expect(perDayAdjust(900, '2026-09-04', '2026-09-05', null, 3)).toBe(300);
    expect(perDayAdjust(900, '2026-09-04', '2026-09-05', '2026-10-04', 3)).toBe(300);
  });

  it('目標未設定かつ window でもないときは null（画面側で文面を切り替える）', () => {
    expect(perDayAdjust(900, '2026-09-04', '2026-09-05', null, null)).toBeNull();
  });

  it('目標日が過ぎている・今日と同じなら null（0除算とマイナスを防ぐ）', () => {
    expect(perDayAdjust(900, '2026-09-04', '2026-09-05', '2026-09-04', null)).toBeNull();
    expect(perDayAdjust(900, '2026-09-04', '2026-09-05', '2026-09-01', null)).toBeNull();
  });

  it('超過0なら調整も0（目標未設定でも null にしない）', () => {
    expect(perDayAdjust(0, '2026-09-04', '2026-09-05', null, null)).toBe(0);
    expect(perDayAdjust(-100, '2026-09-04', '2026-09-05', null, null)).toBe(0);
  });
});

describe('eventPlan: プレビューの文面', () => {
  it('spread と window で言い方が変わる', () => {
    expect(perDayAdjustText(30, null)).toContain('目標日まで');
    expect(perDayAdjustText(300, 3)).toContain('翌日から');
  });

  it('0のときは調整不要と言う', () => {
    expect(perDayAdjustText(0, null)).toContain('必要ありません');
  });
});
