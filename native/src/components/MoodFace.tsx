// 気分5段階の幾何フェイス。絵文字（😫😕😐🙂😄）の置き換え。
// Buddy（ひとこと帯のキャラ）と同じDNA＝円と点と弧だけで表情を作る。
// 眉は使わない（幼児向けに転ぶため）。目の傾きと口の弧だけで5段階を語る。
import Svg, { Circle, Path, Line } from 'react-native-svg';
import { C } from '@/lib/ui';

export default function MoodFace({ level, size = 30, color }: { level: 1 | 2 | 3 | 4 | 5; size?: number; color?: string }) {
  const col = color ?? C.ink;
  const sw = 2;           // 線の太さ（viewBox 32基準）
  const eyeY = 13;
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32">
      <Circle cx={16} cy={16} r={13.5} stroke={col} strokeWidth={sw} fill="none" />
      {/* 目 */}
      {level === 1 && (
        <>
          {/* つらい: ハの字に伏せた目 */}
          <Line x1={9.5} y1={eyeY - 1} x2={13.5} y2={eyeY + 1.5} stroke={col} strokeWidth={sw} strokeLinecap="round" />
          <Line x1={22.5} y1={eyeY - 1} x2={18.5} y2={eyeY + 1.5} stroke={col} strokeWidth={sw} strokeLinecap="round" />
        </>
      )}
      {level === 5 ? (
        <>
          {/* うれしい: 弧の目（∪を上下反転した ∩） */}
          <Path d="M9.5 14 Q11.5 11 13.5 14" stroke={col} strokeWidth={sw} fill="none" strokeLinecap="round" />
          <Path d="M18.5 14 Q20.5 11 22.5 14" stroke={col} strokeWidth={sw} fill="none" strokeLinecap="round" />
        </>
      ) : level !== 1 && (
        <>
          <Circle cx={11.5} cy={eyeY} r={1.6} fill={col} />
          <Circle cx={20.5} cy={eyeY} r={1.6} fill={col} />
        </>
      )}
      {/* 口（弧の深さで感情の強さを表す） */}
      {level === 1 && <Path d="M10.5 23.5 Q16 18.5 21.5 23.5" stroke={col} strokeWidth={sw} fill="none" strokeLinecap="round" />}
      {level === 2 && <Path d="M11.5 22.5 Q16 20.5 20.5 22.5" stroke={col} strokeWidth={sw} fill="none" strokeLinecap="round" />}
      {level === 3 && <Line x1={11.5} y1={21.5} x2={20.5} y2={21.5} stroke={col} strokeWidth={sw} strokeLinecap="round" />}
      {level === 4 && <Path d="M11.5 20.5 Q16 23 20.5 20.5" stroke={col} strokeWidth={sw} fill="none" strokeLinecap="round" />}
      {level === 5 && <Path d="M10.5 19.5 Q16 25 21.5 19.5" stroke={col} strokeWidth={sw} fill="none" strokeLinecap="round" />}
    </Svg>
  );
}
