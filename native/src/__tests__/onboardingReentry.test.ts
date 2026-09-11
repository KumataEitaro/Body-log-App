/// <reference types="node" />
// 「初期設定に戻れる道が1本ある」ことを固定する（QA 2026-09-10 P1-1 の再発防止）。
//
// 事故の形: オンボーディングのウィザードで「あとで設定」を押すと bl-onboard-done が立つ。
// /onboarding への遷移は components/GuideTour.tsx の1か所だけで、そこは bl-onboard-done が
// false のときにしか行かない。つまり一度スキップすると **二度とウィザードに入れない**。
// P0-3（profiles行が無いと保存が捨てられる）と重なると、その人は目標カロリーを永久に得られない。
import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..');

describe('初期設定への復帰路', () => {
  it('設定画面（app/settings.tsx）から /onboarding へ遷移できる', () => {
    const src = readFileSync(join(SRC, 'app', 'settings.tsx'), 'utf8');
    expect(/push\(\s*'\/onboarding'/.test(src)).toBe(true);
  });

  it('復帰路は push で開く（replace だと設定画面に戻れなくなる）', () => {
    const src = readFileSync(join(SRC, 'app', 'settings.tsx'), 'utf8');
    expect(/replace\(\s*'\/onboarding'/.test(src)).toBe(false);
  });
});
