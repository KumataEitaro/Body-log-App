// N2「未来シミュレーション」（docs/STRATEGY.md §6夜・§7 N2）
//
// 戦略のどのゲートに効くか:
//   ②身体への理解 … 「ラーメン1杯」が今日・今週・体重にどう響くかを同じ物差しで見せる。
//     数字が1日ではなく週の合計で決まることを、選択のたびに体感させる。
//   ③次の行動 … 「食べたら明日どうすればいいか」まで文にする。
//   ⑤明日開く理由 … 迷ったときに開くアプリになる（禁止するアプリは開かれない）。
//
// 【絶対の規約: 禁止せず、選択の結果を見せる】
// AIの人格は「知識のある、静かな伴走者」（§5）。だからこのモジュールが返す文は
//   ❌「やめましょう」「太ります」「我慢」  → 一切使わない（BANNED_PHRASES をテストで固定）
//   ⭕「今日は少し多めになります。今週は{w}kcalの赤字なので、明日から少し戻せば十分です。」
// 判定・文言選択はすべてこの純関数に置き、UI（components/WhatIfSheet.tsx）は結果を並べるだけにする。
//
// 【体重の言い方】週の収支 ÷ 7,200kcal（体脂肪1kg・lib/deficit.ts KCAL_PER_KG）。
// これは「ペースの見積り」であって予言ではないので、必ず「おおよそ」「このペースなら」を添える。
import { balanceOf, overLevel, KCAL_PER_KG, type Balance, type BalanceDay, type OverLevel } from './deficit';
import { t } from './i18n';

/** シミュレーションの対象（AI解析の値があればそれ、無ければ nutrientDb findFood の概算、最後は手入力） */
export type WhatIfTarget = {
  name: string;
  kcal: number;
  p: number | null;
  f: number | null;
  c: number | null;
  /** 数字の出どころ。'ai'=解析済み / 'db'=食材データからの概算 / 'manual'=手入力 */
  source: 'ai' | 'db' | 'manual';
};

/** 残りPFC（未計算はnull） */
export type PfcRemaining = { p: number | null; f: number | null; c: number | null };

// ===== ① 今日 =====

export type WhatIfToday = {
  /** 食べる前の残りkcal */
  before: number;
  /** 食べた後の残りkcal（マイナス=超過） */
  after: number;
  /** 超過kcal（0以上。after>=0 なら0） */
  over: number;
  /** 超過の3段階（既存 lib/deficit.ts overLevel と同じ物差し＝画面の色が食い違わない） */
  level: OverLevel;
  /** 食べた後の残りPFC（nullは未計算のまま） */
  pfc: PfcRemaining;
};

export function simulateToday(remainingKcal: number, pfc: PfcRemaining, target: WhatIfTarget): WhatIfToday {
  const before = Math.round(remainingKcal);
  const after = before - Math.round(target.kcal);
  const sub = (rem: number | null, add: number | null) => (rem == null ? null : Math.round(rem - (add ?? 0)));
  return {
    before, after,
    over: after < 0 ? -after : 0,
    level: overLevel(-after),
    pfc: { p: sub(pfc.p, target.p), f: sub(pfc.f, target.f), c: sub(pfc.c, target.c) },
  };
}

// ===== ② 今週 =====

export type WhatIfWeek = {
  /** 食べる前の週の収支（負=赤字＝減量が進む方向。既存 balanceOf と同じ） */
  before: number;
  /** 食べた後の週の収支 */
  after: number;
  /** 週の目標収支（減量なら負） */
  goal: number;
  /** 食べても週の目標の範囲に収まるか（目標と同じ方向で、目標以上に進んでいる） */
  withinGoal: boolean;
  /** 目標まであといくら（0=達成済み・正の数=足りていないkcal） */
  shortfall: number;
};

/**
 * 今週の収支への影響。既存の `balanceOf`（lib/deficit.ts）をそのまま使い、
 * 最終日（=今日）の摂取に対象のkcalを足したもう1本を作って比べる。
 * 画面の「週と月の収支」カードと同じ関数から作るので数字が食い違わない。
 * @param days 直近7日（末尾が今日）。未記録日の intake は null のまま渡す
 */
export function simulateWeek(days: BalanceDay[], perDayDeficit: number, addKcal: number): WhatIfWeek {
  const week = days.slice(-7);
  const before: Balance = balanceOf(week, perDayDeficit);
  const bumped = week.map((d, i) =>
    i === week.length - 1 ? { ...d, intake: Math.round((d.intake ?? 0) + addKcal) } : d);
  const after: Balance = balanceOf(bumped, perDayDeficit);
  // 目標が赤字（負）なら「after <= goal」で範囲内。増量（正）なら「after >= goal」。目標0なら範囲の概念なし
  const withinGoal = before.goal < 0 ? after.actual <= before.goal
    : before.goal > 0 ? after.actual >= before.goal : true;
  const shortfall = before.goal === 0 ? 0 : Math.max(0, Math.abs(before.goal) - Math.abs(after.actual));
  return { before: before.actual, after: after.actual, goal: before.goal, withinGoal, shortfall };
}

// ===== ③ 予測体重 =====

export type WhatIfWeight = {
  /** この1週間のペースでの体重変化kg（負=減る・小数1桁）。断定しない見積り */
  deltaKg: number;
  /** 表示用の文（「このペースなら、おおよそ−0.3kg」） */
  text: string;
};

/**
 * 週の収支 → 体重の見積り。`Δkg = 収支 / 7,200`。
 * 「±0.0kg」になる帯（|Δ| < 0.05kg）は数字を出さずに「ほとんど変わらないペース」と言う
 * （−0.0kg のような無意味な数字を見せない）
 */
export function simulateWeight(weekAfterKcal: number): WhatIfWeight {
  const raw = weekAfterKcal / KCAL_PER_KG;
  const deltaKg = Math.round(raw * 10) / 10;
  if (Math.abs(deltaKg) < 0.05) {
    return { deltaKg: 0, text: t('このペースなら、体重はほとんど変わらない見込みです。') };
  }
  // マイナス記号はU+2212ではなく通常のハイフンにする（tabular-numsで桁が揃う）
  const sign = deltaKg < 0 ? '-' : '+';
  return {
    deltaKg,
    text: t('この1週間のペースなら、おおよそ{kg}kgです。', { kg: `${sign}${Math.abs(deltaKg).toFixed(1)}` }),
  };
}

// ===== 文言（伴走者トーン） =====

/** 絶対に使わない語。テスト（whatIf.test.ts）が全パターンの文に対してこれを禁止する */
export const BANNED_PHRASES: readonly string[] = ['やめましょう', '太ります', '我慢', 'ダメ', '禁止'];

/** 文のパターン識別子（テストで「どの文が出たか」を固定するため） */
export type WhatIfTone = 'fine' | 'slightlyOver' | 'over' | 'weekTight' | 'alreadyOver';

export type WhatIfMessage = { tone: WhatIfTone; text: string };

/**
 * 今日と今週の結果から1文を選ぶ。
 *
 * | tone           | 条件                                               | 言い方 |
 * |----------------|----------------------------------------------------|--------|
 * | fine           | 今日が収まる & 今週も目標の範囲                     | 「食べても大丈夫です」 |
 * | weekTight      | 今日は収まるが、今週は目標に届かない                 | 今日はOK・週で戻す話に寄せる |
 * | slightlyOver   | 今日が少し超える（〜+300）                          | 「少し多めになります」＋週の赤字を根拠に |
 * | over           | 今日が+300超                                        | 「多めになります」＋明日からの戻し方 |
 * | alreadyOver    | 食べる前からすでに超過                              | 事実だけ言い、週の物差しに戻す |
 *
 * 「やめましょう」「太ります」「我慢」は一切出さない（BANNED_PHRASES）。
 */
export function whatIfMessage(today: WhatIfToday, week: WhatIfWeek): WhatIfMessage {
  // 週の赤字は「絶対値のkcal」で言う（マイナス記号つきの数字は読み手に届かない）
  const deficit = week.after < 0 ? Math.abs(week.after) : 0;
  const w = deficit.toLocaleString();

  if (today.before < 0) {
    return {
      tone: 'alreadyOver',
      text: deficit > 0
        ? t('今日はもう目標を超えています。それでも今週は{w}kcalの赤字なので、週の合計ではまだ計画の中です。', { w })
        : t('今日はもう目標を超えています。体重は週と月の合計で決まるので、明日から少し戻していけば大丈夫です。'),
    };
  }
  if (today.over === 0) {
    if (week.withinGoal) {
      return {
        tone: 'fine',
        text: t('食べても大丈夫です。今日の残りは約{n}kcal。今週の合計ではまだ目標の範囲です。', { n: today.after.toLocaleString() }),
      };
    }
    return {
      tone: 'weekTight',
      text: t('今日はこれで収まります。今週は目標まであと{s}kcalなので、明日以降で少しずつ寄せていけます。', { s: week.shortfall.toLocaleString() }),
    };
  }
  if (today.level === 'mild') {
    return {
      tone: 'slightlyOver',
      text: deficit > 0
        ? t('今日は少し多めになります。今週は{w}kcalの赤字なので、明日から少し戻せば十分です。', { w })
        : t('今日は少し多めになります。1日の超過は週の合計で吸収できる範囲です。'),
    };
  }
  return {
    tone: 'over',
    text: deficit > 0
      ? t('今日は多めになります。今週は{w}kcalの赤字なので、明日から数日かけて戻していけます。', { w })
      : t('今日は多めになります。明日から数日かけて戻していけば、週の合計では追いつけます。'),
  };
}

// ===== まとめ =====

export type WhatIfResult = {
  target: WhatIfTarget;
  today: WhatIfToday;
  week: WhatIfWeek;
  weight: WhatIfWeight;
  message: WhatIfMessage;
};

export type WhatIfInput = {
  target: WhatIfTarget;
  remainingKcal: number;
  pfc: PfcRemaining;
  /** 直近7日（末尾が今日）。「週と月の収支」カードに渡している balanceDays の末尾7件をそのまま渡す */
  days: BalanceDay[];
  /** 目標の1日赤字（computePlan.requiredDaily。収支カードと同じ値） */
  perDayDeficit: number;
};

/** 3段（今日・今週・予測体重）＋1文をまとめて作る。UIはこの結果を並べるだけ */
export function simulateWhatIf(i: WhatIfInput): WhatIfResult {
  const today = simulateToday(i.remainingKcal, i.pfc, i.target);
  const week = simulateWeek(i.days, i.perDayDeficit, Math.round(i.target.kcal));
  return {
    target: i.target,
    today, week,
    weight: simulateWeight(week.after),
    message: whatIfMessage(today, week),
  };
}
