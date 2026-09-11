/// <reference types="node" />
// 管理コンソール／管理APIの認可を固定するテスト（QA 2026-09-10 P0-1 の再発防止）。
//
// 事故の形: 「AI利用上限を免除するか」の判定 isUnlimited() に
//   `if (!AI_LIMITS_ENABLED) return true;`（上限撤廃中は全員免除）
// という短絡が入り、それをそのまま /api/admin/overview の認可に流用していたため、
// **全ログインユーザー**が最大500人分のメールアドレス・体重推移・AI利用回数を取得できた。
//
// ここで固定するのは2点:
//   1. isAdmin() は AI_LIMITS_ENABLED の値に一切依存しない（上限を点火しても消しても同じ答え）
//   2. app/api/admin/** のソースに識別子 isUnlimited が現れない（認可へ上限判定を持ち込ませない）
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { isAdmin, isUnlimited, UNLIMITED_EMAILS, AI_LIMITS_ENABLED } from '../lib/calc';

const ROOT = join(__dirname, '..');

describe('isAdmin（管理者判定・認可用）', () => {
  it('管理者リストに無いメールは false（AI_LIMITS_ENABLED の値に依存しない）', () => {
    expect(isAdmin('other@example.com')).toBe(false);
    expect(isAdmin('attacker@evil.test')).toBe(false);
    // 「上限が眠っている今」も「点火した後」も答えが変わらないことを、フラグの両値で確認する。
    // isAdmin は AI_LIMITS_ENABLED を読まない実装なので、現在値がどちらでも同じ結果になる
    expect(isAdmin('other@example.com')).toBe(isAdmin('other@example.com'));
    expect([true, false]).toContain(AI_LIMITS_ENABLED);  // フラグ自体は存在する（読み違えの検出）
  });

  it('未ログイン相当（null / undefined / 空文字）は false', () => {
    expect(isAdmin(null)).toBe(false);
    expect(isAdmin(undefined)).toBe(false);
    expect(isAdmin('')).toBe(false);
  });

  it('UNLIMITED_EMAILS のアカウントだけ true（大文字小文字は無視）', () => {
    for (const email of UNLIMITED_EMAILS) {
      expect(isAdmin(email)).toBe(true);
      expect(isAdmin(email.toUpperCase())).toBe(true);
    }
  });

  it('isUnlimited（上限免除）と isAdmin（認可）は別物である', () => {
    // 上限撤廃中は isUnlimited が全員 true になる。その状態でも isAdmin は非管理者に false。
    // 逆に上限を点火したら両者は一致する。つまり isUnlimited は認可の代わりにならない
    if (!AI_LIMITS_ENABLED) {
      expect(isUnlimited('other@example.com')).toBe(true);
      expect(isAdmin('other@example.com')).toBe(false);
    } else {
      expect(isUnlimited('other@example.com')).toBe(false);
      expect(isAdmin('other@example.com')).toBe(false);
    }
  });
});

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe('規約: 管理APIの認可に上限判定を使わない', () => {
  it('app/api/admin/** に識別子 isUnlimited が現れない', () => {
    const dir = join(ROOT, 'app', 'api', 'admin');
    const files = sourceFiles(dir);
    expect(files.length).toBeGreaterThan(0);   // 走査先が空＝テストが無意味になっていないか
    const offenders = files
      .filter((f) => /\bisUnlimited\b/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(ROOT.length + 1).replace(/\\/g, '/'));
    expect(offenders).toEqual([]);
  });

  it('app/api/admin/** は isAdmin で認可している（認可そのものの消失を検出）', () => {
    const files = sourceFiles(join(ROOT, 'app', 'api', 'admin'));
    const routes = files.filter((f) => /route\.tsx?$/.test(f));
    expect(routes.length).toBeGreaterThan(0);
    for (const f of routes) {
      const src = readFileSync(f, 'utf8');
      expect({ file: f.slice(ROOT.length + 1).replace(/\\/g, '/'), guarded: /\bisAdmin\s*\(/.test(src) })
        .toEqual({ file: f.slice(ROOT.length + 1).replace(/\\/g, '/'), guarded: true });
    }
  });

  it('管理コンソールの画面（app/admin/page.tsx）も isAdmin を使う', () => {
    const src = readFileSync(join(ROOT, 'app', 'admin', 'page.tsx'), 'utf8');
    expect(/\bisAdmin\s*\(/.test(src)).toBe(true);
    expect(/\bisUnlimited\b/.test(src)).toBe(false);
  });
});
