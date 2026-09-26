// モーションの規約（2026-09-26 熊田さん「びよーんと動く挙動、これいらない。もっと洗練されている表現を」）。
//
// 方針: 2026 年の静かなモーション（Apple HIG / Material 3 Expressive）＝ 150〜320ms・ease-out・オーバーシュート無し。
//   ・RN Animated.spring は使わない（friction 5〜9 は目に見えて跳ねる）→ Animated.timing + Easing.out
//     例外: bounciness: 0 / overshootClamping: true を明示したもの（押下の縮みなど跳ねない使い方）
//   ・reanimated withSpring は overshootClamping: true が必須（ドラッグの追従など）
//   ・レイアウトアニメーションの .springify() は使わない（Undo スナックバーの「びよーん」の正体だった）
//   ・Easing.bounce / elastic / back は使わない
import fs from 'fs';
import path from 'path';

const SRC = path.resolve(__dirname, '..');
function files(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(SRC, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) { if (e.name !== '__tests__') files(rel, out); continue; }
    if (/\.tsx?$/.test(e.name)) out.push(rel);
  }
  return out;
}
const ALL = [...files('app'), ...files('components'), ...files('lib')];
const read = (p: string) => fs.readFileSync(path.join(SRC, p), 'utf8');

describe('モーション規約: 跳ねるバネを使わない', () => {
  it('Animated.spring / RNAnimated.spring は bounciness: 0 か overshootClamping: true を明示したものだけ', () => {
    const bad: string[] = [];
    for (const f of ALL) {
      const src = read(f);
      for (const m of src.matchAll(/(?:RN)?Animated\.spring\(([^)]*)\)/g)) {
        if (!/bounciness:\s*0\b|overshootClamping:\s*true/.test(m[1])) bad.push(`${f}: ${m[0].slice(0, 80)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('withSpring は overshootClamping: true（SPRING 定数経由も含む）', () => {
    const bad: string[] = [];
    for (const f of ALL) {
      const src = read(f);
      if (!/withSpring\(/.test(src)) continue;
      // 定数（SPRING）を渡す書き方は、その定数に overshootClamping があるかを見る
      const consts = [...src.matchAll(/const (\w+) = \{[^}]*overshootClamping:\s*true[^}]*\}/g)].map((m) => m[1]);
      for (const m of src.matchAll(/withSpring\(([^;]*?)\)(?:;|\s+as)/g)) {
        const arg = m[1];
        const ok = /overshootClamping:\s*true/.test(arg) || consts.some((c) => new RegExp(`\\b${c}\\b`).test(arg));
        if (!ok) bad.push(`${f}: ${m[0].slice(0, 90)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('.springify() と Easing.bounce / elastic / back を使わない', () => {
    const bad: string[] = [];
    for (const f of ALL) {
      const src = read(f);
      if (/\.springify\(/.test(src)) bad.push(`${f}: springify`);
      if (/Easing\.(bounce|elastic|back)\b/.test(src)) bad.push(`${f}: Easing.bounce/elastic/back`);
    }
    expect(bad).toEqual([]);
  });
});
