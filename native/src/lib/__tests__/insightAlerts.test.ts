// 気づきアラートの配線（lib/insightAlerts）: 履歴の掃除・最大2枚（caution優先）・×で今日は閉じる・
// 3日連続の休み・朝の通知の判断（smartのみ・1日1件・cautionのみ・時間帯）・解説リンクの kind。
// ロケール未設定（=日本語キーがそのまま返る）前提で日本語文字列を比較する
import {
  pruneHistory, mergeHistory, resolveCardAlerts, planMorningNotification, alertNotificationCopy, lawLinkForAlert,
  MAX_CARDS, HISTORY_KEEP_DAYS,
} from '../insightAlerts';
import type { Alert, AlertHistory, Insight } from '../correlate';
import { shiftDate } from '../features';

const TODAY = '2026-06-30';

function alert(id: string, tone: Alert['tone'], factors: string[] = ['睡眠が6時間未満']): Alert {
  return { id: `alert:${id}`, tone, factors, text: `${id} text`, ruleId: id };
}
function insight(id: string, outcome: string, factors: string[], effect = 2.2): Insight {
  return { id, kind: 'rule', factors, outcome, effect, n: 30, confidence: 'mid', text: '', evidenceKey: `multi_${outcome}`, support: 8, hits: 5 };
}

describe('insightAlerts: 履歴', () => {
  it('pruneHistory は30日より前と壊れた行を落とす', () => {
    const h: AlertHistory[] = [
      { id: 'a', date: shiftDate(TODAY, -HISTORY_KEEP_DAYS - 1) },   // 古い → 落ちる
      { id: 'b', date: shiftDate(TODAY, -HISTORY_KEEP_DAYS) },       // ちょうど境界 → 残る
      { id: 'c', date: TODAY },
      { id: 42 as unknown as string, date: TODAY },                  // 壊れた行 → 落ちる
    ];
    expect(pruneHistory(h, TODAY).map((x) => x.id)).toEqual(['b', 'c']);
  });

  it('mergeHistory は同id・同日を二重登録せず、掃除も兼ねる', () => {
    const h: AlertHistory[] = [{ id: 'alert:r1', date: TODAY }, { id: 'old', date: shiftDate(TODAY, -40) }];
    const out = mergeHistory(h, [alert('r1', 'caution'), alert('r2', 'positive')], TODAY);
    expect(out).toEqual([{ id: 'alert:r1', date: TODAY }, { id: 'alert:r2', date: TODAY }]);
  });
});

describe('insightAlerts: カードの枚数', () => {
  it('同時に最大2枚・caution 優先（caution 3 + positive 1 → caution 2）', () => {
    const alerts = [alert('p1', 'positive'), alert('c1', 'caution'), alert('c2', 'caution'), alert('c3', 'caution')];
    const out = resolveCardAlerts(alerts, [], [], TODAY);
    expect(out).toHaveLength(MAX_CARDS);
    expect(out.every((a) => a.tone === 'caution')).toBe(true);
  });

  it('caution 1 + positive 2 → caution 1 + positive 1（元の並びを保つ）', () => {
    const alerts = [alert('p1', 'positive'), alert('p2', 'positive'), alert('c1', 'caution')];
    const out = resolveCardAlerts(alerts, [], [], TODAY);
    expect(out.map((a) => a.id)).toEqual(['alert:c1', 'alert:p1']);
  });

  it('×で今日閉じたものは出ない。昨日閉じたものは今日また出る', () => {
    const alerts = [alert('c1', 'caution'), alert('p1', 'positive')];
    const closed: AlertHistory[] = [{ id: 'alert:c1', date: TODAY }, { id: 'alert:p1', date: shiftDate(TODAY, -1) }];
    expect(resolveCardAlerts(alerts, [], closed, TODAY).map((a) => a.id)).toEqual(['alert:p1']);
  });

  it('今日の履歴があってもカードは消えない（1日中出ていてよい）が、直近3日連続で出ていたら今日は休む', () => {
    const alerts = [alert('c1', 'caution'), alert('c2', 'caution')];
    const history: AlertHistory[] = [
      { id: 'alert:c1', date: TODAY },                     // 今日すでに出した → カードには影響しない
      { id: 'alert:c2', date: shiftDate(TODAY, -1) },
      { id: 'alert:c2', date: shiftDate(TODAY, -2) },
      { id: 'alert:c2', date: shiftDate(TODAY, -3) },      // 3日連続 → 4日目の今日は休む
    ];
    expect(resolveCardAlerts(alerts, history, [], TODAY).map((a) => a.id)).toEqual(['alert:c1']);
  });
});

describe('insightAlerts: 朝の通知', () => {
  const base = { alerts: [alert('c1', 'caution', ['睡眠不足が5時間以上たまっている']), alert('p1', 'positive')], enabled: true, lastNotified: null, today: TODAY };
  const at = (h: number, m = 0) => new Date(`${TODAY}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`);

  it('smart のときだけ。always / off では出さない', () => {
    expect(planMorningNotification({ ...base, mode: 'smart', now: at(6, 30) })).not.toBeNull();
    expect(planMorningNotification({ ...base, mode: 'always', now: at(6, 30) })).toBeNull();
    expect(planMorningNotification({ ...base, mode: 'off', now: at(6, 30) })).toBeNull();
  });

  it('設定OFF・今日すでに通知済み（1日1件）・positive だけ、のときは出さない', () => {
    expect(planMorningNotification({ ...base, mode: 'smart', now: at(6), enabled: false })).toBeNull();
    expect(planMorningNotification({ ...base, mode: 'smart', now: at(6), lastNotified: TODAY })).toBeNull();
    expect(planMorningNotification({ ...base, mode: 'smart', now: at(6), lastNotified: shiftDate(TODAY, -1) })).not.toBeNull();
    expect(planMorningNotification({ ...base, mode: 'smart', now: at(6), alerts: [alert('p1', 'positive')] })).toBeNull();
  });

  it('8:00前の起動は8:00に予約、8:00〜10:00は3分後、10:00以降は出さない', () => {
    const early = planMorningNotification({ ...base, mode: 'smart', now: at(6, 30) })!;
    expect(early.at.getHours()).toBe(8); expect(early.at.getMinutes()).toBe(0);
    const mid = planMorningNotification({ ...base, mode: 'smart', now: at(8, 30) })!;
    expect(mid.at.getTime()).toBe(at(8, 33).getTime());
    expect(planMorningNotification({ ...base, mode: 'smart', now: at(10, 0) })).toBeNull();
  });

  it('文言は非審判「今日は{factors先頭}の日」＋「無理せず、いつもどおりで」。caution を選ぶ', () => {
    const p = planMorningNotification({ ...base, mode: 'smart', now: at(7) })!;
    expect(p.alert.id).toBe('alert:c1');
    expect(p.title).toBe('今日は睡眠不足が5時間以上たまっているの日');
    expect(p.body.startsWith('無理せず、いつもどおりで')).toBe(true);
    expect(alertNotificationCopy(alert('x', 'caution', ['前日の気分が低め'])).title).toBe('今日は前日の気分が低めの日');
  });
});

describe('insightAlerts: 解説リンク', () => {
  it('食べすぎ系: 単独の睡眠負債→sleep_debt_binge、単独の気分3日→mood_lag_binge、それ以外→multi_binge（f=因子の組）', () => {
    const a = alert('r', 'caution');
    expect(lawLinkForAlert(a, insight('r', 'binge', ['sleep_debt5_ge5']))!.kind).toBe('sleep_debt_binge');
    expect(lawLinkForAlert(a, insight('r', 'binge', ['mood_avg3_low']))!.kind).toBe('mood_lag_binge');
    const multi = lawLinkForAlert(a, insight('r', 'binge', ['prev_mood_low', 'sleep_lt6']))!;
    expect(multi.kind).toBe('multi_binge');
    expect(multi.p).toMatchObject({ f: 'prev_mood_low+sleep_lt6', x: 2.2, n: 30, h: 5 });
  });

  it('トレの伸び: 睡眠7hが因子なら lift_sleep、そうでなければリンク無し。Insight が無ければ null', () => {
    const a = alert('r', 'positive');
    expect(lawLinkForAlert(a, insight('r', 'lift_volume_up', ['sleep_ge7']))!.kind).toBe('lift_sleep');
    expect(lawLinkForAlert(a, insight('r', 'lift_volume_up', ['dow_1']))).toBeNull();
    expect(lawLinkForAlert(a, undefined)).toBeNull();
  });
});
