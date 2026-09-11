/// <reference types="node" />
// ソースを読んで規約違反を探すテストなのでNodeのfs/pathを使う（themeConvention.test.ts と同じ作法）。
//
// profiles への書き込みの規約（QA 2026-09-10 P0-3 の再発防止）。
//
// 事故の形: `profiles` に行が無いユーザーに対して `.update().eq('id', uid)` を投げると、
// PostgREST は **204 / 0行更新 / error === null** を返す。アプリはこれを成功として扱うので、
//   ・プロフィール編集が「保存しました。」と出しながら入力を捨てる
//   ・規約同意が記録されず、起動のたびに全画面ゲートが出る無限ループになる
//   ・食事の制約（アレルギー）が保存されない ＝ 安全に直結
// という壊れ方をした。目視レビューでは `update` と `upsert` の1文字差を必ず見落とすので、
// ここで機械的に落とす。
//
// 規約: `from('profiles')` に続く書き込みは
//   (a) `upsert(...)` を使う（行が無ければ作る）か、
//   (b) `update(...)` なら `.select(...)` を付けて**影響行数を確認する**（0行なら失敗として扱う）
// のどちらか。`app/(tabs)/coach.tsx` の `.update(...).eq(...).select('user_id')` が正しい先例。
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..');

// 【一時的な例外】マージ後に必ず外すこと。
// settings.tsx のプロフィール保存（`fix/qa-validation` ブランチで upsert 化している最中）。
// 両ブランチが main に入った時点でこの配列を空にし、このテストを本来の全域チェックへ戻す。
const TEMPORARY_ALLOW: readonly string[] = [];   // 2026-09-11 fix/qa-validation マージ済み → 空

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

/** `from('profiles')` から文末（;）までのチェーン1本を切り出す */
function profileChains(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/\.from\(\s*'profiles'\s*\)/g)) {
    const start = m.index ?? 0;
    const end = src.indexOf(';', start);
    out.push(src.slice(start, end === -1 ? Math.min(src.length, start + 600) : end));
  }
  return out;
}

describe('profiles への書き込みの規約', () => {
  it('update を使うなら .select( で影響行数を確認する（さもなくば upsert）', () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      if (TEMPORARY_ALLOW.includes(rel(f))) continue;
      for (const chain of profileChains(readFileSync(f, 'utf8'))) {
        if (!/\.update\s*\(/.test(chain)) continue;          // select や upsert だけの行は対象外
        if (/\.select\s*\(/.test(chain)) continue;           // 影響行数を見ている＝OK
        offenders.push(`${rel(f)}: from('profiles').update(...) に .select( が無い（0行更新を成功と誤認する）`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('一時的な例外リストは、そこに実際の違反がある間だけ意味を持つ（掃除し忘れの検出）', () => {
    // 例外に挙げたファイルが既に直っている／存在しないなら、リストから外す時期が来ている
    const stale = TEMPORARY_ALLOW.filter((name) => {
      const f = FILES.find((p) => rel(p) === name);
      if (!f) return true;   // ファイルごと消えた
      return !profileChains(readFileSync(f, 'utf8'))
        .some((c) => /\.update\s*\(/.test(c) && !/\.select\s*\(/.test(c));
    });
    expect({
      stale,
      hint: 'TEMPORARY_ALLOW から外してください（fix/qa-validation のマージ後に必ず実施）',
    }).toEqual({ stale: [], hint: 'TEMPORARY_ALLOW から外してください（fix/qa-validation のマージ後に必ず実施）' });
  });

  it('走査そのものが空振りしていない（from(\'profiles\') を1つ以上見つけている）', () => {
    const total = FILES.reduce((n, f) => n + profileChains(readFileSync(f, 'utf8')).length, 0);
    expect(total).toBeGreaterThan(5);
  });
});
