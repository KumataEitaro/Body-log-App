// 筋トレ記録画面のセット配列 → 保存文字列／ボリューム／±kgの解釈。
// 保存文字列が既存の書式（parseLiftText が読める形）から外れると、集計・e1RM・履歴が
// 「保存はできるのに出てこない」壊れ方をするので、往復で固定する。
import {
  sessionEntries, sessionText, sessionVolume, roundTrips, loadLabel, loadKind, clampLoad,
  nextSet, setReady, parseSessionState, serializeSessionState, restLeftSec, fmtRestSec,
  ASSIST_RANGE_KG, REST_CHOICES, type SessionSet,
} from '../liftSession';
import { parseLiftText, effectiveKg } from '../liftLog';
import { isBodyweightLift } from '../lifts';

const bw = isBodyweightLift;
const S = (name: string, kg: number, reps: number, id = 'x'): SessionSet => ({ id, name, kg, reps });
const WORDS = { bw: '自重', plus: '加重', assist: '補助' };
const REST_WORDS = { min: (n: number) => `${n}分`, sec: (n: number) => `${n}秒`, minSec: (m: number, s: number) => `${m}分${s}秒` };

describe('セット配列 → 保存テキスト', () => {
  it('同じ重量・同じ回数が続けば ×回数×セット にまとめる', () => {
    const sets = [S('ベンチプレス', 80, 8), S('ベンチプレス', 80, 8), S('ベンチプレス', 80, 8)];
    expect(sessionText(sets, bw)).toBe('🏋️ ベンチプレス 80kg×8×3');
  });

  it('回数が 9→7→5 と落ちるセットは1セットずつ別に書く（まとめない）', () => {
    const sets = [S('懸垂', 0, 9), S('懸垂', 0, 7), S('懸垂', 0, 5)];
    expect(sessionText(sets, bw)).toBe('🏋️ 懸垂 自重×9、懸垂 自重×7、懸垂 自重×5');
    // 読み戻すと3単位・各1セット・回数はそのまま
    const back = parseLiftText(sessionText(sets, bw));
    expect(back.map((e) => e.reps)).toEqual([9, 7, 5]);
    expect(back.every((e) => e.sets === 1)).toBe(true);
  });

  it('補助（負のkg）は -Nkg で書き、読み戻すと mode=minus・kgは負', () => {
    const sets = [S('懸垂', -20, 8)];
    expect(sessionText(sets, bw)).toBe('🏋️ 懸垂 -20kg×8');
    expect(parseLiftText('🏋️ 懸垂 -20kg×8')[0]).toEqual({ name: '懸垂', kg: -20, reps: 8, sets: 1, mode: 'minus' });
  });

  it('加重（正のkg）は +Nkg、自重のみは「自重」（既存の書式のまま）', () => {
    expect(sessionText([S('懸垂', 10, 8)], bw)).toBe('🏋️ 懸垂 +10kg×8');
    expect(sessionText([S('ディップス', 0, 12)], bw)).toBe('🏋️ ディップス 自重×12');
  });

  it('通常種目はそのままのkg。kg=0 の通常種目は保存対象にならない', () => {
    expect(sessionText([S('スクワット', 100, 5)], bw)).toBe('🏋️ スクワット 100kg×5');
    expect(sessionText([S('スクワット', 0, 5)], bw)).toBe('');
    expect(setReady(S('スクワット', 0, 5), bw)).toBe(false);
    expect(setReady(S('懸垂', 0, 5), bw)).toBe(true);        // 自重は0でOK
    expect(setReady(S('懸垂', -20, 5), bw)).toBe(true);      // 補助もOK
    expect(setReady(S('懸垂', 0, 0), bw)).toBe(false);       // 回数0はダメ
  });

  it('別種目を挟むと同じセットでもまとめない（順番を保つ）', () => {
    const sets = [S('ベンチプレス', 80, 8), S('スクワット', 100, 5), S('ベンチプレス', 80, 8)];
    expect(sessionEntries(sets, bw).map((e) => `${e.name}/${e.sets}`)).toEqual(['ベンチプレス/1', 'スクワット/1', 'ベンチプレス/1']);
  });

  it.each([
    [[S('懸垂', -20, 9), S('懸垂', -20, 7), S('懸垂', -15, 5)]],
    [[S('ベンチプレス', 82.5, 5), S('ベンチプレス', 82.5, 5), S('ベンチプレス', 85, 3)]],
    [[S('懸垂', 0, 10), S('懸垂', 10, 6)]],
  ])('保存テキストは parseLiftText で同じ形に読み戻せる（往復）', (sets) => {
    expect(roundTrips(sets, bw)).toBe(true);
  });
});

describe('±kgの解釈と実負荷', () => {
  it('ラベル: 補助 −20kg／加重 +10kg／自重／80kg', () => {
    expect(loadLabel(-20, true, WORDS)).toBe('補助 −20kg');
    expect(loadLabel(10, true, WORDS)).toBe('加重 +10kg');
    expect(loadLabel(0, true, WORDS)).toBe('自重');
    expect(loadLabel(80, false, WORDS)).toBe('80kg');
    expect(loadLabel(82.5, false, WORDS)).toBe('82.5kg');
  });

  it('kind: 自重種目は符号で assist/bw/plus、通常種目は常に abs', () => {
    expect(loadKind(-5, true)).toBe('assist');
    expect(loadKind(0, true)).toBe('bw');
    expect(loadKind(5, true)).toBe('plus');
    expect(loadKind(5, false)).toBe('abs');
  });

  it('ボリューム = (体重 ± kg) × 回数 の合計。補助は体重から引く', () => {
    // 体重70: 補助-20 → 50kg×8 = 400、加重+10 → 80kg×5 = 400、自重 → 70×6 = 420
    const sets = [S('懸垂', -20, 8), S('懸垂', 10, 5), S('懸垂', 0, 6)];
    expect(sessionVolume(sets, bw, 70)).toBe(400 + 400 + 420);
  });

  it('通常種目のボリュームは kg×回数（体重は無関係）', () => {
    expect(sessionVolume([S('ベンチプレス', 80, 8), S('ベンチプレス', 80, 6)], bw, 70)).toBe(80 * 14);
  });

  it('補助セットの実負荷は既存の effectiveKg にそのまま合流する（体重70・補助20 → 50）', () => {
    const e = parseLiftText('🏋️ 懸垂 -20kg×8')[0];
    expect(effectiveKg(e, 70)).toBe(50);
    expect(effectiveKg(e, null)).toBe(0);   // 体重不明のとき補助は0（負の負荷にしない）
  });

  it('ダイアルの範囲: 自重種目は ±60、通常種目は 0〜300', () => {
    expect(clampLoad(-100, true)).toBe(-ASSIST_RANGE_KG);
    expect(clampLoad(100, true)).toBe(ASSIST_RANGE_KG);
    expect(clampLoad(-5, false)).toBe(0);
    expect(clampLoad(500, false)).toBe(300);
    expect(clampLoad(NaN, true)).toBe(0);
  });
});

describe('セット行の追加と状態の保存', () => {
  it('＋セットは前セットの種目・重量・回数を引き継ぐ（回数だけ変えるのが最短）', () => {
    const n = nextSet(S('懸垂', -20, 9, 'a'));
    expect(n).toMatchObject({ name: '懸垂', kg: -20, reps: 9 });
    expect(n.id).not.toBe('a');
  });

  it('前が無ければ空の行（回数の初期値は8）', () => {
    expect(nextSet(null, 'ベンチプレス')).toMatchObject({ name: 'ベンチプレス', kg: 0, reps: 8 });
  });

  it('状態は文字列に落として読み戻せる。壊れた文字列は null', () => {
    const st = { date: '2026-09-02', sets: [S('懸垂', -20, 9, 'a')], restSec: 120, restEndsAt: 1000, startedAt: 500 };
    expect(parseSessionState(serializeSessionState(st))).toEqual(st);
    expect(parseSessionState(null)).toBeNull();
    expect(parseSessionState('{bad json')).toBeNull();
    expect(parseSessionState(JSON.stringify({ date: 'x', sets: [] }))).toBeNull();
    // レストの長さが選択肢外なら既定90秒に戻す・不正な行は捨てる
    const loose = parseSessionState(JSON.stringify({ date: '2026-09-02', sets: [{ name: '懸垂', kg: 'a', reps: 5 }, { name: 'スクワット', kg: 100, reps: 5 }], restSec: 7 }));
    expect(loose?.restSec).toBe(90);
    expect(loose?.sets.map((s) => s.name)).toEqual(['スクワット']);
  });

  it('レストの残り秒は終了時刻から出す（止まっていれば null・過ぎていれば 0）', () => {
    expect(restLeftSec(null, 0)).toBeNull();
    expect(restLeftSec(10_000, 4_000)).toBe(6);
    expect(restLeftSec(10_000, 12_000)).toBe(0);
  });

  it('レストの選択肢は15秒刻みで 15秒〜10分。表示は 90秒→1分30秒、120→2分', () => {
    expect(REST_CHOICES[0]).toBe(15);
    expect(REST_CHOICES[REST_CHOICES.length - 1]).toBe(600);
    expect(fmtRestSec(45, REST_WORDS)).toBe('45秒');
    expect(fmtRestSec(90, REST_WORDS)).toBe('1分30秒');
    expect(fmtRestSec(120, REST_WORDS)).toBe('2分');
  });
});
