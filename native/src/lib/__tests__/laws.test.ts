// 法則検出（detectLaws）のうち sleep_factor（B-14b・夜食×睡眠）の判定を固定する。
// 「21時以降に食べた日」vs「食べなかった日」の当夜の睡眠を比べ、
// 差30分以上・各群5日以上のときだけ法則にする（ノイズを出さない側に倒す）。
// テストはロケール未設定（=日本語キーがそのまま返る）前提で日本語文字列を比較する。
import { detectLaws, type LawInput } from '../laws';

const TODAY = '2026-06-16';

function shift(d: string, n: number): string {
  const dt = new Date(d + 'T00:00:00');
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

// 他の法則（食材・曜日・過食・時間帯・復帰）が発火しない最小のベース入力。
// itemHoursは10日ぶん（時間帯法則の下限14日未満）に抑える
function base(): LawInput {
  return {
    today: TODAY,
    days: [],
    itemDays: [],
    weights: [],
    itemHours: [],
    recordedDates: [],
    sleepDays: [],
  };
}

/**
 * lateN日=21時以降の摂取あり・offN日=なし の入力を組む。
 * 睡眠は「起きた日」に計上される流儀（health.ts）なので、日dの当夜の睡眠はd+1に置く
 */
function withSleep(lateN: number, offN: number, lateSleepH: number, offSleepH: number): LawInput {
  const input = base();
  let d = shift(TODAY, -1);
  for (let i = 0; i < lateN; i++) {
    input.itemHours.push({ date: d, hour: 22, kcal: 400 });          // 夜食あり
    input.sleepDays!.push({ date: shift(d, 1), sleepH: lateSleepH }); // 当夜の睡眠
    d = shift(d, -1);
  }
  for (let i = 0; i < offN; i++) {
    input.itemHours.push({ date: d, hour: 12, kcal: 600 });          // 昼だけ（夜食なし）
    input.sleepDays!.push({ date: shift(d, 1), sleepH: offSleepH });
    d = shift(d, -1);
  }
  return input;
}

describe('detectLaws: sleep_factor（夜食×睡眠）', () => {
  it('食べた日の睡眠が30分以上短い → 「短い」の法則（分は四捨五入）', () => {
    // 夜食日6.0h vs なし7.0h = 60分短い
    const laws = detectLaws(withSleep(5, 5, 6.0, 7.0));
    const law = laws.find((l) => l.kind === 'sleep_factor');
    expect(law).toBeDefined();
    expect(law!.id).toBe('sleep_factor');
    expect(law!.p).toEqual({ dir: 'short', min: 60, late: 5, off: 5 });
    expect(law!.title).toBe('あなたは21時以降に食べた日、睡眠が平均60分短い');
  });

  it('逆に食べた日のほうが長い → 「長い」の法則', () => {
    // 夜食日7.5h vs なし6.8h = 42分長い
    const laws = detectLaws(withSleep(6, 6, 7.5, 6.8));
    const law = laws.find((l) => l.kind === 'sleep_factor');
    expect(law).toBeDefined();
    expect(law!.p.dir).toBe('long');
    expect(law!.p.min).toBe(42);
    expect(law!.title).toBe('あなたは21時以降に食べた日、睡眠が平均42分長い');
  });

  it('差が30分未満なら法則にしない', () => {
    // 6.8h vs 7.0h = 12分差（閾値未満）
    const laws = detectLaws(withSleep(5, 5, 6.8, 7.0));
    expect(laws.find((l) => l.kind === 'sleep_factor')).toBeUndefined();
  });

  it('データ不足（片群が5日未満）なら法則にしない', () => {
    const laws = detectLaws(withSleep(4, 5, 6.0, 7.0));
    expect(laws.find((l) => l.kind === 'sleep_factor')).toBeUndefined();
  });

  it('睡眠データが無い（hk無し環境などでsleepDays未指定）ならスキップ', () => {
    const input = withSleep(5, 5, 6.0, 7.0);
    delete input.sleepDays;
    expect(detectLaws(input).find((l) => l.kind === 'sleep_factor')).toBeUndefined();
  });

  it('睡眠が引けない日（翌朝のデータ欠け）は両群から除外される', () => {
    const input = withSleep(5, 5, 6.0, 7.0);
    // 夜食日1日ぶんの睡眠を消す → late群が4日になり不成立
    const firstLateNight = shift(shift(TODAY, -1), 1);
    input.sleepDays = input.sleepDays!.filter((x) => x.date !== firstLateNight);
    expect(detectLaws(input).find((l) => l.kind === 'sleep_factor')).toBeUndefined();
  });
});

// ===== インサイト・エンジン系（docs/INSIGHTS-ENGINE.md §3・detectEngineLaws） =====
// 日次特徴量（features.ts の DayFeature）を直接組んで、各法則の採択基準と文言を固定する
import { detectEngineLaws } from '../laws';
import { emptyDayFeature, type DayFeature } from '../features';

function feats(n: number, fill: (i: number, r: DayFeature) => void): DayFeature[] {
  const out: DayFeature[] = [];
  for (let i = 0; i < n; i++) {
    const r = emptyDayFeature(shift(TODAY, -(n - 1 - i)));
    r.recorded = true; r.intake = 2000; r.target = 2000; r.over = 0;
    fill(i, r);
    out.push(r);
  }
  return out;
}

describe('detectLaws: インサイト・エンジン系', () => {
  it('features が14日未満なら何も出さない（安全弁）', () => {
    const input = base();
    input.features = feats(13, (_i, r) => { r.sleep_debt5 = 6; r.binge = true; });
    expect(detectLaws(input).filter((l) => ['sleep_debt_binge', 'multi_binge', 'lift_mood'].includes(l.kind))).toEqual([]);
  });

  it('sleep_debt_binge: 負債≥5h の日〜翌日に食べすぎが集中 → 倍率つきの法則', () => {
    // 30日: i%5==0 の6日が負債6h。その当日に食べすぎ（6回）。ほかの日は0回
    const f = feats(30, (i, r) => { r.sleep_debt5 = i % 5 === 0 ? 6 : 1; if (i % 5 === 0) { r.binge = true; r.over = 900; r.intake = 2900; } });
    const law = detectEngineLaws(f, TODAY, 2.0).find((l) => l.kind === 'sleep_debt_binge');
    expect(law).toBeDefined();
    expect(Number(law!.p.x)).toBeGreaterThanOrEqual(1.5);
    expect(law!.title).toContain('あなたは睡眠不足が5時間たまると');
    expect(law!.title).not.toMatch(/原因|せい|必ず/);
  });

  it('sleep_debt_binge: 負債と食べすぎに関係が無ければ出さない', () => {
    // 負債は偶数日・食べすぎは奇数日 → 「当日〜翌日」の窓ではどちらの群も100%＝倍率1.0
    const f = feats(30, (i, r) => { r.sleep_debt5 = i % 2 === 0 ? 6 : 1; if (i % 2 === 1) { r.binge = true; r.intake = 2900; r.over = 900; } });
    expect(detectEngineLaws(f, TODAY, 2.0).find((l) => l.kind === 'sleep_debt_binge')).toBeUndefined();
  });

  it('wheat_vs_rice_mood: 小麦中心の翌日の気分が0.5以上低ければ「小麦→低い」', () => {
    const f = feats(30, (i, r) => {
      if (i % 2 === 0) { r.wheat_g = 300; r.rice_g = 0; } else { r.rice_g = 300; r.wheat_g = 0; }
      // 翌日の気分: 小麦の日(偶数)の翌日(奇数)は2、米の日の翌日(偶数)は4
      r.mood = i % 2 === 1 ? 2 : 4;
    });
    const law = detectEngineLaws(f, TODAY, 2.0).find((l) => l.kind === 'wheat_vs_rice_mood');
    expect(law).toBeDefined();
    expect(law!.p.dir).toBe('wheat_low');
    expect(law!.p.d).toBe(2);
    expect(law!.title).toBe('あなたは小麦中心の日の翌日、気分が平均2低い（米中心の日と比べて）');
  });

  it('chicken_heavy / salmon_master: 30日の食材合計から。鶏の文言に病名は出ない', () => {
    const f = feats(30, (_i, r) => { r.chicken_g = 100; r.salmon_g = 40; r.fish_g = 40; });   // 鶏3kg・魚1.2kg（鶏の40%）→ 偏りではない
    let laws = detectEngineLaws(f, TODAY, 2.0);
    expect(laws.find((l) => l.kind === 'chicken_heavy')).toBeUndefined();
    const salmon = laws.find((l) => l.kind === 'salmon_master');
    expect(salmon).toBeDefined();
    expect(salmon!.p.g).toBe(1200);
    const f2 = feats(30, (_i, r) => { r.chicken_g = 100; r.fish_g = 10; });   // 魚が鶏の10% → 偏り
    laws = detectEngineLaws(f2, TODAY, 2.0);
    const chicken = laws.find((l) => l.kind === 'chicken_heavy');
    expect(chicken).toBeDefined();
    expect(chicken!.p.kg).toBe(3);
    expect(chicken!.title + chicken!.sub).not.toMatch(/痛風|尿酸|プリン体|病/);
    expect(chicken!.sub).toBe('たんぱく源が偏っています。魚・卵・大豆も混ぜると栄養の幅が広がります');
  });

  it('lift_sleep / lift_mood: 7h以上の日のボリューム差10%以上、トレ日の気分差0.4以上', () => {
    const f = feats(30, (i, r) => {
      r.mood = i % 3 === 0 ? 4.5 : 3.5;                       // トレ日(i%3==0)の気分が+1
      if (i % 3 === 0) { r.lift_sessions = 1; r.sleep_h = i % 2 === 0 ? 7.5 : 6; r.lift_volume_kg = i % 2 === 0 ? 6000 : 5000; }
    });
    const laws = detectEngineLaws(f, TODAY, 2.0);
    const ls = laws.find((l) => l.kind === 'lift_sleep');
    expect(ls).toBeDefined();
    expect(ls!.p.dir).toBe('up');
    expect(ls!.p.pct).toBe(20);
    const lm = laws.find((l) => l.kind === 'lift_mood');
    expect(lm).toBeDefined();
    expect(lm!.p.dir).toBe('up');
    expect(lm!.p.d).toBe(1);
    expect(lm!.title).toBe('あなたはトレした日の気分が、平均1高い');
  });

  it('multi_binge: mineRules の上位を法則化。id は因子の組で決定的、文言に条件ラベルが入る', () => {
    // 42日: 負債≥5h（i%3==0）×前日の気分低（奇数日に低い→偶数日で真）がそろう日(i%6==0, i>0)に食べすぎ
    const f = feats(42, (i, r) => {
      r.sleep_h = 7; r.sleep_debt5 = i % 3 === 0 ? 6 : 1; r.mood = i % 2 === 1 ? 1 : 4;
      if ((i % 6 === 0 && i > 0) || i === 5) { r.binge = true; r.over = 900; r.intake = 2900; }
    });
    const a = detectEngineLaws(f, TODAY, 2.0).filter((l) => l.kind === 'multi_binge');
    const b = detectEngineLaws(f, TODAY, 2.0).filter((l) => l.kind === 'multi_binge');
    expect(a.length).toBeGreaterThan(0);
    expect(a.length).toBeLessThanOrEqual(3);
    expect(a.map((l) => l.id)).toEqual(b.map((l) => l.id));
    expect(a[0].id).toBe('multi_binge:prev_mood_low+sleep_debt5_ge5');
    expect(a[0].title).toContain('「前日の気分が低め」「睡眠不足が5時間以上たまっている」がそろった日、食べすぎが');
    expect(a[0].sub).toContain('相関であり、原因とは限りません');
    // detectLaws 経由でも同じものが出る（features を渡す）
    const input = base(); input.features = f;
    expect(detectLaws(input).find((l) => l.id === a[0].id)).toBeDefined();
  });
});
