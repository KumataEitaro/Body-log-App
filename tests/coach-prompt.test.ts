// コーチAIプロンプトの文面テスト。
// 「制約プロフィール（constraints_note）が確実に注入されること」と
// 「感情への応答（共感から始める）ルールが消えないこと」を守る（文面の細部は自由に直してよい）。
import { describe, it, expect } from 'vitest';
import { buildCoachPrompt } from '../lib/coachPrompt';

const base = { dataBlock: '【本人データ】', historyBlock: '', question: '夕食どうしよう', answerLang: '' };

describe('buildCoachPrompt: 制約プロフィール', () => {
  it('constraints_noteが「毎回必ず尊重する制約」として入る', () => {
    const p = buildCoachPrompt({ ...base, constraintsNote: 'えびアレルギー。豚肉は食べない。' });
    expect(p).toContain('恒常的な制約');
    expect(p).toContain('毎回必ず尊重する');
    expect(p).toContain('えびアレルギー');
    expect(p).toContain('豚肉は食べない');
  });

  it('未設定（空・null・undefined）なら制約行そのものを出さない', () => {
    for (const v of ['', '   ', null, undefined] as const) {
      const p = buildCoachPrompt({ ...base, constraintsNote: v });
      expect(p).not.toContain('恒常的な制約');
    }
  });

  it('改行は1行に潰し、500字に切り詰める（ルール箇条書きを壊さない）', () => {
    const p = buildCoachPrompt({ ...base, constraintsNote: 'えび\nパクチー\n' + 'あ'.repeat(600) });
    const line = p.split('\n').find((l) => l.includes('恒常的な制約'))!;
    expect(line).toContain('えび / パクチー');
    expect(line.length).toBeLessThan(600);
    // 注入部が複数行に割れていない（制約テキスト内の改行が消えている）
    expect(p).not.toContain('えび\nパクチー');
  });
});

describe('buildCoachPrompt: 感情への応答', () => {
  it('過食・自己嫌悪の報告には共感から始めるルールが入っている', () => {
    const p = buildCoachPrompt(base);
    expect(p).toContain('自己嫌悪');
    expect(p).toContain('共感');
  });
});
