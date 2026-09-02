// リモートコンテンツ（lib/remoteContent）の純関数と、各機能への接続を固定する。
// 守りたいこと:
//  ①DSL評価器が正しく比較し、未知のmetricで落ちない
//  ②マージ規則（idで統合・同idは上書き・新idは追加・version順・min_app_version）
//  ③多言語フォールバック（表示言語 → ja → en）
//  ④リモートで増えたバッジが既存の遡及通知（planBadgeUnlocks）にそのまま乗る
//  ⑤読み物・法則文言が同梱と統合される（リモート無しなら従来どおり）
import {
  pickL10n, versionGte, evaluateDeclarativeBadge, mergeById, mergeRemoteRows, sortReadingsByDate, isRecent,
  resetRemoteContentForTest, EMPTY_REMOTE, type BadgeMetrics, type RemoteRow,
} from '@/lib/remoteContent';
import { badgeDefs, badgeById, planBadgeUnlocks } from '@/lib/achievements';
import { getColumns, COLUMNS } from '@/content/columns';
import { lawText, lawKindHint } from '@/lib/laws';
import { isAllowedBadgeIcon } from '@/components/BadgeIcon';

const METRICS: BadgeMetrics = {
  streak: 7, recordedDays: 40, morningDays: 3, photoCount: 1, coachCount: 0, myFoodCount: 5, restCount: 0,
  weightLossKg: 2.4, liftVolumeMonthKg: 12000, cardioKmMonth: 0, burnKcalWeek: 0, prCount: 0, weekCount: 4,
};

const row = (over: Partial<RemoteRow>): RemoteRow => ({
  id: 'r', kind: 'readings', version: 1, payload: { items: [] }, published_at: '2026-09-01T00:00:00Z', min_app_version: null, ...over,
});

afterEach(() => resetRemoteContentForTest(EMPTY_REMOTE));

describe('pickL10n（多言語フォールバック）', () => {
  it('表示言語があればそれ、無ければ ja → en', () => {
    expect(pickL10n({ ja: '日本', en: 'EN', ko: '한국' }, 'ko')).toBe('한국');
    expect(pickL10n({ ja: '日本', en: 'EN' }, 'ko')).toBe('日本');
    expect(pickL10n({ en: 'EN' }, 'ko')).toBe('EN');
  });
  it('文字列1本はそのまま・空や壊れた値は空文字', () => {
    expect(pickL10n('共通', 'en')).toBe('共通');
    expect(pickL10n(undefined, 'en')).toBe('');
    expect(pickL10n({ fr: 'Bonjour' }, 'ja')).toBe('Bonjour');   // ja/enも無ければ最初の値
  });
});

describe('versionGte（min_app_version）', () => {
  it('数値の桁で比較し、欠けた桁は0', () => {
    expect(versionGte('1.0.20', '1.0.20')).toBe(true);
    expect(versionGte('1.0.19', '1.0.20')).toBe(false);
    expect(versionGte('1.1', '1.0.20')).toBe(true);
    expect(versionGte('2', '1.9.9')).toBe(true);
  });
  it('minが無い・解釈不能なら制限なし。appが解釈不能（開発ビルド）も配信を止めない', () => {
    expect(versionGte('1.0.20', null)).toBe(true);
    expect(versionGte('1.0.20', 'latest')).toBe(true);
    expect(versionGte(null, '1.0.20')).toBe(true);
    expect(versionGte('1.0-test', '1.0.1')).toBe(false);   // '1.0' < '1.0.1'
  });
});

describe('evaluateDeclarativeBadge（条件DSL）', () => {
  it('単一条件（既定opは >=）', () => {
    expect(evaluateDeclarativeBadge({ when: { metric: 'streak', value: 7 } }, METRICS)).toBe(true);
    expect(evaluateDeclarativeBadge({ when: { metric: 'streak', value: 8 } }, METRICS)).toBe(false);
  });
  it('AND配列は全部満たすとき', () => {
    expect(evaluateDeclarativeBadge({ when: [{ metric: 'streak', value: 7 }, { metric: 'myFoodCount', value: 5 }] }, METRICS)).toBe(true);
    expect(evaluateDeclarativeBadge({ when: [{ metric: 'streak', value: 7 }, { metric: 'coachCount', value: 1 }] }, METRICS)).toBe(false);
  });
  it('op の種類', () => {
    expect(evaluateDeclarativeBadge({ when: { metric: 'weightLossKg', op: '>', value: 2.4 } }, METRICS)).toBe(false);
    expect(evaluateDeclarativeBadge({ when: { metric: 'weightLossKg', op: '<=', value: 2.4 } }, METRICS)).toBe(true);
    expect(evaluateDeclarativeBadge({ when: { metric: 'photoCount', op: '==', value: 1 } }, METRICS)).toBe(true);
    expect(evaluateDeclarativeBadge({ when: { metric: 'prCount', op: '<', value: 1 } }, METRICS)).toBe(true);
  });
  it('未知のmetric・条件無しは false（落ちない）', () => {
    expect(evaluateDeclarativeBadge({ when: { metric: 'stepsWeek' as never, value: 1 } }, METRICS)).toBe(false);
    expect(evaluateDeclarativeBadge({ when: [] }, METRICS)).toBe(false);
    expect(evaluateDeclarativeBadge({}, METRICS)).toBe(false);
  });
});

describe('mergeById / mergeRemoteRows（マージ規則）', () => {
  it('同idは位置を保って上書き、新idは末尾に追加', () => {
    const out = mergeById([{ id: 'a', v: 1 }, { id: 'b', v: 1 }], [{ id: 'b', v: 2 }, { id: 'c', v: 1 }]);
    expect(out).toEqual([{ id: 'a', v: 1 }, { id: 'b', v: 2 }, { id: 'c', v: 1 }]);
  });
  it('同kindの複数行は version 昇順に適用され後勝ち。min_app_version より古いアプリは行を無視', () => {
    const rows: RemoteRow[] = [
      row({ id: 'v2', version: 2, kind: 'readings', payload: { items: [{ id: 'x', title: { ja: '新' }, body: 'b' }] } }),
      row({ id: 'v1', version: 1, kind: 'readings', payload: { items: [{ id: 'x', title: { ja: '旧' }, body: 'b' }] } }),
      row({ id: 'future', version: 9, kind: 'readings', min_app_version: '9.9.9', payload: { items: [{ id: 'x', title: { ja: '未来' }, body: 'b' }] } }),
    ];
    const out = mergeRemoteRows(rows, '1.0.20');
    expect(out.readings).toHaveLength(1);
    expect(pickL10n(out.readings[0].title, 'ja')).toBe('新');
  });
  it('壊れた項目・未知のmetricを含むバッジ・未知のkind は捨てて、残りは生きる', () => {
    const rows: RemoteRow[] = [
      row({ id: 'b', kind: 'badges', payload: { items: [
        { id: 'ok', cat: 'streak', name: { ja: 'OK' }, desc: { ja: 'd' }, when: { metric: 'streak', value: 200 } },
        { id: 'bad-metric', cat: 'streak', name: { ja: 'x' }, desc: { ja: 'd' }, when: { metric: 'stepsWeek', value: 1 } },
        { id: 'bad-cat', cat: 'zzz', name: { ja: 'x' }, desc: { ja: 'd' }, when: { metric: 'streak', value: 1 } },
        null, 'garbage', { id: 'no-when', cat: 'body', name: { ja: 'x' }, desc: { ja: 'd' } },
      ] } }),
      row({ id: 'u', kind: 'unknown_kind' as never, payload: { items: [{ id: 'q' }] } }),
      row({ id: 'r', kind: 'readings', payload: { items: [{ id: 'no-body', title: { ja: 't' } }] } }),
    ];
    const out = mergeRemoteRows(rows, '1.0.20');
    expect(out.badges.map((b) => b.id)).toEqual(['ok']);
    expect(out.readings).toEqual([]);
  });
  it('空・null・payload無しでも空の内容を返す（既定の空状態で壊れない）', () => {
    expect(mergeRemoteRows(null, '1.0.20')).toEqual(EMPTY_REMOTE);
    expect(mergeRemoteRows([row({ payload: null })], '1.0.20')).toEqual(EMPTY_REMOTE);
  });
});

describe('読み物の並びと NEW 判定', () => {
  it('公開日の新しい順。日付の無い同梱は元の順で後ろ', () => {
    const out = sortReadingsByDate([{ id: 'a' }, { id: 'b', publishedAt: '2026-08-01' }, { id: 'c' }, { id: 'd', publishedAt: '2026-09-01' }]);
    expect(out.map((x) => x.id)).toEqual(['d', 'b', 'a', 'c']);
  });
  it('isRecent は公開日から指定日数以内だけ true（未来日・日付無しは false）', () => {
    expect(isRecent('2026-08-20', '2026-09-02', 30)).toBe(true);
    expect(isRecent('2026-07-01', '2026-09-02', 30)).toBe(false);
    expect(isRecent('2026-09-10', '2026-09-02', 30)).toBe(false);
    expect(isRecent(undefined, '2026-09-02')).toBe(false);
  });
});

describe('バッジ定義への接続', () => {
  it('リモート無しなら同梱30種のまま（DSL付き23種＋コード判定7種）', () => {
    const defs = badgeDefs();
    expect(defs).toHaveLength(30);
    expect(defs.filter((b) => b.when).length).toBe(23);
    expect(defs.filter((b) => !b.when).map((b) => b.id).sort())
      .toEqual(['fullday', 'goal100', 'goal50', 'nolate7', 'phoenix', 'week_promise', 'weekend4']);
  });
  it('リモートの同idは文言を差し替え、新idは末尾に追加される（多言語は表示言語→ja→en）', () => {
    resetRemoteContentForTest(mergeRemoteRows([row({ kind: 'badges', payload: { items: [
      { id: 'streak3', cat: 'streak', name: { ja: '火種（改）', en: 'Spark' }, desc: { ja: '3日つなぐ' }, when: { metric: 'streak', value: 3 } },
      { id: 'streak200', cat: 'streak', icon: 'Rocket', name: { ja: '二百日行' }, desc: { ja: '200日連続で記録する' }, when: { metric: 'streak', value: 200 } },
    ] } })], '1.0.20'));
    const defs = badgeDefs();
    expect(defs).toHaveLength(31);
    expect(defs[0].id).toBe('streak3');
    expect(defs[0].name).toBe('火種（改）');
    expect(defs[defs.length - 1].id).toBe('streak200');
    expect(badgeById('streak200')?.icon).toBe('Rocket');
    expect(badgeById('streak200')?.remote).toBe(true);
  });
  it('リモートで増えたバッジは既存の遡及通知（seenに無いid→retro）にそのまま乗る', () => {
    resetRemoteContentForTest(mergeRemoteRows([row({ kind: 'badges', payload: { items: [
      { id: 'days30', cat: 'action', name: { ja: '30日' }, desc: { ja: '通算30日記録' }, when: { metric: 'recordedDays', value: 30 } },
    ] } })], '1.0.20'));
    const defs = badgeDefs();
    const ok: Record<string, boolean> = {};
    for (const b of defs) ok[b.id] = b.when ? evaluateDeclarativeBadge(b, METRICS) : false;
    expect(ok.days30).toBe(true);      // recordedDays=40 ≥ 30
    // この端末は同梱30種を評価済み（seen）だが、days30 は初めて見る定義
    const plan = planBadgeUnlocks({ defIds: defs.map((b) => b.id), ok, earned: { streak3: '2026-08-01' }, seen: defs.filter((b) => !b.remote).map((b) => b.id), today: '2026-09-02' });
    const u = plan.unlocks.find((x) => x.id === 'days30');
    expect(u).toEqual({ id: 'days30', retro: true });
    expect(plan.seen).toContain('days30');
  });
  it('アイコン名は許可リストで判定する（未知は既定アイコンに倒す）', () => {
    expect(isAllowedBadgeIcon('Flame')).toBe(true);
    expect(isAllowedBadgeIcon('Rocket')).toBe(true);
    expect(isAllowedBadgeIcon('NotAnIcon')).toBe(false);
    expect(isAllowedBadgeIcon(undefined)).toBe(false);
  });
});

describe('読み物への接続（getColumns）', () => {
  it('リモート無しなら同梱のまま', () => {
    expect(getColumns()).toBe(COLUMNS);
  });
  it('リモートの記事は新着が先頭・同idは上書き・対象言語外は出さない', () => {
    resetRemoteContentForTest(mergeRemoteRows([row({ kind: 'readings', payload: { items: [
      { id: 'new-1', emoji: '🆕', publishedAt: '2026-09-01', title: { ja: '新しい記事' }, lead: { ja: 'リード' }, body: { ja: '本文'.repeat(300) } },
      { id: 'pfc-basics', publishedAt: '2026-08-15', title: { ja: 'PFC（改訂）' }, lead: 'L', body: 'B' },
      { id: 'en-only', langs: ['en'], title: { en: 'English only' }, lead: '', body: 'x' },
    ] } })], '1.0.20'));
    const cols = getColumns();
    expect(cols).toHaveLength(COLUMNS.length + 1);
    expect(cols[0].id).toBe('new-1');
    expect(cols[0].minutes).toBe(1);                // 600字 → 1分
    expect(cols[1].id).toBe('pfc-basics');
    expect(cols[1].title).toBe('PFC（改訂）');
    expect(cols.some((c) => c.id === 'en-only')).toBe(false);
  });
});

describe('法則の文言への接続（lawText / lawKindHint）', () => {
  it('リモート無しなら同梱の文言', () => {
    expect(lawText('recover', { days: 2, binges: 4 }).title).toBe('あなたは食べすぎても、平均2日で体重が戻る');
  });
  it('リモート文言に生値を差し込む。variant（weekday:stable）と hint も効く。片方だけの差し替えは無い側が同梱のまま', () => {
    resetRemoteContentForTest(mergeRemoteRows([row({ kind: 'laws_text', payload: { items: [
      { id: 'food_up', title: { ja: '「{food}」の翌日は+{kg}kgになりがち' } },
      { id: 'weekday:stable', title: { ja: '曜日のムラがない' }, sub: { ja: '8週ぶん' } },
      { id: 'weekday', hint: { ja: '曜日の話' } },
    ] } })], '1.0.20'));
    const f = lawText('food_up', { food: 'ラーメン', kg: 0.6, n: 4 });
    expect(f.title).toBe('「ラーメン」の翌日は+0.6kgになりがち');
    expect(f.sub).toBe('食べた日4日ぶんの傾向から');            // subは同梱のまま
    expect(lawText('weekday', { d: 'stable' })).toEqual({ title: '曜日のムラがない', sub: '8週ぶん' });
    expect(lawText('weekday', { d: 5, kcal: 320 }).title).toBe('あなたは金曜日に崩れやすい（平均+320kcal）'); // defaultは同梱
    expect(lawKindHint('weekday')).toBe('曜日の話');
    expect(lawKindHint('recover')).toBe('立ち直りの早さのこと');
  });
});
