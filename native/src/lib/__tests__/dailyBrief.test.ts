// 今日のひとこと帯の選定ロジック。
// 「データ由来が最優先・採点しない・何かしら必ず返す」を固定する。
import { buildDailyBrief } from '../dailyBrief';
import type { InsightDay } from '../insights';

const day = (date: string, over: Partial<InsightDay> = {}): InsightDay =>
  ({ date, intake: 1600, p: 120, diff: -400, mood: null, text: null, ...over });

describe('buildDailyBrief', () => {
  it('データが何も無くても必ず何か返す（豆知識にフォールバック）', () => {
    const b = buildDailyBrief([], 5, [], null, 0);
    expect(b.title.length).toBeGreaterThan(0);
    expect(b.kind).toBe('tip');
  });

  it('連続記録があれば祝う', () => {
    const days = ['-05', '-04', '-03', '-02', '-01'].map((d) => day(`2026-08${d.replace('-', '-2')}`));
    const b = buildDailyBrief(days, 3, [], null, 0);
    expect(['streak', 'deficit']).toContain(b.kind);
  });

  it('食べすぎが今日の曜日に集中していれば備えを促す（責めない文面）', () => {
    // 金曜(5)に3回の食べすぎ
    const days: InsightDay[] = [
      day('2026-08-07', { diff: 500 }),  // 金
      day('2026-08-14', { diff: 400 }),  // 金
      day('2026-08-21', { diff: 300 }),  // 金
      day('2026-08-10'), day('2026-08-11'), day('2026-08-12'),
    ];
    // dayIndexを回して dow が出るまで確認（p1候補のローテーションのため）
    const kinds = [0, 1, 2, 3].map((i) => buildDailyBrief(days, 5, [], null, i).kind);
    expect(kinds).toContain('dow');
    const b = [0, 1, 2, 3].map((i) => buildDailyBrief(days, 5, [], null, i)).find((x) => x.kind === 'dow')!;
    expect(b.title).toContain('金');
    expect(b.body).not.toMatch(/ダメ|悪い|反省/);
  });

  it('3週間横ばいなら停滞の説明を返す', () => {
    const days = [day('2026-08-20')];
    // 停滞判定は測定が6件以上あるときだけ働く（薄いデータで主張しない）
    const weights = [
      { date: '2026-07-28', weight: 80.0 },
      { date: '2026-08-01', weight: 80.0 },
      { date: '2026-08-05', weight: 80.2 },
      { date: '2026-08-10', weight: 79.9 },
      { date: '2026-08-17', weight: 80.0 },
      { date: '2026-08-24', weight: 80.1 },
    ];
    const kinds = [0, 1, 2].map((i) => buildDailyBrief(days, 1, weights, null, i).kind);
    expect(kinds).toContain('plateau');
  });

  it('優先1が無ければ未読コラムを出す', () => {
    const b = buildDailyBrief([day('2026-08-20', { intake: null, diff: null })], 1, [],
      { title: 'PFCバランスとは', minutes: 4, lead: 'P・F・Cの正体' }, 0);
    expect(b.kind).toBe('column');
    expect(b.title).toContain('PFCバランスとは');
  });

  it('dayIndexで候補がローテーションする（毎回同じにならない）', () => {
    const days = [
      ...['-18', '-19', '-20', '-21', '-22'].map((d) => day(`2026-08${d}`)),   // streak + deficit
    ];
    const a = buildDailyBrief(days, 3, [], null, 0).kind;
    const b = buildDailyBrief(days, 3, [], null, 1).kind;
    expect(a === b).toBe(false);   // 候補が2つ以上あるので日で変わる
  });
});
