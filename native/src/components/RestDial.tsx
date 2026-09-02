// レストの長さを回して選ぶダイアル（筋トレ記録画面・運動タブのレストタイマーカード）。
// 以前はボタン7段（30秒〜10分）だったが「レストもダイアルで」（βFB 2026-09-02）に合わせ、
// 15秒刻み・15秒〜10分の1本ホイールにした。選んだ長さは 'bl-rest-sec' に記憶する（呼び側）。
import { useState } from 'react';
import { Wheel, DialSheet } from '@/components/Wheel';
import { REST_CHOICES, fmtRestSec } from '@/lib/liftSession';
import { t } from '@/lib/i18n';

/** レスト秒数の表示（翻訳つき）。60の倍数は「N分」、それ以外は「M分S秒」または「S秒」 */
export function fmtRest(sec: number): string {
  return fmtRestSec(sec, {
    min: (n) => t('{n}分', { n }),
    sec: (n) => t('{n}秒', { n }),
    minSec: (m, s) => t('{m}分{s}秒', { m, s }),
  });
}

export default function RestDial({ initial, onClose, onPick }: {
  initial: number;
  onClose: () => void;
  onPick: (sec: number) => void;
}) {
  const initIdx = Math.max(0, REST_CHOICES.indexOf(initial));
  const [idx, setIdx] = useState(initIdx);
  const sec = REST_CHOICES[idx];
  return (
    <DialSheet
      title={t('レストの長さ')}
      subtitle={t('追い込みは30〜60秒、標準は90秒、高重量は3〜5分が目安')}
      okLabel={t('{d}で決定', { d: fmtRest(sec) })}
      onClose={onClose}
      onOk={() => onPick(sec)}
    >
      <Wheel width={160} values={REST_CHOICES.map(fmtRest)} index={initIdx} onChange={setIdx} />
    </DialSheet>
  );
}
