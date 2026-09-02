// 重量を選ぶダイアル（下から出るシート）。
//
// kgの手打ちは、ジムでは両手がふさがりがちで面倒くさい。
// 「前回の重量から±数kgを合わせる」のが実際の操作なので、
// 前回値を初期位置にした縦ホイール（1kg刻み）＋0.5刻みのホイールを横に並べる。
// 体重計アプリなどでおなじみの形にして、説明なしで回せるようにしている。
//
// ホイール本体とシートの枠は components/Wheel.tsx に切り出した（筋トレ記録画面・運動記録シートと共用）。
// このファイルは「重量」専用の並び（整数＋小数＋単位）だけを持つ。
import { useState } from 'react';
import { Wheel, DialSheet, WheelUnit } from '@/components/Wheel';
import { t } from '@/lib/i18n';

const MAX_KG = 300;

export default function WeightDial({ title, subtitle, unitLabel, initial, allowZero, hint, onClose, onPick }: {
  title: string;
  /** 前回の記録など、合わせる基準になる一行 */
  subtitle?: string;
  /** 単位の表示。自重種目では「加重」にして意味を変える */
  unitLabel: string;
  initial: number;
  /** 0を「自重のみ」として許すか（通常種目では0は選べても保存で弾かれる） */
  allowZero?: boolean;
  /** 値が変わるたびに出す補足（自重種目の実負荷など） */
  hint?: (v: number) => string;
  onClose: () => void;
  onPick: (v: number) => void;
}) {
  const init = Math.min(MAX_KG, Math.max(0, initial));
  const [whole, setWhole] = useState(Math.floor(init));
  const [half, setHalf] = useState(init % 1 >= 0.25 ? 1 : 0);
  const value = whole + (half ? 0.5 : 0);

  const wholeValues = Array.from({ length: MAX_KG + 1 }, (_, i) => String(i));
  const valueLabel = value % 1 === 0 ? String(value) : value.toFixed(1);

  return (
    <DialSheet
      title={title}
      subtitle={subtitle}
      hint={hint ? hint(value) : undefined}
      okLabel={allowZero && value === 0 ? t('自重のみで決定') : t('{v}kgで決定', { v: valueLabel })}
      onClose={onClose}
      onOk={() => onPick(value)}
    >
      <Wheel width={96} values={wholeValues} index={Math.floor(init)} onChange={setWhole} />
      <WheelUnit>.</WheelUnit>
      <Wheel width={64} values={['0', '5']} index={init % 1 >= 0.25 ? 1 : 0} onChange={setHalf} />
      <WheelUnit>{unitLabel}</WheelUnit>
    </DialSheet>
  );
}
