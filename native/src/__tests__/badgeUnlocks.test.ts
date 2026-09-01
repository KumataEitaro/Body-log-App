// バッジ獲得通知の判定（planBadgeUnlocks）。
// ここで守りたいのは2つだけ:
//  ①再インストール（この端末で初めての評価）で30個の祝祭が一斉に出ない
//  ②あとからバッジ定義を増やしたとき、過去の記録で成立するものを「遡及獲得」として必ず通知する
import { planBadgeUnlocks, type BadgeUnlockInput } from '@/lib/achievements';

const TODAY = '2026-09-01';

function input(over: Partial<BadgeUnlockInput> = {}): BadgeUnlockInput {
  return {
    defIds: ['streak3', 'streak7', 'photo1'],
    ok: {},
    earned: {},
    seen: ['streak3', 'streak7', 'photo1'],
    today: TODAY,
    ...over,
  };
}

describe('planBadgeUnlocks', () => {
  it('この端末で初めての評価は、条件を満たしていても静かに確定する（再インストール時の暴発防止）', () => {
    const r = planBadgeUnlocks(input({
      seen: null, earned: {},
      ok: { streak3: true, streak7: true, photo1: true },
    }));
    expect(r.firstEver).toBe(true);
    expect(r.unlocks).toEqual([]);                       // 祝祭はゼロ
    expect(r.silent).toEqual(['streak3', 'streak7', 'photo1']);
    expect(r.earned).toEqual({ streak3: TODAY, streak7: TODAY, photo1: TODAY }); // 獲得自体は済ませる
    expect(r.seen).toEqual(['streak3', 'streak7', 'photo1']);
  });

  it('2回目以降の評価では、新たな条件成立を通知する（retro=false）', () => {
    const r = planBadgeUnlocks(input({
      earned: { streak3: '2026-08-20' },
      ok: { streak3: true, streak7: true },
    }));
    expect(r.firstEver).toBe(false);
    expect(r.unlocks).toEqual([{ id: 'streak7', retro: false }]);
    expect(r.earned.streak3).toBe('2026-08-20');         // 既存の獲得日は書き換えない
    expect(r.earned.streak7).toBe(TODAY);
  });

  it('あとから増えた定義は、過去の記録で成立していれば遡及獲得として通知する（retro=true）', () => {
    const r = planBadgeUnlocks(input({
      defIds: ['streak3', 'streak7', 'photo1', 'newbie1', 'newbie2'],
      seen: ['streak3', 'streak7', 'photo1'],            // 旧バージョンで評価した集合
      earned: { streak3: '2026-08-20' },
      ok: { streak3: true, newbie1: true, newbie2: true },
    }));
    expect(r.unlocks).toEqual([
      { id: 'newbie1', retro: true },
      { id: 'newbie2', retro: true },
    ]);
    expect(r.unlocks.length).toBeGreaterThan(1);          // 複数はまとめ文（「2つのバッジを獲得しました」）
    expect(r.seen).toEqual(['streak3', 'streak7', 'photo1', 'newbie1', 'newbie2']);
  });

  it('増えた定義でも条件を満たさなければ通知せず、評価済みとして記録するだけ', () => {
    const r = planBadgeUnlocks(input({
      defIds: ['streak3', 'newbie1'],
      seen: ['streak3'],
      earned: { streak3: '2026-08-20' },
      ok: { newbie1: false },
    }));
    expect(r.unlocks).toEqual([]);
    expect(r.earned.newbie1).toBeUndefined();
    expect(r.seen).toContain('newbie1');                 // 次に成立したときは通常の獲得として通知される
  });

  it('既存ユーザーの初回移行（seenキーが無く獲得履歴はある）は本物の獲得を取り落とさない', () => {
    const r = planBadgeUnlocks(input({
      seen: null,
      earned: { streak3: '2026-08-20' },                  // 過去の評価で獲得済み＝初評価ではない
      ok: { streak3: true, streak7: true },
    }));
    expect(r.firstEver).toBe(false);
    expect(r.unlocks).toEqual([{ id: 'streak7', retro: false }]);   // 移行時に遡及扱いにはしない
    expect(r.seen).toEqual(['streak3', 'streak7', 'photo1']);
  });

  it('獲得済みバッジは条件を満たし続けても再通知しない', () => {
    const r = planBadgeUnlocks(input({
      earned: { streak3: '2026-08-20', streak7: '2026-08-24', photo1: '2026-08-01' },
      ok: { streak3: true, streak7: true, photo1: true },
    }));
    expect(r.unlocks).toEqual([]);
    expect(r.silent).toEqual([]);
    expect(r.earned).toEqual({ streak3: '2026-08-20', streak7: '2026-08-24', photo1: '2026-08-01' });
  });

  it('定義から消えたidも評価済み集合に残す（再登場で遡及通知が再発しない）', () => {
    const r = planBadgeUnlocks(input({
      defIds: ['streak3'],
      seen: ['streak3', 'retired1'],
      earned: { streak3: '2026-08-20' },
      ok: { streak3: true },
    }));
    expect(r.seen).toEqual(['streak3', 'retired1']);
  });

  it('入力のearnedを破壊しない（呼び出し側のキャッシュを壊さない）', () => {
    const earned = { streak3: '2026-08-20' };
    planBadgeUnlocks(input({ earned, ok: { streak7: true } }));
    expect(earned).toEqual({ streak3: '2026-08-20' });
  });
});
