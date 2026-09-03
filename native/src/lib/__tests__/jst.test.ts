// JSTフォーマッタ（Intl非依存）の固定。
//
// ここが「日付が1日ズレる」類の事故の唯一の防波堤。Intl版と同じ結果になることと、
// UTC 15:00（=JST翌日0:00）の境界・月末・うるう年・壊れた入力を全部固定する。
import { jstParts, jstYmd, jstHm, jstHour, jstHmFromIso, JST_OFFSET_MS } from '../jst';

describe('JST_OFFSET_MS', () => {
  it('UTC+9固定（日本はDSTが無い）', () => {
    expect(JST_OFFSET_MS).toBe(32400000);
  });
});

describe('jstYmd（YYYY-MM-DD）', () => {
  it('日中のUTCは同じ日付になる', () => {
    // 2026-09-03 01:23 UTC = 2026-09-03 10:23 JST
    expect(jstYmd(Date.UTC(2026, 8, 3, 1, 23))).toBe('2026-09-03');
  });

  it('UTC 15:00 で JST の翌日に切り替わる（境界の直前は当日）', () => {
    expect(jstYmd(Date.UTC(2026, 8, 3, 14, 59, 59, 999))).toBe('2026-09-03');
    expect(jstYmd(Date.UTC(2026, 8, 3, 15, 0, 0, 0))).toBe('2026-09-04');
  });

  it('月末・年末をまたぐ（12/31 15:00 UTC = 1/1 JST）', () => {
    expect(jstYmd(Date.UTC(2026, 11, 31, 15, 0))).toBe('2027-01-01');
    expect(jstYmd(Date.UTC(2026, 3, 30, 15, 0))).toBe('2026-05-01');
  });

  it('うるう年の2/29が消えない', () => {
    expect(jstYmd(Date.UTC(2028, 1, 28, 15, 0))).toBe('2028-02-29');
    expect(jstYmd(Date.UTC(2027, 1, 28, 15, 0))).toBe('2027-03-01'); // 平年
  });

  it('月・日は必ず2桁ゼロ埋め', () => {
    expect(jstYmd(Date.UTC(2026, 0, 5, 3, 0))).toBe('2026-01-05');
  });

  it('壊れた入力は空文字（間違った日付を静かに返さない）', () => {
    expect(jstYmd(NaN)).toBe('');
    expect(jstYmd(Infinity)).toBe('');
    expect(jstYmd(undefined as unknown as number)).toBe('');
  });

  it('Intl実装と同じ結果になる（Intlが使える環境でだけ照合）', () => {
    // jestはNode（Intlが完全）なので、ここで旧実装との一致を担保できる。
    // 落ちるのはAndroidのHermesだけなので、規則が同じことを固定しておけば十分
    const fmt = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' });
    for (const ms of [
      Date.UTC(2026, 8, 3, 14, 59),
      Date.UTC(2026, 8, 3, 15, 0),
      Date.UTC(2026, 11, 31, 23, 59),
      Date.UTC(2024, 1, 29, 0, 0),
    ]) {
      expect(jstYmd(ms)).toBe(fmt.format(new Date(ms)));
    }
  });
});

describe('jstHm（HH:MM・24時間ゼロ埋め）', () => {
  it('UTCに9時間足した時刻になる', () => {
    expect(jstHm(Date.UTC(2026, 8, 3, 1, 5))).toBe('10:05');
    expect(jstHm(Date.UTC(2026, 8, 3, 0, 0))).toBe('09:00');
  });

  it('日付をまたぐと00:00へ戻る', () => {
    expect(jstHm(Date.UTC(2026, 8, 3, 15, 0))).toBe('00:00');
    expect(jstHm(Date.UTC(2026, 8, 3, 14, 59))).toBe('23:59');
  });

  it('壊れた入力は空文字', () => {
    expect(jstHm(NaN)).toBe('');
  });

  it('Intl実装（ja-JP・2-digit）と同じ結果になる', () => {
    const fmt = new Intl.DateTimeFormat('ja-JP', {
      timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit',
    });
    for (const ms of [Date.UTC(2026, 8, 3, 1, 5), Date.UTC(2026, 8, 3, 15, 0), Date.UTC(2026, 8, 3, 14, 59)]) {
      expect(jstHm(ms)).toBe(fmt.format(new Date(ms)));
    }
  });
});

describe('jstHour（0-23）', () => {
  it('JSTの時を返す', () => {
    expect(jstHour(Date.UTC(2026, 8, 3, 0, 0))).toBe(9);
    expect(jstHour(Date.UTC(2026, 8, 3, 15, 0))).toBe(0);
    expect(jstHour(Date.UTC(2026, 8, 3, 14, 0))).toBe(23);
  });

  it('壊れた入力はNaN（呼び出し側が端末ローカル時へ退避できる）', () => {
    expect(Number.isNaN(jstHour(NaN))).toBe(true);
  });
});

describe('jstParts', () => {
  it('年月日時分秒を全部返す（月は1始まり）', () => {
    expect(jstParts(Date.UTC(2026, 8, 3, 1, 23, 45))).toEqual({
      y: 2026, m: 9, d: 3, h: 10, mi: 23, s: 45,
    });
  });

  it('壊れた入力はnull', () => {
    expect(jstParts(NaN)).toBeNull();
    expect(jstParts('2026-09-03' as unknown as number)).toBeNull();
  });
});

describe('jstHmFromIso', () => {
  it('ISO文字列（Z・オフセット付き）をJSTの時刻にする', () => {
    expect(jstHmFromIso('2026-09-03T01:05:00.000Z')).toBe('10:05');
    expect(jstHmFromIso('2026-09-03T10:05:00+09:00')).toBe('10:05');
  });

  it('null・空・パース不能は空文字（画面を落とさない）', () => {
    expect(jstHmFromIso(null)).toBe('');
    expect(jstHmFromIso('')).toBe('');
    expect(jstHmFromIso('not a date')).toBe('');
  });
});
