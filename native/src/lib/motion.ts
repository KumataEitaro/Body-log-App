// 動きの強さの環境設定。
// iOSの「視差効果を減らす」をONにしている人には、常時ループする明滅や
// 装飾的な動きを止める（酔いや集中の妨げになるため。審査でも見られる項目）。
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

let cached: boolean | null = null;

/**
 * 数値が変わったとき、前の値から目標値へ短く滑らかに数え上げる。
 * 「動的かつ視覚的」の要: 保存した瞬間に残量がコロコロと動いて反映が体感できる。
 * reduce motion時は即座に確定値（数え上げない）。
 */
export function useCountUp(target: number, duration = 350): number {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);
  const reduce = useReduceMotion();
  useEffect(() => {
    if (reduce || fromRef.current === target) { fromRef.current = target; setValue(target); return; }
    const from = fromRef.current;
    fromRef.current = target;
    const t0 = Date.now();
    let raf = 0;
    const tick = () => {
      const k = Math.min(1, (Date.now() - t0) / duration);
      const eased = 1 - (1 - k) * (1 - k) * (1 - k);   // ease-out cubic
      setValue(Math.round(from + (target - from) * eased));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, reduce]);
  return value;
}

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
