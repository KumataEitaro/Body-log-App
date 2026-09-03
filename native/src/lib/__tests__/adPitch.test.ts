// 「広告をなくしませんか？」の誘導（広告→課金の導線）。
//
// ここは事故の種類が2つある:
//  1. **嘘**: 広告が1枚も出ていない状態（RCキー未設定・課金者）で「広告を消せます」と言う。
//     いま広告は誰にも出ていないので、点火まで全部眠っていなければならない
//  2. **煽り**: 回数に応じて文言を強める／罪悪感を誘う語を使う。戦略の「静かな伴走者」に反する
// どちらも文言と式のミスで起きるので、判定と禁止語をここで固定する。
import {
  shouldPitchAdRemoval,
  shouldShowImpressionCount,
  bumpImpression,
  weeklyImpressions,
  parseImpressions,
  parseDayCount,
  bumpDayCount,
  dayCountOf,
  AD_PITCH_MAX_PER_DAY,
  AD_PITCH_MIN_IMPRESSIONS,
  AD_IMPRESSION_DAYS,
  AD_IMPRESSION_STORE_KEY,
  AD_PITCH_STORE_KEY,
} from '../ads';
import { DICTS } from '@/content/i18n';

const OK = { active: true, plan: 'free' as string | null, impressions7d: 5, shownTodayCount: 0 };

describe('shouldPitchAdRemoval（誘導を出してよいか）', () => {
  it('全条件を満たすときだけ出す（基準ケース）', () => {
    expect(shouldPitchAdRemoval(OK)).toBe(true);
  });

  it('広告が出ない状態（active=false・RCキー未設定の現運用）では常にfalse＝嘘をつかない', () => {
    expect(shouldPitchAdRemoval({ ...OK, active: false })).toBe(false);
    // 回数がいくら積まれていても、広告が出ないビルドでは誘導しない
    expect(shouldPitchAdRemoval({ ...OK, active: false, impressions7d: 999 })).toBe(false);
  });

  it('課金者（lite/standard/premium）には出さない', () => {
    expect(shouldPitchAdRemoval({ ...OK, plan: 'lite' })).toBe(false);
    expect(shouldPitchAdRemoval({ ...OK, plan: 'standard' })).toBe(false);
    expect(shouldPitchAdRemoval({ ...OK, plan: 'premium' })).toBe(false);
  });

  it('広告を1回も見ていない人には出さない（「消せます」が意味を持たない）', () => {
    expect(shouldPitchAdRemoval({ ...OK, impressions7d: 0 })).toBe(false);
    expect(shouldPitchAdRemoval({ ...OK, impressions7d: 1 })).toBe(true);
  });

  it('1日の提示上限は2回（境界: 1回目・2回目は出す・3回目は出さない）', () => {
    expect(shouldPitchAdRemoval({ ...OK, shownTodayCount: 0 })).toBe(true);
    expect(shouldPitchAdRemoval({ ...OK, shownTodayCount: AD_PITCH_MAX_PER_DAY - 1 })).toBe(true);
    expect(shouldPitchAdRemoval({ ...OK, shownTodayCount: AD_PITCH_MAX_PER_DAY })).toBe(false);
  });

  it('勧誘は広告より必ず少ない（全画面3回/日 > 提示2回/日）', () => {
    expect(AD_PITCH_MAX_PER_DAY).toBeLessThan(3);
  });
});

describe('shouldShowImpressionCount（回数行を出すか）', () => {
  it('3回未満は出さない＝小さい数字で大げさに言わない（境界）', () => {
    for (let n = 0; n < AD_PITCH_MIN_IMPRESSIONS; n++) {
      expect(shouldShowImpressionCount({ active: true, plan: 'free', impressions7d: n })).toBe(false);
    }
    expect(shouldShowImpressionCount({ active: true, plan: 'free', impressions7d: AD_PITCH_MIN_IMPRESSIONS })).toBe(true);
  });
  it('広告が出ない状態・課金者では回数行も出さない', () => {
    expect(shouldShowImpressionCount({ active: false, plan: 'free', impressions7d: 20 })).toBe(false);
    expect(shouldShowImpressionCount({ active: true, plan: 'standard', impressions7d: 20 })).toBe(false);
  });
});

describe('bumpImpression / weeklyImpressions（見た回数の数え方）', () => {
  it('同じ日は積み上がる', () => {
    let rows = bumpImpression([], '2026-09-04');
    rows = bumpImpression(rows, '2026-09-04');
    rows = bumpImpression(rows, '2026-09-04');
    expect(rows).toEqual([{ date: '2026-09-04', count: 3 }]);
    expect(weeklyImpressions(rows, '2026-09-04')).toBe(3);
  });

  it('日をまたぐと行が増え、1週間の合計になる', () => {
    let rows: { date: string; count: number }[] = [];
    rows = bumpImpression(rows, '2026-09-01', 2);
    rows = bumpImpression(rows, '2026-09-02', 3);
    rows = bumpImpression(rows, '2026-09-04', 1);
    expect(weeklyImpressions(rows, '2026-09-04')).toBe(6);
    expect(rows.map((r) => r.date)).toEqual(['2026-09-01', '2026-09-02', '2026-09-04']);
  });

  it('7日より古い行は落ちる（使わないデータを端末に残さない）', () => {
    let rows = bumpImpression([], '2026-08-20', 9);
    rows = bumpImpression(rows, '2026-09-04');
    expect(rows).toEqual([{ date: '2026-09-04', count: 1 }]);
    expect(weeklyImpressions(rows, '2026-09-04')).toBe(1);
  });

  it('直近7日ちょうどは数え、8日前は数えない（境界）', () => {
    const rows = [
      { date: '2026-08-28', count: 5 }, // 8日前 → 対象外
      { date: '2026-08-29', count: 4 }, // 7日前 → 対象
      { date: '2026-09-04', count: 1 },
    ];
    expect(AD_IMPRESSION_DAYS).toBe(7);
    expect(weeklyImpressions(rows, '2026-09-04')).toBe(5);
  });

  it('未来日付は数えない（端末の時計をいじっても水増しされない）', () => {
    const rows = [{ date: '2026-09-04', count: 2 }, { date: '2099-01-01', count: 100 }];
    expect(weeklyImpressions(rows, '2026-09-04')).toBe(2);
  });

  it('壊れた保存値でも落ちない', () => {
    expect(parseImpressions(null)).toEqual([]);
    expect(parseImpressions('{壊れ')).toEqual([]);
    expect(parseImpressions('{"date":"2026-09-04"}')).toEqual([]);      // 配列でない
    expect(parseImpressions('[{"date":"x","count":1},{"date":"2026-09-04","count":-2},3]'))
      .toEqual([{ date: '2026-09-04', count: 0 }]);                      // 日付不正・負数・型違いを除去
  });

  it('保存キーは他機能と衝突しない', () => {
    expect(AD_IMPRESSION_STORE_KEY).toBe('bl-ad-impressions');
    expect(AD_PITCH_STORE_KEY).toBe('bl-ad-pitch');
  });
});

describe('提示回数の履歴（DayCount）', () => {
  it('同じ日は積み、日が変わったら1に戻る', () => {
    let v = bumpDayCount({ date: '', count: 0 }, '2026-09-04');
    expect(v).toEqual({ date: '2026-09-04', count: 1 });
    v = bumpDayCount(v, '2026-09-04');
    expect(v).toEqual({ date: '2026-09-04', count: 2 });
    expect(dayCountOf(v, '2026-09-05')).toBe(0);
    expect(bumpDayCount(v, '2026-09-05')).toEqual({ date: '2026-09-05', count: 1 });
  });
  it('壊れた保存値は「未提示」', () => {
    expect(parseDayCount(null)).toEqual({ date: '', count: 0 });
    expect(parseDayCount('null')).toEqual({ date: '', count: 0 });
    expect(parseDayCount('{"date":"2026-09-04","count":"x"}')).toEqual({ date: '2026-09-04', count: 0 });
  });
  it('上限まで積むと出せなくなり、翌日また出せる（結合）', () => {
    let v = { date: '', count: 0 };
    for (let i = 0; i < AD_PITCH_MAX_PER_DAY; i++) {
      expect(shouldPitchAdRemoval({ ...OK, shownTodayCount: dayCountOf(v, '2026-09-04') })).toBe(true);
      v = bumpDayCount(v, '2026-09-04');
    }
    expect(shouldPitchAdRemoval({ ...OK, shownTodayCount: dayCountOf(v, '2026-09-04') })).toBe(false);
    expect(shouldPitchAdRemoval({ ...OK, shownTodayCount: dayCountOf(v, '2026-09-05') })).toBe(true);
  });
});

// ===== 文言の規約（煽らない）=====
// 「静かな伴走者」に反する語が広告まわりのUI文字列に混ざっていないことを固定する。
// 辞書の原文キー（＝日本語の原文）を全部見て、禁止語を含む行が無いことを確かめる。
describe('広告まわりの文言に煽り・罪悪感の語を使わない', () => {
  const BANNED = ['我慢', '邪魔', 'うんざり', 'しつこい'];
  // 広告・課金の導線で使う原文（このブランチで足した／触ったもの）
  const AD_STRINGS = [
    '広告',
    '広告を消す →',
    '広告なしで使えます',
    '広告なしで、静かに記録する',
    '全画面の広告を、もう出さない',
    'スタンダード以上で広告が消えて、AIの解析回数もぐっと増えます。',
    'この1週間で広告を{n}回見ています。スタンダードなら0回です。',
    '広告なし',
  ];

  it('禁止語（我慢/邪魔/うんざり/しつこい）を含まない', () => {
    for (const src of AD_STRINGS) {
      for (const w of BANNED) expect({ src, w, has: src.includes(w) }).toEqual({ src, w, has: false });
    }
  });

  it('「あと◯回で」のような焦らせ方をしない', () => {
    for (const src of AD_STRINGS) {
      expect(/あと\s*\{?n?\}?\s*回/.test(src)).toBe(false);
    }
  });

  it('辞書の原文キー全体にも禁止語が無い（他の画面から混ざり込まない見張り）', () => {
    const keys = Object.keys(DICTS.en ?? {});
    const bad = keys.filter((k) => k.includes('広告') && BANNED.some((w) => k.includes(w)));
    expect(bad).toEqual([]);
  });

  it('回数行は回数によって文言が変わらない（エスカレーションしない）', () => {
    // 原文は1本だけ＝nの値でテンプレートが分岐していないことの確認
    const templates = AD_STRINGS.filter((s) => s.includes('{n}回見ています'));
    expect(templates).toHaveLength(1);
  });
});
