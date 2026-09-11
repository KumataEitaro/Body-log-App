// 概要タブ「歩数・睡眠」の詳細は日付選択つき（feat/health-history・2026-09-10）。
//
// 熊田さんβFB「睡眠・歩数の過去の詳しい記録が見れない。食事タブや運動タブと同じ日付選択UIで
// 過去日に移動して詳しい記録も見たい」。以後の改修で「今日しか見られない」状態に戻さないよう、
// ①詳細は components/HealthDetail.tsx にあり ②食事・運動と同じ DateStrip を使い
// ③初期値は今日（開き直すと今日に戻る）④概要タブはその部品を差し込むだけ、をソースで固定する。
// 見た目の細部ではなく「差し替えると壊れる約束」だけを見る。
import fs from 'fs';
import path from 'path';
import { DICTS } from '@/content/i18n';

const src = (...p: string[]) => fs.readFileSync(path.resolve(__dirname, '..', ...p), 'utf8');
const DETAIL = src('components', 'HealthDetail.tsx');
const CHANGES = src('app', '(tabs)', 'changes.tsx');
const HOURLY = src('components', 'HourlyStepsChart.tsx');

describe('歩数・睡眠の詳細: 日付選択（DateStrip）', () => {
  it('食事・運動タブと同じ DateStrip を読み込んでいる（自前の日付UIを作らない）', () => {
    expect(DETAIL).toMatch(/import DateStrip from '@\/components\/DateStrip';/);
  });

  it('DateStrip に見ている日と変更ハンドラを渡している', () => {
    expect(DETAIL).toMatch(/<DateStrip value=\{viewDate\} onChange=\{pickDate\} \/>/);
  });

  it('初期値は今日（詳細を開き直すと今日に戻る）', () => {
    expect(DETAIL).toMatch(/const today = todayJST\(\);/);
    expect(DETAIL).toMatch(/const \[viewDate, setViewDate\] = useState\(today\);/);
  });

  it('選んだ日で読み直す（日付を変えても今日ぶんを読み続けない）', () => {
    expect(DETAIL).toMatch(/readActivitySummary\(DAYS, date\)/);
    expect(DETAIL).toMatch(/readSleepStages\(date\)/);
    expect(DETAIL).toMatch(/readHourlySteps\(date\)/);
    expect(DETAIL).toMatch(/useEffect\(\(\) => \{ if \(healthLink === 'linked'\) load\(viewDate\); \}[^)]*viewDate/);
  });

  it('日付の規則は lib/healthHistory.ts（jest済みの純関数）に任せている', () => {
    expect(DETAIL).toMatch(/from '@\/lib\/healthHistory'/);
    expect(DETAIL).toMatch(/daysEndingAt\(viewDate, DAYS\)/);
    expect(DETAIL).toMatch(/sleepHeading\(viewDate, today\)/);
  });

  it('選んだ日の詳細を出す（歩数の大数字・睡眠ステージ帯・時間帯別・7日表・週目標）', () => {
    expect(DETAIL).toMatch(/s\.statVal/);                       // 歩数などの大数字
    expect(DETAIL).toMatch(/<HourlyStepsChart hours=\{hourly\} date=\{viewDate\}/);
    expect(DETAIL).toMatch(/<WeekStepsBar days=\{rows\} today=\{viewDate\}/);
    expect(DETAIL).toMatch(/rows\?\.map\(/);                    // 選んだ日を末尾とする7日の表
  });

  it('データ無しは「—」＋一言、読込中はスケルトン', () => {
    expect(DETAIL).toMatch(/この日の記録はありません/);
    expect(DETAIL).toMatch(/'—'/);
    expect(DETAIL).toMatch(/import Skeleton from '@\/components\/Skeleton';/);
    expect(DETAIL).toMatch(/showSkeleton \? \(\s*<HealthDetailSkeleton/);
  });

  it('時間帯別の歩数は共通部品（運動タブ「きょうの動き」と同じ描き方）', () => {
    expect(HOURLY).toMatch(/export default function HourlyStepsChart/);
    expect(HOURLY).toMatch(/時間帯別の歩数/);
    // 今日だけ「まだ来ていない時間帯」を空バーにする（過去日は24本すべて実データ）
    expect(HOURLY).toMatch(/const future = isToday && h > nowH;/);
  });
});

describe('概要タブ: 詳細の中身は HealthDetail に委ねる', () => {
  it('health の詳細カードは <HealthDetail /> ひとつ', () => {
    expect(CHANGES).toMatch(/import HealthDetail from '@\/components\/HealthDetail';/);
    expect(CHANGES).toMatch(/const healthCard = healthAvailable\(\) \? \(\s*<HealthDetail \/>/);
  });

  it('旧「直近7日の表だけ」の描画が残っていない（二重表示・今日固定への逆戻り防止）', () => {
    expect(CHANGES).not.toMatch(/歩数・睡眠（直近7日）/);
    expect(CHANGES).not.toMatch(/setSleepStages/);
  });

  it('HealthKit の無い環境（Android等）は従来どおり出さない', () => {
    expect(CHANGES).toMatch(/healthAvailable\(\) \?/);
    expect(CHANGES).toMatch(/Platform\.OS === 'ios' \? \[\] : \['health'\]/);
  });
});

describe('追加した文言は全言語の辞書にある', () => {
  // 日本語UIは辞書が無くても壊れないが、他言語で日本語が混ざるのを防ぐ
  const ADDED = ['きょう', '睡眠', 'アクティブ', 'この日の記録はありません',
    '{m}/{d} の睡眠', '{md}の週', '{a}〜{b}の7日', '{w} {n} / {g}歩'];

  it.each(Object.keys(DICTS))('%s', (code) => {
    for (const k of ADDED) expect({ code, k, has: k in DICTS[code] }).toEqual({ code, k, has: true });
  });
});
