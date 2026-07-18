// グラフ2種のレンダリング・スモークテスト（クラッシュ検出用）
import { renderToStaticMarkup } from 'react-dom/server';
import CumChart from '../components/CumChart';
import WeightChart from '../components/WeightChart';

const points = [
  { date: '2026-06-24', diff: -246 }, { date: '2026-06-25', diff: -446 },
  { date: '2026-07-08', diff: -474 }, { date: '2026-07-09', diff: 2975 },
  { date: '2026-07-13', diff: -1279 }, { date: '2026-07-14', diff: -600 },
];
const weights = [
  { date: '2026-06-24', weight: 86.6 }, { date: '2026-07-08', weight: 85.4 }, { date: '2026-07-14', weight: 85.0 },
];
const goal = {
  target_date: '2026-09-30', target_weight: 80, target_bf: 12, note: '',
  start_date: '2026-07-14', start_weight: 85.4, absorb_days: 7,
};

try {
  const cum = renderToStaticMarkup(<CumChart points={points} today="2026-07-16" />);
  console.log('CumChart OK, len=', cum.length, 'hasSvg=', cum.includes('<svg'), 'has累計=', cum.includes('累計'));
} catch (e) {
  console.error('CumChart CRASH:', e);
}
try {
  const w = renderToStaticMarkup(
    <WeightChart goal={goal} weights={weights} events={[{ id: '1', date: '2026-07-26' }]} today="2026-07-16"
                 bfPoints={[{ date: '2026-07-14', bf: 16 }]} targetBf={12} />
  );
  console.log('WeightChart OK, len=', w.length, 'hasSvg=', w.includes('<svg'));
} catch (e) {
  console.error('WeightChart CRASH:', e);
}
try {
  const empty = renderToStaticMarkup(<CumChart points={[]} today="2026-07-16" />);
  console.log('CumChart empty OK, len=', empty.length);
} catch (e) {
  console.error('CumChart empty CRASH:', e);
}
