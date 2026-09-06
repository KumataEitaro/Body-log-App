// 運動タブの記録入口（2026-09-06）: 「筋トレを記録する」「運動を記録する」は左右2枚のタイルとして
// ヘッダー（並び替え・非表示の対象外）に固定する。スクロールしないと記録に届かない状態に戻さない。
import fs from 'fs';
import path from 'path';

const SRC = fs.readFileSync(path.resolve(__dirname, '..', 'app', '(tabs)', 'training.tsx'), 'utf8');

describe('運動タブ: 記録の入口は2枚のタイルで最上部に固定', () => {
  it('筋トレ／運動のタイルが headerJSX 側にある（testID tile-lift / tile-activity）', () => {
    expect(SRC).toMatch(/testID="tile-lift"/);
    expect(SRC).toMatch(/testID="tile-activity"/);
    expect(SRC).toMatch(/const tilesJSX = \(/);
    expect(SRC).toMatch(/\{!editing && tilesJSX\}/);
  });

  it('旧カード quick / liftInput は並び替え対象から外れている（入口が二重にならない）', () => {
    expect(SRC).toMatch(/const EX_CARDS = \['move', 'rest'\];/);
    expect(SRC).not.toMatch(/if \(key === 'quick'\)/);
    expect(SRC).not.toMatch(/if \(key === 'liftInput'\)/);
  });

  it('ガイドツアーの照射先（trainInput / liftInput）はタイルに付いている', () => {
    expect(SRC).toMatch(/ref=\{liftTarget\}[^>]*testID="tile-lift"/s);
    expect(SRC).toMatch(/ref=\{trainInputTarget\}[^>]*testID="tile-activity"/s);
  });

  it('きょうの動きの週バー・時間帯別は畳める（既定は畳む）', () => {
    expect(SRC).toMatch(/const \[moveMore, setMoveMore\] = useState\(false\);/);
    expect(SRC).toMatch(/\{moveMore && last7\.length > 1 &&/);
    expect(SRC).toMatch(/\{moveMore && hourlySteps != null/);
  });

  it('タイルは絵文字を使わない', () => {
    const tiles = SRC.slice(SRC.indexOf('const tilesJSX'), SRC.indexOf('const headerJSX'));
    expect(tiles).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });
});
