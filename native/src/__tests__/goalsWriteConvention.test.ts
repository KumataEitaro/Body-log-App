/// <reference types="node" />
// ソースを読んで規約違反を探すテストなのでNodeのfs/pathを使う。
// tsconfigの types は ["jest"] に絞ってあるため、このファイルだけ node の型を足す。
//
// 「goals テーブルに書ける場所」を許可リストで固定する（再発防止・QA P1-6）。
//
// P1-6 の中身は「同じ列を書く経路が2つあり、片方（AIコーチ）だけ安全ガードが無かった」。
// 経路が3つ目に増えたときも同じ穴が開くので、増えた瞬間にここで落とす。
// 追加すること自体は禁止ではない。増やす人が
//   ・lib/guard.assessWeightGoal を通しているか確認して
//   ・このリストに足す
// という2手順を踏むための関門。
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== '__tests__') sourceFiles(p, out); }
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}
const FILES = sourceFiles(SRC);
const rel = (p: string) => p.slice(SRC.length + 1).replace(/\\/g, '/');

/** goals に書いてよい場所。どちらも lib/guard.assessWeightGoal を通っている */
const ALLOWED = [
  'components/GoalPanel.tsx',   // 目標パネル（本人が直接書く）
  'app/(tabs)/coach.tsx',       // AIコーチの承認カード（lib/coachAction の検証を通した plan だけを書く）
];

describe('goals テーブルへの書き込み経路', () => {
  it('書き込みは許可リストのファイルだけ（増えたら安全ガードを通したか確認する）', () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      const src = readFileSync(f, 'utf8');
      // from('goals') と同じ式に続く update/upsert/insert（.select() や .eq() を挟む形も拾う）
      for (const m of src.matchAll(/from\(\s*['"]goals['"]\s*\)[\s\S]{0,200}?\.(update|upsert|insert)\s*\(/g)) {
        if (!ALLOWED.includes(rel(f))) offenders.push(`${rel(f)}: from('goals').${m[1]}(`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('許可リストのファイルは実在する（リネームで検査が空振りしない）', () => {
    const all = FILES.map(rel);
    for (const a of ALLOWED) expect(all).toContain(a);
  });

  it('安全ガードの判定式のコピーが lib/guard.ts の外に生えていない', () => {
    // bmiFloorKg / weeklyLossPace を直に呼んで自前で閾値比較する形（P1-6 以前の GoalPanel）が
    // 戻っていないか。表示用に bmiFloorKg を呼ぶのは可（比較していなければ通る）
    const offenders: string[] = [];
    for (const f of FILES) {
      if (rel(f) === 'lib/guard.ts') continue;
      const src = readFileSync(f, 'utf8');
      if (/weeklyLossPace\s*\([\s\S]{0,200}?[<>]/.test(src)) offenders.push(`${rel(f)}: weeklyLossPace の閾値比較`);
    }
    expect(offenders).toEqual([]);
  });
});
