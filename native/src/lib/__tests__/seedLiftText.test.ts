// デモデータ（supabase/seed-demo.sql）が作る筋トレのテキストを、
// **アプリ自身の解析器で読めること**を機械的に確かめる（2026-09-16）。
//
// 事故の形: seed が各種目の後ろに「🎉自己ベスト更新」を足していた。
// `parseLiftText` の正規表現は行末 `$` で終端を固定しているので、
// 後ろに何か付いた種目は一致せず **`continue` で黙って捨てられる**。
// つまり **自己ベストを出した種目ほど筋トレ履歴から消える**、という狙いと正反対の結果になっていた。
// 実行するまで誰も気づけず、スクリーンショットを撮る段になって発覚する類の壊れ方。
//
// 自己ベストはアプリが記録から自分で計算する（lift-session の RM フィードバック・実績ページ）ので、
// テキストに書く必要はそもそも無い。
import fs from 'fs';
import path from 'path';
import { parseLiftText } from '../liftLog';

const SEED = path.resolve(__dirname, '..', '..', '..', '..', 'supabase', 'seed-demo.sql');

describe('parseLiftText: 後ろに文字が付くと種目ごと落ちる（前提の確認）', () => {
  it('素直な形は読める', () => {
    const r = parseLiftText('🏋️ ベンチプレス 80kg×8×3、スクワット 100kg×5×3');
    expect(r.map((e) => e.name)).toEqual(['ベンチプレス', 'スクワット']);
    expect(r[0]).toMatchObject({ kg: 80, reps: 8, sets: 3 });
  });

  it('種目の後ろに注記を足すと、その種目は読めない（＝seed が足してはいけない理由）', () => {
    const r = parseLiftText('🏋️ ベンチプレス 85kg×4×3 🎉自己ベスト更新、スクワット 117.5kg×4×3');
    expect(r.map((e) => e.name)).toEqual(['スクワット']);   // ベンチプレスが消える
  });

  it('注記を独立した「、」区切りの1片にすれば、種目は全部読める', () => {
    const r = parseLiftText('🏋️ ベンチプレス 85kg×4×3、スクワット 117.5kg×4×3、（デロード週）');
    expect(r.map((e) => e.name)).toEqual(['ベンチプレス', 'スクワット']);
  });
});

describe('seed-demo.sql の筋トレテキストの組み立て方', () => {
  const sql = fs.readFileSync(SEED, 'utf8');

  it('種目の断片は「×3」で終わる（後ろに何も足さない）', () => {
    // lift_txt に種目を足している行を取り出して、その行で連結が終わっていることを見る
    const lines = sql.split(/\r?\n/).filter((l) => l.includes('lift_txt := lift_txt || lift_names['));
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) {
      expect(l).toMatch(/\|\| reps \|\| '×3';\s*$/);
      // 「×3」のあとに何かを連結していたら落とす（今回の事故そのもの）
      expect(l).not.toMatch(/'×3'\s*\|\|/);
    }
  });

  it('自己ベストの印をテキストに書き込んでいない（アプリが自分で計算する）', () => {
    // コメント行は「なぜ書いてはいけないか」を説明しているので除いて見る（実行される行だけを見る）
    const build = sql
      .slice(sql.indexOf("lift_txt := '🏋️ '"), sql.indexOf('ex_total := ex_total + 150'))
      .split(/\r?\n/)
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n');
    expect(build).not.toMatch(/自己ベスト/);
    expect(build).not.toMatch(/🎉/);
  });

  it('補足（デロード週）は独立した「、」区切りの1片として足している', () => {
    expect(sql).toMatch(/lift_txt \|\| '、（デロード週）'/);
  });

  it('筋トレのテキストを組み立てているのはこの1か所だけ（増えたらここも見直す）', () => {
    const starts = (sql.match(/lift_txt := '🏋️ '/g) ?? []).length;
    expect(starts).toBe(1);
  });
});
