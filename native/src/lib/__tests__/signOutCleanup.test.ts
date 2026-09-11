/// <reference types="node" />
// サインアウト時の端末データ掃除を固定するテスト（QA 2026-09-10 P1-3 / P1-5 の再発防止）。
//
// 事故の形: ログアウト・アカウント切替・退会のどれでも端末のデータを消しておらず、
// 同じ端末で別アカウントにログインすると、前の人のAI相談の全会話・アレルギー設定・
// 90日分の体重/摂取/睡眠・プラン判定がそのまま見えていた。
//
// このファイルは2つを固定する:
//  1. 掃除の結果、許可リスト以外のキーが1つも残らない
//  2. **native/src に現れる 'bl-…' のキー literal が、許可リストか掃除目録のどちらかに必ず載っている**
//     （新しいキーを足した人に「これは個人データか、端末の設定か」を必ず考えさせるための規約テスト）
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import {
  clearLocalUserState, keysToRemove, shouldKeep,
  KEEP_KEYS, KEEP_PREFIXES, CLEARED_KEYS,
} from '../signOutCleanup';
import { peekGatePlan, applyEntitlement } from '../gate';

const SRC = join(__dirname, '..', '..');

beforeEach(async () => { await AsyncStorage.clear(); jest.clearAllMocks(); });

describe('許可リストの判定', () => {
  it('端末の設定（テーマ・言語・単位・起動エラー・配信物・食品DBキャッシュ）は残す', () => {
    expect(shouldKeep('bl-theme')).toBe(true);
    expect(shouldKeep('bl-locale')).toBe(true);
    expect(shouldKeep('bl-units')).toBe(true);
    expect(shouldKeep('bl-boot-errors')).toBe(true);
    expect(shouldKeep('bl-remote-content')).toBe(true);
    expect(shouldKeep('bl-fooddb-とりむね')).toBe(true);   // 接頭辞
  });

  it('未送信のオフラインキューは消さない（圏外で記録したものが失われる）', () => {
    expect(shouldKeep('bl-offline-logs')).toBe(true);
    expect(shouldKeep('bl-offline-dropped')).toBe(true);
  });

  it('個人データは残さない（許可リストに載せていない＝消す側）', () => {
    for (const k of ['bl-coach-history', 'bl-diet', 'bl-day-features', 'bl-cycle-enabled',
                     'bl-laws', 'bl-badges-earned', 'bl-health-last-sync', 'bl-terms-version']) {
      expect({ k, keep: shouldKeep(k) }).toEqual({ k, keep: false });
    }
  });

  it('知らないキーは既定で消す側に倒れる（許可リスト方式）', () => {
    expect(shouldKeep('bl-brand-new-key-2027')).toBe(false);
    expect(keysToRemove(['bl-theme', 'bl-brand-new-key-2027'])).toEqual(['bl-brand-new-key-2027']);
  });
});

describe('clearLocalUserState', () => {
  it('掃除後に許可リスト以外のキーが1つも残らない', async () => {
    await AsyncStorage.multiSet([
      ['bl-theme', 'dark'],
      ['bl-locale', 'ja'],
      ['bl-units', 'metric'],
      ['bl-boot-errors', '[]'],
      ['bl-remote-content', '{}'],
      ['bl-fooddb-バナナ', '{}'],
      ['bl-offline-logs', '[]'],
      ['bl-offline-dropped', '2'],
      // ここから下は前の人のデータ。1つでも残ったら情報漏えい
      ['bl-coach-history', '[{"role":"user","text":"過食が止まりません"}]'],
      ['bl-diet', '{"modes":["egg"]}'],
      ['bl-day-features', '[{"weight":62.4}]'],
      ['bl-cycle-enabled', '1'],
      ['bl-badges-earned', '["streak7"]'],
      ['bl-health-last-sync', '2026-09-09T00:00:00Z'],
      ['bl-guide-done:user-A', '1'],       // per-uidキー（前方一致ではなく「許可リストに無い」で消える）
      ['bl-day-plan:2026-09-10', '{}'],
      ['bl-terms-version', '2026-09-01'],
    ]);

    await clearLocalUserState();

    const left = (await AsyncStorage.getAllKeys()).slice().sort();
    expect(left).toEqual([
      'bl-boot-errors', 'bl-fooddb-バナナ', 'bl-locale', 'bl-offline-dropped',
      'bl-offline-logs', 'bl-remote-content', 'bl-theme', 'bl-units',
    ].sort());
  });

  it('予約済みのローカル通知も取り消す（IDのキーだけ消して予約を残さない）', async () => {
    await clearLocalUserState();
    expect(Notifications.cancelAllScheduledNotificationsAsync).toHaveBeenCalled();
  });

  it('プラン判定のモジュールキャッシュが無料に戻る（前の人の課金が残らない・P1-5）', async () => {
    applyEntitlement('premium');
    expect(peekGatePlan()).toBe('premium');
    await clearLocalUserState();
    expect(peekGatePlan()).toBeNull();
  });

  it('キーが1つも無くても例外を投げない', async () => {
    await expect(clearLocalUserState()).resolves.toBeUndefined();
  });
});

// ===== 規約テスト: 新しいキーを分類し忘れたら落ちる =====
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== '__tests__') sourceFiles(p, out); }
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/** 目録のうち「接頭辞として書かれたもの」（末尾が : か -）は前方一致で拾う */
function covered(key: string): boolean {
  if (KEEP_KEYS.includes(key)) return true;
  if (KEEP_PREFIXES.some((p) => key.startsWith(p))) return true;
  if (CLEARED_KEYS.includes(key)) return true;
  return CLEARED_KEYS.some((c) => /[:-]$/.test(c) && key.startsWith(c));
}

describe('規約: bl- キーは必ず「残す」か「消す」のどちらかに分類されている', () => {
  it('native/src の bl- キー literal が全て目録に載っている', () => {
    const files = sourceFiles(SRC);
    const found = new Map<string, string>();   // key -> 最初に見つけたファイル
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/'(bl-[A-Za-z0-9_.:-]*)'/g)) {
        if (!found.has(m[1])) found.set(m[1], f.slice(SRC.length + 1).replace(/\\/g, '/'));
      }
    }
    expect(found.size).toBeGreaterThan(50);   // 走査が空振りしていないか
    const unclassified = [...found.entries()]
      .filter(([k]) => !covered(k))
      .map(([k, f]) => `${k}（${f}）→ lib/signOutCleanup.ts の KEEP_KEYS か CLEARED_KEYS に足す`);
    expect(unclassified).toEqual([]);
  });

  it('目録に矛盾が無い（同じキーを「残す」と「消す」の両方に書いていない）', () => {
    const both = KEEP_KEYS.filter((k) => CLEARED_KEYS.includes(k));
    expect(both).toEqual([]);
  });
});
