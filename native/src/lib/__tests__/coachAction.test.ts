// AI提案の目標変更の検証。
//
// 元のバグは /^d{4}-d{2}-d{2}$/（\ 抜け）で、実在する日付が必ず弾かれ、
// しかも弾いたときに何も表示されないため「押しても無反応」になっていた。
// ここでは同じ形の事故（無言で終わる・おかしな値がそのまま書き込まれる）を
// 起こしうる入力を並べて、必ず ok か理由のどちらかが返ることを確かめる。
import { validateAction, isRealDate, isApplicable } from '../coachAction';

const TODAY = '2026-08-21';

describe('日付の実在チェック', () => {
  it.each(['2026-10-31', '2026-02-28', '2028-02-29'])('実在する日付を通す: %s', (d) => {
    expect(isRealDate(d)).toBe(true);
  });

  it.each([
    '2026-13-45',   // 形は合っているが存在しない（正規表現だけでは通ってしまう）
    '2026-02-30',
    '2026-00-10',
    '2026-1-1',     // 桁が足りない
    '26-10-31',
    '2026/10/31',
    '2026-10-31T00:00:00Z',
    'dddd-dd-dd',   // 壊れた正規表現が唯一通していた文字列
    '',
  ])('実在しない・形式違いを弾く: %s', (d) => {
    expect(isRealDate(d)).toBe(false);
  });

  it('文字列でない入力でも落ちない', () => {
    for (const v of [null, undefined, 20261031, {}, []]) expect(isRealDate(v)).toBe(false);
  });
});

describe('体重目標', () => {
  it('体重と目標日の提案を通す', () => {
    const r = validateAction({ kind: 'weight', target_weight: 80, target_date: '2026-10-31', label: 'x' }, TODAY);
    expect(r).toEqual({ ok: true, plan: { table: 'goals', patch: { target_weight: 80, target_date: '2026-10-31' } } });
  });

  it('目標日だけの提案も通す（体重は変えない）', () => {
    const r = validateAction({ kind: 'weight', target_date: '2026-12-31', label: 'x' }, TODAY);
    expect(r).toEqual({ ok: true, plan: { table: 'goals', patch: { target_date: '2026-12-31' } } });
  });

  it('今日を目標日にできる', () => {
    expect(validateAction({ kind: 'weight', target_date: TODAY, label: 'x' }, TODAY).ok).toBe(true);
  });

  it('過去の目標日は理由を付けて弾く', () => {
    const r = validateAction({ kind: 'weight', target_date: '2020-01-01', label: 'x' }, TODAY);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toContain('過去');
  });

  it('遠すぎる目標日を弾く', () => {
    expect(validateAction({ kind: 'weight', target_date: '2099-01-01', label: 'x' }, TODAY).ok).toBe(false);
  });

  it('桁を間違えた体重を弾く（800kgを目標にしない）', () => {
    expect(validateAction({ kind: 'weight', target_weight: 800, label: 'x' }, TODAY).ok).toBe(false);
  });

  it('負の体重を弾く', () => {
    expect(validateAction({ kind: 'weight', target_weight: -60, label: 'x' }, TODAY).ok).toBe(false);
  });

  it('変更する値がない提案を弾く（何も起きない更新を防ぐ）', () => {
    const r = validateAction({ kind: 'weight', label: 'x' }, TODAY);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toContain('変更する値');
  });
});

describe('PFC目標', () => {
  it('両方の提案を通す', () => {
    const r = validateAction({ kind: 'pfc', protein_per_kg: 2.2, fat_per_kg: 0.8, label: 'x' }, TODAY);
    expect(r).toEqual({ ok: true, plan: { table: 'goals', patch: { protein_per_kg: 2.2, fat_per_kg: 0.8 } } });
  });

  it('片方だけの提案も通す（仕様どおり省略できる）', () => {
    const r = validateAction({ kind: 'pfc', protein_per_kg: 1.8, label: 'x' }, TODAY);
    expect(r).toEqual({ ok: true, plan: { table: 'goals', patch: { protein_per_kg: 1.8 } } });
  });

  it('数値になる文字列は通す', () => {
    const r = validateAction({ kind: 'pfc', protein_per_kg: '2.0', label: 'x' }, TODAY);
    expect(r.ok && r.plan).toEqual({ table: 'goals', patch: { protein_per_kg: 2 } });
  });

  it('単位付き文字列はNaNになるので弾く', () => {
    expect(validateAction({ kind: 'pfc', protein_per_kg: '2.2g', label: 'x' }, TODAY).ok).toBe(false);
  });

  it('桁を間違えた提案を弾く（22g/kgを目標にしない）', () => {
    expect(validateAction({ kind: 'pfc', protein_per_kg: 22, label: 'x' }, TODAY).ok).toBe(false);
  });

  it('0は範囲外として弾く', () => {
    expect(validateAction({ kind: 'pfc', fat_per_kg: 0, label: 'x' }, TODAY).ok).toBe(false);
  });

  it('両方欠けた提案を弾く', () => {
    expect(validateAction({ kind: 'pfc', label: 'x' }, TODAY).ok).toBe(false);
  });
});

describe('筋トレ目標', () => {
  it('種目と重量の提案を通す', () => {
    const r = validateAction({ kind: 'training', name: 'ベンチプレス', target_kg: 100, label: 'x' }, TODAY);
    expect(r).toEqual({ ok: true, plan: { table: 'training_goals', name: 'ベンチプレス', targetKg: 100 } });
  });

  it('種目名の前後の空白は落とす', () => {
    const r = validateAction({ kind: 'training', name: '  スクワット ', target_kg: 120, label: 'x' }, TODAY);
    expect(r.ok && r.plan).toEqual({ table: 'training_goals', name: 'スクワット', targetKg: 120 });
  });

  it('種目名がない提案を弾く', () => {
    expect(validateAction({ kind: 'training', name: '   ', target_kg: 100, label: 'x' }, TODAY).ok).toBe(false);
  });

  it('長すぎる種目名を弾く', () => {
    expect(validateAction({ kind: 'training', name: 'あ'.repeat(41), target_kg: 100, label: 'x' }, TODAY).ok).toBe(false);
  });

  it('重量がない提案を弾く', () => {
    expect(validateAction({ kind: 'training', name: 'ベンチプレス', label: 'x' }, TODAY).ok).toBe(false);
  });

  it('現実的でない重量を弾く', () => {
    expect(validateAction({ kind: 'training', name: 'ベンチプレス', target_kg: 5000, label: 'x' }, TODAY).ok).toBe(false);
  });
});

describe('壊れた提案・未知の提案', () => {
  it.each([null, undefined, 'weight', 42, []])('オブジェクトでない入力を理由付きで弾く: %s', (a) => {
    const r = validateAction(a, TODAY);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason.length).toBeGreaterThan(0);
  });

  it('知らない種類は種類名を添えて弾く（実装漏れが無言にならない）', () => {
    const r = validateAction({ kind: 'kcal', target_date: '2026-10-31', label: 'x' }, TODAY);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toContain('kcal');
  });

  it('kindがない提案も弾く', () => {
    expect(validateAction({ label: 'x' }, TODAY).ok).toBe(false);
  });

  it('どんな入力でも必ず ok か reason のどちらかを返す（無言で終わらない）', () => {
    const inputs: unknown[] = [
      null, undefined, {}, { kind: 'pfc' }, { kind: 'weight' }, { kind: 'training' },
      { kind: 'unknown' }, { kind: 'weight', target_date: 'dddd-dd-dd' },
      { kind: 'pfc', protein_per_kg: NaN }, { kind: 'training', name: 'x', target_kg: Infinity },
      { kind: 'pfc', protein_per_kg: true }, { kind: 'weight', target_weight: null, target_date: null },
    ];
    for (const a of inputs) {
      const r = validateAction(a, TODAY);
      if (r.ok) expect(r.plan).toBeTruthy();
      else expect(typeof r.reason === 'string' && r.reason.length > 0).toBe(true);
    }
  });
});

describe('isApplicable', () => {
  it('通る提案だけボタンを出す判定になる', () => {
    expect(isApplicable({ kind: 'weight', target_weight: 80, label: 'x' }, TODAY)).toBe(true);
    expect(isApplicable({ kind: 'weight', target_date: '2026-13-45', label: 'x' }, TODAY)).toBe(false);
    expect(isApplicable(null, TODAY)).toBe(false);
  });
});
