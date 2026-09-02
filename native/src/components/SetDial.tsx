// 1セットの「重量」と「回数」を同じシートで回して決めるダイアル（筋トレ記録画面）。
//
// ・通常種目: 整数kg（0〜300）＋ .0/.5 ＋ 回数（1〜50）
// ・自重種目（懸垂・ディップス等）: 加重/補助を1本のホイールで選ぶ。
//     −60 … −1 ＝ 補助（アシストマシン・バンド。体重から引く）
//     0        ＝ 自重のみ
//     +1 … +60 ＝ 加重（ベルト・ダンベル。体重に足す）
//   「加重の欄と補助の欄を別に用意する」のではなく、同じ数直線の上で回すだけにした
//   （βFB 2026-09-02「懸垂は補助も入れられるように。加重と同じボックスで −kg と +kg を同じダイアルで」）。
// 回数はセットごとに変わる（9→7→5）ので、重量と同じ操作の中で毎回選べるようにしている。
import { useState } from 'react';
import { Wheel, DialSheet, WheelUnit } from '@/components/Wheel';
import { effectiveKg } from '@/lib/liftLog';
import { bwRatioOf } from '@/lib/lifts';
import { ASSIST_RANGE_KG, MAX_ABS_KG, MAX_REPS, loadLabel, loadKind, clampLoad } from '@/lib/liftSession';
import { t } from '@/lib/i18n';

// 自重種目の1本ホイールの目盛り（−60〜+60）。0は「自重」と書く
const BW_VALUES: number[] = Array.from({ length: ASSIST_RANGE_KG * 2 + 1 }, (_, i) => i - ASSIST_RANGE_KG);
const ABS_WHOLE = Array.from({ length: MAX_ABS_KG + 1 }, (_, i) => String(i));
const REPS = Array.from({ length: MAX_REPS }, (_, i) => String(i + 1));

export default function SetDial({ name, bw, initialKg, initialReps, bodyWeight, subtitle, okLabel, onClose, onPick }: {
  name: string;
  /** 自重種目か（加重/補助の1本ホイールになる） */
  bw: boolean;
  initialKg: number;
  initialReps: number;
  /** 実負荷の表示に使う体重（未記録なら null＝表示しない） */
  bodyWeight: number | null;
  /** 前回の記録など、合わせる基準になる一行 */
  subtitle?: string;
  /** 決定ボタンの文言（省略時「このセットで決定」） */
  okLabel?: string;
  onClose: () => void;
  onPick: (kg: number, reps: number) => void;
}) {
  const initKg = clampLoad(initialKg, bw);
  const initReps = Math.min(MAX_REPS, Math.max(1, Math.round(initialReps) || 8));
  // 自重種目: 符号つき整数1本。通常種目: 整数＋0.5
  const [signed, setSigned] = useState(Math.round(initKg));
  const [whole, setWhole] = useState(Math.floor(initKg));
  const [half, setHalf] = useState(initKg % 1 >= 0.25 ? 1 : 0);
  const [reps, setReps] = useState(initReps);
  const kg = bw ? signed : whole + (half ? 0.5 : 0);

  const bwLabels = BW_VALUES.map((v) => (v === 0 ? t('自重') : v > 0 ? `+${v}` : `−${Math.abs(v)}`));
  const words = { bw: t('自重'), plus: t('加重'), assist: t('補助') };
  const kind = loadKind(kg, bw);

  // 補足: 自重種目は「実負荷 約Nkg（体重の内訳）」。体重が無いときはその旨だけ
  let hint: string | undefined;
  if (bw) {
    if (bodyWeight && bodyWeight > 0) {
      const load = effectiveKg({ name, kg, reps: 1, sets: 1, mode: kind === 'assist' ? 'minus' : kind === 'plus' ? 'plus' : 'bw' }, bodyWeight);
      const ratio = bwRatioOf(name);
      const body = ratio < 1 ? t('体重{w}kgの{p}%', { w: bodyWeight, p: Math.round(ratio * 100) }) : t('体重{w}kg', { w: bodyWeight });
      hint = kind === 'assist'
        ? t('実負荷 約{n}kg（{body} − 補助{a}kg）', { n: load, body, a: Math.abs(kg) })
        : kind === 'plus'
          ? t('実負荷 約{n}kg（{body} + 加重{a}kg）', { n: load, body, a: kg })
          : t('実負荷 約{n}kg（{body}）', { n: load, body });
    } else {
      hint = t('体重を記録すると実負荷（体重 ± kg）が出ます');
    }
  }

  const label = loadLabel(kg, bw, words);
  return (
    <DialSheet
      title={name || t('重量と回数を選ぶ')}
      subtitle={subtitle}
      hint={hint}
      okLabel={okLabel ?? t('{load} × {reps}回で決定', { load: label, reps })}
      okDisabled={!bw && kg <= 0}
      onClose={onClose}
      onOk={() => onPick(kg, reps)}
    >
      {bw ? (
        <>
          {/* 加重/補助の1本ホイール。上が補助（−）・下が加重（+）・真ん中が自重 */}
          <Wheel width={104} values={bwLabels} index={Math.round(initKg) + ASSIST_RANGE_KG} onChange={(i) => setSigned(BW_VALUES[i])} />
          <WheelUnit>kg</WheelUnit>
        </>
      ) : (
        <>
          <Wheel width={84} values={ABS_WHOLE} index={Math.floor(initKg)} onChange={setWhole} />
          <WheelUnit>.</WheelUnit>
          <Wheel width={44} values={['0', '5']} index={initKg % 1 >= 0.25 ? 1 : 0} onChange={setHalf} />
          <WheelUnit>kg</WheelUnit>
        </>
      )}
      <Wheel width={64} values={REPS} index={initReps - 1} onChange={(i) => setReps(i + 1)} />
      <WheelUnit>{t('回')}</WheelUnit>
    </DialSheet>
  );
}
