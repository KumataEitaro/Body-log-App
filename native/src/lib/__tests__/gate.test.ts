/// <reference types="node" />
// 王冠ゲーティングが「嘘をつかない」ことの固定。
//  ・サーバーのプラン上限（root lib/calc.ts AI_LIMITS_ENABLED）が眠っている間は王冠を出さない
//  ・アプリ側の鏡（native/src/lib/calc.ts AI_LIMITS_ENABLED）はサーバー側と同じ値でなければならない
import { readFileSync } from 'fs';
import { join } from 'path';
import { isGated } from '../gate';
import { AI_LIMITS_ENABLED } from '../calc';

function readFlag(p: string): boolean {
  const src = readFileSync(p, 'utf8');
  const m = /export const AI_LIMITS_ENABLED\s*=\s*(true|false)/.exec(src);
  if (!m) throw new Error(`AI_LIMITS_ENABLED が見つからない: ${p}`);
  return m[1] === 'true';
}

describe('isGated（王冠を出す条件）', () => {
  it('上限が点火していれば: 無料/ライト/未取得はロック、スタンダード以上と管理者は開放', () => {
    expect(isGated(true, false, null, true)).toBe(true);
    expect(isGated(true, false, 'free', true)).toBe(true);
    expect(isGated(true, false, 'lite', true)).toBe(true);
    expect(isGated(true, false, 'standard', true)).toBe(false);
    expect(isGated(true, false, 'premium', true)).toBe(false);
    expect(isGated(true, true, 'free', true)).toBe(false);
  });
  it('課金基盤が無効なビルド（RCキー未設定）では何もロックしない', () => {
    expect(isGated(false, false, 'free', true)).toBe(false);
  });
  it('上限が眠っている（AI_LIMITS_ENABLED=false）間は、課金有効ビルドでも王冠を出さない', () => {
    expect(isGated(true, false, 'free', false)).toBe(false);
    expect(isGated(true, false, null, false)).toBe(false);
  });
  it('既定引数はアプリ側の AI_LIMITS_ENABLED を見る', () => {
    expect(isGated(true, false, 'free')).toBe(AI_LIMITS_ENABLED);
  });
});

describe('AI_LIMITS_ENABLED の鏡（サーバーとアプリで同じ値）', () => {
  it('root lib/calc.ts と native/src/lib/calc.ts の値が一致する', () => {
    const native = readFlag(join(__dirname, '..', 'calc.ts'));
    const server = readFlag(join(__dirname, '..', '..', '..', '..', 'lib', 'calc.ts'));
    expect(native).toBe(server);
    expect(native).toBe(AI_LIMITS_ENABLED);
  });
});
