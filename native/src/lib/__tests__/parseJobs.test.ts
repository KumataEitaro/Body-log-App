// 送信ジョブ永続化の純関数テスト。
// 「送った瞬間に端末へ書き、反映できたら消す」を成立させる判断は全部ここにある：
// 何を復元するか・何を捨てるか・二重反映をどこで止めるか。
import {
  makeJob, addJob, removeJob, markFailed, markRunning,
  decodeJobs, encodeJobs, isSlow, triageJobs, claimOnce, releaseClaim,
  MAX_JOBS, MAX_AGE_MS, type ParseJob,
} from '../parseJobs';

const NOW = 1_800_000_000_000;
const base = (over: Partial<ParseJob> = {}): ParseJob => ({
  id: 'a', text: 'バナナ', photoUris: [], date: '2026-09-01', createdAt: NOW, state: 'running', ...over,
});

describe('ジョブの生成と更新', () => {
  it('送信内容をそのまま持ち、解析中で始まる', () => {
    const j = makeJob({ text: 'カレー', photoUris: ['file:///a.jpg'], date: '2026-09-01' }, NOW, () => 0.5);
    expect(j.text).toBe('カレー');
    expect(j.photoUris).toEqual(['file:///a.jpg']);
    expect(j.date).toBe('2026-09-01');
    expect(j.createdAt).toBe(NOW);
    expect(j.state).toBe('running');
    expect(j.id).toBeTruthy();
  });

  it('同じ瞬間の連投でもidが衝突しない', () => {
    const a = makeJob({ text: 'A', photoUris: [], date: '2026-09-01' }, NOW, () => 0.11);
    const b = makeJob({ text: 'B', photoUris: [], date: '2026-09-01' }, NOW, () => 0.87);
    expect(a.id).not.toBe(b.id);
  });

  it('削除は自分のidだけを外す（先頭を消すのではない）', () => {
    const list = [base({ id: 'a' }), base({ id: 'b' }), base({ id: 'c' })];
    expect(removeJob(list, 'b').map((j) => j.id)).toEqual(['a', 'c']);
    expect(list).toHaveLength(3);   // 元の配列は壊さない
  });

  it('失敗は消さずに理由つきで残り、再試行で解析中へ戻る', () => {
    const list = [base({ id: 'a' }), base({ id: 'b' })];
    const failed = markFailed(list, 'a', '通信できませんでした');
    expect(failed[0]).toMatchObject({ state: 'failed', error: '通信できませんでした' });
    expect(failed[1].state).toBe('running');            // 巻き添えにしない
    const again = markRunning(failed, 'a', NOW + 5000);
    expect(again[0].state).toBe('running');
    expect(again[0].error).toBeUndefined();
    expect(again[0].createdAt).toBe(NOW + 5000);        // 待ち時間の起点も引き直す
  });

  it('連投しても端末に残す件数は上限までで、古い順に落ちる', () => {
    let list: ParseJob[] = [];
    for (let i = 0; i < MAX_JOBS + 3; i++) {
      list = addJob(list, base({ id: `j${i}`, createdAt: NOW + i }));
    }
    expect(list).toHaveLength(MAX_JOBS);
    expect(list[0].id).toBe('j3');
    expect(list[list.length - 1].id).toBe(`j${MAX_JOBS + 2}`);
  });
});

describe('端末の文字列の読み書き', () => {
  it('往復しても内容が変わらない', () => {
    const list = [base({ id: 'a' }), base({ id: 'b', text: '', photoUris: ['file:///x.jpg'], state: 'failed', error: 'だめ' })];
    expect(decodeJobs(encodeJobs(list))).toEqual(list);
  });

  it('未保存・壊れたJSON・配列でない値では空になる（起動を止めない）', () => {
    expect(decodeJobs(null)).toEqual([]);
    expect(decodeJobs('')).toEqual([]);
    expect(decodeJobs('{壊れ')).toEqual([]);
    expect(decodeJobs('{"a":1}')).toEqual([]);
  });

  it('形の合わない1件だけを落として残りは活かす', () => {
    const raw = JSON.stringify([
      base({ id: 'ok' }),
      { id: 'no-date', text: 'x', createdAt: NOW },          // dateが無い
      { id: 'empty', text: '', photoUris: [], date: '2026-09-01', createdAt: NOW },  // 中身が無い
      null,
    ]);
    expect(decodeJobs(raw).map((j) => j.id)).toEqual(['ok']);
  });
});

describe('復元時の仕分け', () => {
  it('今日の解析中は再送、失敗は表示のまま、別の日と古すぎるものは捨てる', () => {
    const list = [
      base({ id: 'run', state: 'running' }),
      base({ id: 'fail', state: 'failed', error: 'だめ' }),
      base({ id: 'yesterday', date: '2026-08-31' }),
      base({ id: 'stale', createdAt: NOW - MAX_AGE_MS - 1 }),
    ];
    const { resume, keep, drop } = triageJobs(list, '2026-09-01', NOW);
    expect(resume.map((j) => j.id)).toEqual(['run']);
    expect(keep.map((j) => j.id)).toEqual(['fail']);
    expect(drop.map((j) => j.id)).toEqual(['yesterday', 'stale']);
  });

  it('端末の時計が巻き戻っていても未来のジョブを抱え込まない', () => {
    const list = [base({ id: 'future', createdAt: NOW + 10 * 60_000 })];
    expect(triageJobs(list, '2026-09-01', NOW).drop.map((j) => j.id)).toEqual(['future']);
  });
});

describe('待ち時間の体感と冪等', () => {
  it('8秒を境に「混み合っています」の判定が変わる', () => {
    const j = base();
    expect(isSlow(j, NOW + 7_999)).toBe(false);
    expect(isSlow(j, NOW + 8_001)).toBe(true);
    expect(isSlow(base({ state: 'failed' }), NOW + 30_000)).toBe(false);  // 失敗中は別の出し方をする
  });

  it('同じジョブidの結果は一度しか通さない（再送中に旧応答が返っても二重に積まない）', () => {
    const seen = new Set<string>();
    expect(claimOnce(seen, 'a')).toBe(true);
    expect(claimOnce(seen, 'a')).toBe(false);
    expect(claimOnce(seen, 'b')).toBe(true);
    releaseClaim(seen, 'a');            // ［再試行］を押したときだけ開け直す
    expect(claimOnce(seen, 'a')).toBe(true);
  });
});
