// 「何を食べる？」のプロンプト文面テスト（lib/whatToEatPrompt.ts）。
// 文脈→3つの型（item/menu/snack）の切り替えと、送った文脈が確実にプロンプトへ入ることを守る。
import { describe, it, expect } from 'vitest';
import { buildWhatToEatPrompt, eatPromptKind, sanitizeEatPicks, slotOfHour, EAT_CONTEXTS } from '../lib/whatToEatPrompt';

const base = { remainingKcal: 620, pRemain: 40, fRemain: 12, cRemain: 80, slot: 'noon' as const, purposeKey: 'cut_std', outLang: '' };

describe('eatPromptKind / slotOfHour', () => {
  it('5つの文脈が3つの型に畳まれる', () => {
    expect(EAT_CONTEXTS.map(eatPromptKind)).toEqual(['item', 'item', 'menu', 'snack', 'item']);
  });
  it('JSTの時→8区分（境界は開始を含む）', () => {
    expect(slotOfHour(7)).toBe('morning');
    expect(slotOfHour(23)).toBe('lateNight');
    expect(slotOfHour(3)).toBe('lateNight');
    expect(slotOfHour(13)).toBe('noon');
  });
});

describe('buildWhatToEatPrompt', () => {
  it('コンビニは「商品カテゴリ・＋でつなぐ」型、自炊は「主菜＋副菜＋主食」型、間食は「200kcal以内」型', () => {
    const conv = buildWhatToEatPrompt({ ...base, context: 'convenience' });
    expect(conv).toContain('コンビニの一品');
    expect(conv).toContain('商品カテゴリ');
    expect(conv).not.toContain('主菜＋副菜＋主食');
    const cook = buildWhatToEatPrompt({ ...base, context: 'cook' });
    expect(cook).toContain('自炊の献立');
    expect(cook).toContain('主菜＋副菜＋主食');
    const snack = buildWhatToEatPrompt({ ...base, context: 'snack' });
    expect(snack).toContain('200kcal以内');
    expect(snack).toContain('次の食事を邪魔しない');
  });

  it('残量・PFC・時間帯・一言・直近の食材・マイ食品・法則がプロンプトに入る', () => {
    const p = buildWhatToEatPrompt({
      ...base, context: 'eatout', note: '魚がいい', recentTags: '米: 約540g・鶏肉: 約300g',
      myFoods: ['オートミール', 'プロテイン'], insights: '【本人の法則（端末内の相関分析・因果ではない）】\n・睡眠不足の翌日に食べすぎ',
    });
    expect(p).toContain('620kcal');
    expect(p).toContain('たんぱく質の残り: 40g');
    expect(p).toContain('脂質の残り: 12g');
    expect(p).toContain('炭水化物の残り: 80g');
    expect(p).toContain('昼（12〜14時）');
    expect(p).toContain('「魚がいい」');
    expect(p).toContain('米: 約540g');
    expect(p).toContain('偏っている食材は3案すべての主役にしない');
    expect(p).toContain('オートミール / プロテイン');
    expect(p).toContain('本人の法則');
    expect(p).toContain('"picks"');
    expect(p).not.toContain('dietFlag');   // 制約未設定なら応答形は従来どおり
  });

  it('PFC未計算（null）なら行ごと出さず、超過は明記し、制約・妊娠中・再試行の行が条件付きで入る', () => {
    const p = buildWhatToEatPrompt({
      ...base, context: 'quick', remainingKcal: -120, pRemain: null, fRemain: null, cRemain: null,
      constraintsNote: 'えび アレルギー\n予算は500円', maternity: true, retry: true, dietBlock: '\n【食事の制約】\n- テスト\n',
    });
    expect(p).toContain('-120kcal（すでに超過している）');
    expect(p).not.toContain('たんぱく質の残り');
    expect(p).toContain('えび アレルギー / 予算は500円');
    expect(p).toContain('妊娠中または授乳中');
    expect(p).toContain('JSONとして読めませんでした');
    expect(p).toContain('"dietFlag":"none"');
    expect(p).toContain('5分以内');
  });

  it('増量(bulk)は高カロリー・高たんぱくに反転する。出力言語の指示は日本語以外のときだけ', () => {
    const p = buildWhatToEatPrompt({ ...base, context: 'cook', purposeKey: 'bulk', outLang: 'English（English）' });
    expect(p).toContain('目的は増量');
    expect(p).toContain('高たんぱく');
    expect(p).toContain('出力言語');
    expect(buildWhatToEatPrompt({ ...base, context: 'cook' })).not.toContain('出力言語');
  });
});

describe('sanitizeEatPicks', () => {
  it('3案まで・数値は整数に丸め・範囲外のkcalは案ごと落とす・dietFlagはhigh/maybeだけ', () => {
    const out = sanitizeEatPicks([
      { name: ' A ', estKcal: 300.4, p: 20.6, f: 8, c: 40, reason: 'r', dietFlag: 'maybe' },
      { name: 'B', estKcal: 50000, p: 1, f: 1, c: 1 },
      { name: 'C', estKcal: 100, p: 'x', f: 1, c: 1, dietFlag: 'none' },
      { name: 'D', estKcal: 100, p: 1, f: 1, c: 1 },
      { name: 'E', estKcal: 100, p: 1, f: 1, c: 1 },
    ]);
    expect(out.map((p) => p.name)).toEqual(['A', 'C', 'D']);
    expect(out[0]).toMatchObject({ estKcal: 300, p: 21, dietFlag: 'maybe' });
    expect(out[1].p).toBe(0);
    expect('dietFlag' in out[1]).toBe(false);
    expect(sanitizeEatPicks('nope')).toEqual([]);
  });
});
