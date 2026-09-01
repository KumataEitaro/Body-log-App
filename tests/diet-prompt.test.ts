// 食事の制約（B-18）のプロンプト注入テスト。docs/DIET-MODES.md §2 / §6。
//
// ここで守るのは「断定させない」ことと「未設定の人のプロンプトを一字も変えない」こと。
// 文面の細部は直してよいが、禁止事項（安全・食べられます・noneでも含まれていないと書かない）が
// 消えたらこのテストが落ちる。
import { describe, it, expect } from 'vitest';
import { buildDietBlock, dietModeNames, dietAiPlan } from '../lib/dietPrompt';
import { buildParseFoodPrompt } from '../lib/parseFoodPrompt';
import { buildMenuAdvicePrompt } from '../lib/menuAdvicePrompt';

const block = (modes: unknown, custom?: unknown) =>
  buildDietBlock({ modes, custom, noun: '品目', field: 'items' });

describe('dietModeNames', () => {
  it('既知のキーだけを日本語名にし、未知値・重複・非配列を落とす', () => {
    expect(dietModeNames(['vegan', 'gluten_free'])).toHaveLength(2);
    expect(dietModeNames(['vegan', 'vegan', 'nope'])).toHaveLength(1);
    expect(dietModeNames(null)).toEqual([]);
    expect(dietModeNames('vegan')).toEqual([]);
  });
});

describe('dietAiPlan', () => {
  it('AI判定はスタンダード以上（無料・ライトは端末内の辞書判定だけ）', () => {
    expect(dietAiPlan('standard')).toBe(true);
    expect(dietAiPlan('premium')).toBe(true);
    expect(dietAiPlan('lite')).toBe(false);
    expect(dietAiPlan('free')).toBe(false);
    expect(dietAiPlan(null)).toBe(false);
  });
});

describe('buildDietBlock', () => {
  it('プリセットも自由記述も無ければ空文字（未設定の人のプロンプトは従来と同一）', () => {
    expect(block([])).toBe('');
    expect(block(null, '')).toBe('');
    expect(block(['unknown_key'])).toBe('');
  });

  it('避けているものと3値の判定指示が入る', () => {
    const b = block(['vegan', 'gluten_free']);
    expect(b).toContain('ユーザーは次を避けています');
    expect(b).toContain('ビーガン');
    expect(b).toContain('グルテンフリー');
    expect(b).toContain('dietFlag');
    expect(b).toContain('"high"');
    expect(b).toContain('"maybe"');
    expect(b).toContain('"none"');
  });

  it('判断できないときは必ず maybe（断定禁止）が明示される', () => {
    const b = block(['halal']);
    expect(b).toContain('判断できない場合は必ず "maybe"');
    expect(b).toContain('"none" にしてはいけない');
  });

  it('肯定的断定を書かせない禁止文が入る（§6の核心）', () => {
    const b = block(['vegan']);
    expect(b).toContain('「安全です」');
    expect(b).toContain('食べられます');
    expect(b).toContain('断定する表現は絶対に書かない');
    expect(b).toContain('「含まれていません」と書かない');
  });

  it('候補を省いたり並べ替えたりさせない（消すと安全と誤解させる）', () => {
    expect(block(['vegan'])).toContain('勝手に省いたり並べ替えたりしない');
  });

  it('自由記述はユーザーの言葉のまま渡し、長すぎる入力は切る', () => {
    expect(block([], 'えび・かに。パクチーも無理')).toContain('「えび・かに。パクチーも無理」');
    const long = block([], 'あ'.repeat(500));
    expect(long).toContain('あ'.repeat(300));
    expect(long).not.toContain('あ'.repeat(301));
  });

  it('nounとfieldで対象の呼び名が変わる（品目/候補・items/picks）', () => {
    const picks = buildDietBlock({ modes: ['vegan'], noun: '候補', field: 'picks' });
    expect(picks).toContain('picks[] の各候補');
    expect(picks).not.toContain('items[]');
  });
});

describe('プロンプト本体への注入', () => {
  it('parse-food: dietBlockを渡すとitemsのJSON形にdietFlagが増える', () => {
    const base = { text: 'カレー', dictBlock: '', outLang: '', historyBlock: '' };
    const off = buildParseFoodPrompt(base);
    const on = buildParseFoodPrompt({ ...base, dietBlock: block(['vegan']) });
    expect(off).not.toContain('dietFlag');
    expect(on).toContain('"dietFlag":"none"');
    expect(on).toContain('ビーガン');
    // 既存のルール文が消えていないこと（注入は足すだけ）
    expect(on).toContain('管理栄養士');
    expect(on).toContain('"reply":"AIの一言(必須)"');
  });

  it('menu-advice: dietBlockを渡すとpicksのJSON形にdietFlagが増える', () => {
    const base = { remainingKcal: 600, purposeKey: 'cut_std', pRemain: 30, outLang: '' };
    const off = buildMenuAdvicePrompt(base);
    const on = buildMenuAdvicePrompt({
      ...base, dietBlock: buildDietBlock({ modes: ['halal'], noun: '候補', field: 'picks' }),
    });
    expect(off).not.toContain('dietFlag');
    expect(on).toContain('"dietFlag":"none"');
    expect(on).toContain('ハラール');
    expect(on).toContain('600kcal');
  });

  it('未設定（dietBlock省略）のプロンプトは注入前と一字も変わらない', () => {
    const base = { text: 'ラーメン', dictBlock: '', outLang: '', historyBlock: '' };
    expect(buildParseFoodPrompt({ ...base, dietBlock: '' })).toBe(buildParseFoodPrompt(base));
    const m = { remainingKcal: 400, purposeKey: null, pRemain: null, outLang: '' };
    expect(buildMenuAdvicePrompt({ ...m, dietBlock: '' })).toBe(buildMenuAdvicePrompt(m));
  });
});
