// 外食メニューおすすめ（B-11）のプロンプト文面テスト。
// 「残量・目的・P残量・出力言語が確実にプロンプトへ入ること」と
// 「JSON形式の強制が消えないこと」を守る（文面の細部は自由に直してよい）。
import { describe, it, expect } from 'vitest';
import { buildMenuAdvicePrompt } from '../lib/menuAdvicePrompt';

describe('buildMenuAdvicePrompt', () => {
  it('残りカロリーとP残量がプロンプトに入る', () => {
    const p = buildMenuAdvicePrompt({ remainingKcal: 620, purposeKey: 'cut_std', pRemain: 43, outLang: '' });
    expect(p).toContain('620kcal');
    expect(p).toContain('43g');
    expect(p).toContain('メニュー表');
  });

  it('減量目的は「残量内・満足感」の方針になる', () => {
    const p = buildMenuAdvicePrompt({ remainingKcal: 500, purposeKey: 'cut_lean', pRemain: null, outLang: '' });
    expect(p).toContain('目的は減量');
    expect(p).toContain('残りカロリー内に収まり');
    expect(p).toContain('満足感');
    // P残量が無ければ行ごと出さない（「不明」とAIに推測させない）
    expect(p).not.toContain('たんぱく質の残り');
  });

  it('増量(bulk)は「残量を埋める高カロリー・高たんぱく」の方針に反転する', () => {
    const p = buildMenuAdvicePrompt({ remainingKcal: 1200, purposeKey: 'bulk', pRemain: 80, outLang: '' });
    expect(p).toContain('目的は増量');
    expect(p).toContain('高カロリー');
    expect(p).toContain('高たんぱく');
    expect(p).not.toContain('目的は減量');
  });

  it('ゆる目的(easy)は続けやすさ優先・多少の超過を許容する', () => {
    const p = buildMenuAdvicePrompt({ remainingKcal: 400, purposeKey: 'easy', pRemain: null, outLang: '' });
    expect(p).toContain('ゆるく健康的に');
    expect(p).toContain('続けやすさ');
  });

  it('目的未選択は減量方針にフォールバックする', () => {
    const p = buildMenuAdvicePrompt({ remainingKcal: 300, purposeKey: null, pRemain: null, outLang: '' });
    expect(p).toContain('目的は減量');
  });

  it('残量がマイナスなら超過中であることを明示する', () => {
    const p = buildMenuAdvicePrompt({ remainingKcal: -250, purposeKey: 'cut_std', pRemain: null, outLang: '' });
    expect(p).toContain('-250kcal');
    expect(p).toContain('すでに超過');
  });

  it('出力言語の指定が入る（日本語なら入らない）', () => {
    const en = buildMenuAdvicePrompt({ remainingKcal: 500, purposeKey: 'cut_std', pRemain: null, outLang: 'English（English）' });
    expect(en).toContain('出力言語');
    expect(en).toContain('English');
    const ja = buildMenuAdvicePrompt({ remainingKcal: 500, purposeKey: 'cut_std', pRemain: null, outLang: '' });
    expect(ja).not.toContain('出力言語');
  });

  it('JSON形式（picks/estKcal/reason/note）の強制が入る', () => {
    const p = buildMenuAdvicePrompt({ remainingKcal: 500, purposeKey: 'cut_std', pRemain: null, outLang: '' });
    expect(p).toContain('"picks"');
    expect(p).toContain('"estKcal"');
    expect(p).toContain('"reason"');
    expect(p).toContain('"note"');
    expect(p).toContain('JSON形式のみ');
  });

  it('残量は四捨五入した整数でプロンプトに入る', () => {
    const p = buildMenuAdvicePrompt({ remainingKcal: 619.6, purposeKey: 'cut_std', pRemain: 42.4, outLang: '' });
    expect(p).toContain('620kcal');
    expect(p).toContain('42g');
  });
});
