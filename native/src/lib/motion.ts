// 動きの強さの環境設定。
// iOSの「視差効果を減らす」をONにしている人には、常時ループする明滅や
// 装飾的な動きを止める（酔いや集中の妨げになるため。審査でも見られる項目）。
import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

let cached: boolean | null = null;

export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(cached ?? false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      cached = v;
      if (alive) setReduce(v);
    }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => {
      cached = v;
      setReduce(v);
    });
    return () => { alive = false; sub.remove(); };
  }, []);
  return reduce;
}
