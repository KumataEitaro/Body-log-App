// 運動ぶんの手動反映（lib/activeApply.ts）と、取込ぶんの自動加算除外（lib/day.ts）。2026-09-24
import { activeApplyCandidate, isMissingActiveKcalColumn } from '../activeApply';
import { dayExerciseKcal, importedExerciseKcal, isImportedExercise, summarizeDay } from '../day';

describe('activeApplyCandidate（いま押したら足せる額）', () => {
  // BMR 1,700・係数 1.3 → 想定日常活動 510kcal
  const base = { weightKg: 70, bmr: 1700, lifeFactor: 1.3 };

  it('実測 800 − 想定 510 − 手記録 0 = 290 を「実測」から', () => {
    expect(activeApplyCandidate({ ...base, measured: 800, steps: 9000, manualKcal: 0 })).toEqual({ source: 'measured', kcal: 290 });
  });

  it('手で記録した運動は差し引く（実測にも含まれている＝二重に数えない）。0 未満にはならない', () => {
    expect(activeApplyCandidate({ ...base, measured: 800, steps: null, manualKcal: 200 })).toEqual({ source: 'measured', kcal: 90 });
    expect(activeApplyCandidate({ ...base, measured: 800, steps: null, manualKcal: 500 })).toEqual({ source: 'measured', kcal: 0 });
  });

  it('想定内の動き（実測 ≤ BMR×(係数−1)）は 0', () => {
    expect(activeApplyCandidate({ ...base, measured: 400, steps: null, manualKcal: 0 })).toEqual({ source: 'measured', kcal: 0 });
  });

  it('実測が無ければ歩数からの推定（source=steps）', () => {
    const r = activeApplyCandidate({ ...base, measured: null, steps: 12000, manualKcal: 0 });
    expect(r?.source).toBe('steps');
    expect(r!.kcal).toBeGreaterThanOrEqual(0);
  });

  it('実測も歩数も無い（アプリ記録だけ）なら null ＝ ボタンを出さない', () => {
    expect(activeApplyCandidate({ ...base, measured: null, steps: null, manualKcal: 300 })).toBeNull();
    expect(activeApplyCandidate({ ...base, measured: 0, steps: 0, manualKcal: 0 })).toBeNull();
  });

  it('列が無い旧DBのエラーを見分ける', () => {
    expect(isMissingActiveKcalColumn({ code: 'PGRST204' })).toBe(true);
    expect(isMissingActiveKcalColumn({ message: "column entries.active_kcal does not exist" })).toBe(true);
    expect(isMissingActiveKcalColumn({ message: 'network' })).toBe(false);
    expect(isMissingActiveKcalColumn(null)).toBe(false);
  });
});

describe('ヘルスケア取込（⌚）は目標へ自動加算しない', () => {
  const manual = { ex: 'オフ' as const, adj: 250, text: '🏃 ランニング 30分（約250kcal消費）' };
  const imported = { ex: 'オフ' as const, adj: 400, text: '🏃 ウォーキング 60分 4km（約400kcal消費）⌚', source_id: 'hk:ABC' };
  const importedOld = { ex: 'オフ' as const, adj: 100, text: '🏃 筋トレ 40分（約100kcal消費）⌚' };   // source_id 列の無い旧行

  it('source_id か末尾の⌚で取込と判定する', () => {
    expect(isImportedExercise(manual)).toBe(false);
    expect(isImportedExercise(imported)).toBe(true);
    expect(isImportedExercise(importedOld)).toBe(true);
  });

  it('dayExerciseKcal は手記録だけ、importedExerciseKcal は取込だけを足す', () => {
    const logs = [manual, imported, importedOld];
    expect(dayExerciseKcal(logs)).toBe(250);
    expect(importedExerciseKcal(logs)).toBe(500);
  });

  it('日次サマリー（entries.adj）も取込ぶんを含まない＝過去日の目標も手記録だけで組まれる', () => {
    const s = summarizeDay([manual, imported]);
    expect(s.exKcalTotal).toBe(250);
    expect(s.adj).toBe(250);
  });
});
