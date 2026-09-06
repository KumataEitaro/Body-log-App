// 概要タブの並びは固定（2026-09-06）。行の長押しで揺れる編集モード・並び替え・非表示（⊖/⊕）は
// 完全に撤去した。「揺れる」「並べ替え」が復活したら落とす。
import fs from 'fs';
import path from 'path';

const SRC = fs.readFileSync(path.resolve(__dirname, '..', 'app', '(tabs)', 'changes.tsx'), 'utf8');

describe('概要タブ: 並び替え・長押し編集モードは存在しない', () => {
  it('ReorderableCards / AddCardSheet を import も描画もしていない（コメントの言及は許す）', () => {
    expect(SRC).not.toMatch(/import ReorderableCards/);
    expect(SRC).not.toMatch(/<ReorderableCards/);
    expect(SRC).not.toMatch(/import \{[^}]*AddCardSheet/);
    expect(SRC).not.toMatch(/<AddCardSheet/);
  });

  it('編集モードの state・保存キー・長押しハンドラが無い', () => {
    expect(SRC).not.toMatch(/setEditing\(/);
    expect(SRC).not.toMatch(/onLongPress=/);
    expect(SRC).not.toMatch(/'bl-order-all2'|'bl-hidden-all2'/);
    expect(SRC).not.toMatch(/hideCard|showCard|resetOrder|finishEditing/);
  });

  it('行はセクション順で固定（visibleOrder は ALL_ORDER_DEFAULT から導く）', () => {
    expect(SRC).toMatch(/const visibleOrder = normalizeOrder\(ALL_ORDER_DEFAULT\)\.filter/);
  });

  it('一覧は素の ScrollView で、ヘッダーは stickyHeaderIndices で固定', () => {
    expect(SRC).toMatch(/stickyHeaderIndices=\{STICKY_FIRST\}/);
    expect(SRC).toMatch(/guide\.registerScroller\('\/changes'/);
  });
});
