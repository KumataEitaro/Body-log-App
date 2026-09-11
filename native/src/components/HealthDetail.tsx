// 概要タブ「歩数・睡眠」の詳細（feat/health-history・2026-09-10）。
//
// 従来は app/(tabs)/changes.tsx の中に「直近7日の表＋昨夜の睡眠＋週目標」を直書きしていて、
// 今日ぶんしか詳しく見られなかった。熊田さんβFB「日付選択（食事タブや運動タブ）と同じUIで
// 過去の日付に移動し、過去の日付の詳しい記録も確認できるようにしてほしい」に応えて、
//   1) 最上部に食事・運動タブと同じ DateStrip（直近90日チップ＋カレンダー＋「今日」ピル）
//   2) 選んだ日の記録: 歩数（大）・その朝に起きた睡眠（合計＋ステージ帯）・アクティブkcal・時間帯別歩数
//   3) 「選んだ日を末尾とする7日」の表（行タップでその日へ移動）と、選んだ日を含む週の歩数目標
// を1枚のカードに置く。日付の規則（7日の並び・HealthKit の時間窓・見出し文言）は
// lib/healthHistory.ts の純関数（jest 済み）。読み取りは lib/health.ts（iOS 以外では hk=null で
// 何も返さないが、そもそも changes.tsx が healthAvailable() で行ごと出さない）。
//
// viewDate は useState(todayJST()) ＝ 詳細を開く（マウント）たびに今日へ戻る。
// 日付跨ぎの追従（useTodayRollover）は入れない: 詳細は常駐せず、開き直せば今日から始まるため。
import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import Svg, { Rect } from 'react-native-svg';
import { Footprints, Moon, Flame } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import DateStrip from '@/components/DateStrip';
import Skeleton from '@/components/Skeleton';
import WeekStepsBar, { useWeekStepsGoal } from '@/components/WeekStepsBar';
import HourlyStepsChart from '@/components/HourlyStepsChart';
import {
  linkHealth, readActivitySummary, readSleepStages, readHourlySteps,
  type HealthDaySummary, type SleepStages,
} from '@/lib/health';
import { useHealthLinkState, useHealthVersion } from '@/lib/healthStore';
import { todayJST } from '@/lib/calc';
import { daysEndingAt, fillDays, hasDayRecord, mdOf, sleepHeading, weekMondayOf } from '@/lib/healthHistory';
import { C, rgba, RADIUS, ICON, SPACE, themed } from '@/lib/ui';
import { t } from '@/lib/i18n';

/** 表に並べる日数（選んだ日を末尾とする） */
const DAYS = 7;

const WD = () => [t('日'), t('月'), t('火'), t('水'), t('木'), t('金'), t('土')];

/** 'YYYY-MM-DD' → 「9/3(水)」。今日は「きょう」 */
function dayLabel(d: string, today: string): string {
  if (d === today) return t('きょう');
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) return d;
  const dow = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
  return t('{m}/{d}({w})', { m: Number(m[2]), d: Number(m[3]), w: WD()[dow] });
}

/** 時間（h・小数）→「7時間30分」／60分未満は「45分」 */
function fmtHM(h: number): string {
  const m = Math.round(h * 60);
  return m >= 60 ? t('{h}時間{m}分', { h: Math.floor(m / 60), m: m % 60 }) : t('{n}分', { n: m });
}

export default function HealthDetail() {
  const winW = useWindowDimensions().width;
  const today = todayJST();
  const [viewDate, setViewDate] = useState(today);
  const healthLink = useHealthLinkState();
  const healthVer = useHealthVersion();
  const weekStepsGoal = useWeekStepsGoal();

  // 選んだ日を末尾とする7日のサマリー／その日の睡眠ステージ／その日の時間帯別歩数
  const [activity, setActivity] = useState<HealthDaySummary[] | null>(null);
  const [stages, setStages] = useState<SleepStages | null>(null);
  const [hourly, setHourly] = useState<number[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // 日付を素早く切り替えたとき、遅れて返ってきた古い日の結果で上書きしないための通し番号
  const seq = useRef(0);

  const load = useCallback(async (date: string) => {
    const my = ++seq.current;
    setLoading(true); setMsg(null);
    try {
      const [res, st, hr] = await Promise.all([
        readActivitySummary(DAYS, date),
        readSleepStages(date).catch(() => null),   // ステージは飾り（無い端末は null＝合計だけ）
        readHourlySteps(date).catch(() => null),
      ]);
      if (my !== seq.current) return;
      if ('error' in res) { setMsg(res.error); setActivity([]); } else setActivity(res);
      setStages(st);
      setHourly(hr);
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, []);
  // 連携済み: 表示時・日付変更時・ヘルスケアの変更イベントごとに自動で読み直す（ユーザー操作なし）
  useEffect(() => { if (healthLink === 'linked') load(viewDate); }, [healthLink, healthVer, viewDate, load]);

  async function link() {
    setLoading(true); setMsg(null);
    try {
      // 成功すると healthLink が 'linked' になり、上の effect がそのまま読みに行く
      if (!(await linkHealth())) setMsg(t('ヘルスケアへのアクセスが許可されませんでした。'));
    } finally { setLoading(false); }
  }

  function pickDate(d: string) {
    if (d === viewDate) return;
    Haptics.selectionAsync().catch(() => {});
    setViewDate(d);
  }

  const isToday = viewDate === today;
  const dates = daysEndingAt(viewDate, DAYS);
  const rows = activity ? fillDays(activity, dates) : null;
  const day = rows ? rows[rows.length - 1] : null;
  const hasData = hasDayRecord(day);
  const linked = healthLink === 'linked';
  const showSkeleton = linked && (activity === null || loading);
  // 選んだ日を含む週（月曜起点）。今週なら従来の「今週」表記、過去の週は「9/1の週」
  const sameWeek = weekMondayOf(viewDate) === weekMondayOf(today);
  const weekLabel = sameWeek ? undefined : t('{md}の週', { md: mdOf(weekMondayOf(viewDate)) });
  // 睡眠ステージ帯（SVGは幅を数値で要求する）: 画面幅 − ページ余白 − カード内余白＝カードの中身の幅
  const barW = Math.max(60, winW - SPACE.screen * 2 - SPACE.card * 2);

  const asleepH = stages ? stages.deepH + stages.coreH + stages.remH : 0;   // 「睡眠時間」は覚醒を除く
  const segs = stages && asleepH > 0.01 ? [
    // ステージの配色はC.tealの濃淡3段（深いほど濃い）＋覚醒だけ淡いcoral
    { k: 'deep', label: t('深い睡眠'), h: stages.deepH, color: C.teal },
    { k: 'core', label: t('コア睡眠'), h: stages.coreH, color: rgba(C.teal, 0.55) },
    { k: 'rem', label: t('レム睡眠'), h: stages.remH, color: rgba(C.teal, 0.3) },
    { k: 'awake', label: t('覚醒'), h: stages.awakeH, color: rgba(C.coral, 0.4) },
  ].filter((x) => x.h > 0.01) : [];
  const segTotal = segs.reduce((a, x) => a + x.h, 0);

  return (
    <View style={s.card}>
      {/* 日付選択（食事・運動タブと同じ部品・同じ見た目）。左に見ている日のラベル */}
      <View style={s.stripRow}>
        <Text style={s.dayLabel} maxFontSizeMultiplier={1.3}>{dayLabel(viewDate, today)}</Text>
        <DateStrip value={viewDate} onChange={pickDate} />
      </View>

      {!linked ? (
        // 未連携のときだけ連携ボタン。連携状態が不明なあいだは待ちの一言
        healthLink === 'unlinked' ? (
          <Pressable style={s.linkBtn} onPress={link} disabled={loading} accessibilityRole="button">
            <Text style={s.linkBtnT}>{loading ? t('読み込み中…') : t('ヘルスケアと連携する')}</Text>
          </Pressable>
        ) : (
          <Text style={s.note}>{t('ヘルスケアのデータを待っています')}</Text>
        )
      ) : showSkeleton ? (
        <HealthDetailSkeleton width={barW} />
      ) : (
        <>
          {/* その日の記録: 歩数（大）・睡眠合計・アクティブkcal。無い値は「—」 */}
          <View style={s.stats}>
            <View style={s.stat}>
              <View style={s.statHead}><Footprints size={ICON.xs} color={C.sub} /><Text style={s.statLabel}>{t('歩数')}</Text></View>
              <Text style={s.statVal} maxFontSizeMultiplier={1.3}>
                {day && day.steps > 0 ? day.steps.toLocaleString() : '—'}
                {day && day.steps > 0 && <Text style={s.statUnit}> {t('歩')}</Text>}
              </Text>
            </View>
            <View style={s.stat}>
              <View style={s.statHead}><Moon size={ICON.xs} color={C.sub} /><Text style={s.statLabel}>{t('睡眠')}</Text></View>
              <Text style={s.statVal} maxFontSizeMultiplier={1.3}>{day && day.sleepH > 0 ? fmtHM(day.sleepH) : '—'}</Text>
            </View>
            <View style={s.stat}>
              <View style={s.statHead}><Flame size={ICON.xs} color={C.sub} /><Text style={s.statLabel}>{t('アクティブ')}</Text></View>
              <Text style={s.statVal} maxFontSizeMultiplier={1.3}>
                {day && day.activeKcal > 0 ? day.activeKcal.toLocaleString() : '—'}
                {day && day.activeKcal > 0 && <Text style={s.statUnit}> kcal</Text>}
              </Text>
            </View>
          </View>
          {!hasData && <Text style={s.emptyT}>{t('この日の記録はありません')}</Text>}

          {/* その日の睡眠のステージ内訳（B-14a）。ステージデータが無い端末（Apple Watch無し等）は
              stages=null＝上の合計だけ。見出しは今日「昨夜の睡眠」／過去日「9/3 の睡眠」 */}
          {segs.length > 0 && (() => {
            let x = 0;
            return (
              <View style={s.slpBox}>
                <Text style={s.slpTitle}>{sleepHeading(viewDate, today)}</Text>
                <Text style={s.slpVal} maxFontSizeMultiplier={1.3}>{fmtHM(asleepH)}</Text>
                <View style={s.slpBarWrap}>
                  <Svg width={barW} height={14}>
                    {segs.map((sg) => {
                      const w = (sg.h / segTotal) * barW;
                      const r = <Rect key={sg.k} x={x} y={0} width={w} height={14} fill={sg.color} />;
                      x += w;
                      return r;
                    })}
                  </Svg>
                </View>
                <View style={s.slpLegend}>
                  {segs.map((sg) => (
                    <View key={sg.k} style={s.slpLegendItem}>
                      <View style={[s.slpDot, { backgroundColor: sg.color }]} />
                      <Text style={s.slpLegendT}>{sg.label} {fmtHM(sg.h)}</Text>
                    </View>
                  ))}
                </View>
              </View>
            );
          })()}

          {/* 時間帯別の歩数（0〜23時）。運動タブ「きょうの動き」と同じ部品・こちらは少し大きく */}
          {hourly != null && hourly.some((v) => v > 0) && (
            <HourlyStepsChart hours={hourly} date={viewDate} today={today} barHeight={44} />
          )}

          {/* 週間歩数目標（B-15）: 選んだ日を含む週の進捗。目標オフなら出さない */}
          {weekStepsGoal != null && rows != null && (
            <WeekStepsBar days={rows} today={viewDate} goal={weekStepsGoal} weekLabel={weekLabel} />
          )}

          {/* 選んだ日を末尾とする7日の表。行タップでその日へ移動（DateStrip と同じ触覚） */}
          <View style={s.tableHead}>
            <Text style={s.tableTitle}>{t('{a}〜{b}の7日', { a: mdOf(dates[0]), b: mdOf(viewDate) })}</Text>
          </View>
          {rows?.map((a) => {
            const on = a.date === viewDate;
            return (
              <Pressable key={a.date} style={[s.actRow, on && s.actRowOn]} onPress={() => pickDate(a.date)}
                         accessibilityRole="button" accessibilityState={{ selected: on }}>
                <Text style={[s.actDate, on && s.actDateOn]}>{mdOf(a.date)}</Text>
                <View style={s.actCell}><Footprints size={ICON.xs} color={C.sub} /><Text style={s.actVal}>{a.steps > 0 ? t('{n}歩', { n: a.steps.toLocaleString() }) : '—'}</Text></View>
                <View style={s.actCell}><Moon size={ICON.xs} color={C.sub} /><Text style={s.actVal}>{a.sleepH > 0 ? `${a.sleepH}h` : '—'}</Text></View>
                {/* アクティブkcal（ヘルスケア実測・歩行や日常活動を含む） */}
                <View style={s.actCell}><Flame size={ICON.xs} color={C.sub} /><Text style={s.actVal}>{a.activeKcal > 0 ? `${a.activeKcal.toLocaleString()}kcal` : '—'}</Text></View>
              </Pressable>
            );
          })}
          {rows?.some((a) => a.activeKcal > 0) && (
            <Text style={s.note}>{t('アクティブは安静時を超えて消費したぶんの実測です（歩行・日常の動きを含み、アプリ記録ぶんも含まれることがあります）。')}</Text>
          )}
        </>
      )}
      {msg && <Text style={[s.note, { color: C.coral }]}>{msg}</Text>}
    </View>
  );
}

/** 読み込み中の骨組み（3スタット＋帯＋7行）。中身と同じ高さにして切り替え時の跳ねを抑える */
function HealthDetailSkeleton({ width }: { width: number }) {
  return (
    <View>
      <View style={s.stats}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={s.stat}>
            <Skeleton width={44} height={11} />
            <Skeleton width={72} height={22} style={{ marginTop: 6 }} />
          </View>
        ))}
      </View>
      <Skeleton width={width} height={14} radius={7} style={{ marginTop: 12 }} />
      <Skeleton width={width * 0.6} height={44} radius={8} style={{ marginTop: 16 }} />
      <View style={{ marginTop: 14 }}>
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <Skeleton key={i} width={width} height={14} style={{ marginTop: 12 }} />
        ))}
      </View>
    </View>
  );
}

const s = themed(() => ({
  // 詳細ページの旧 healthCard と同じカード（changes.tsx s.card と同値）。並べたカードの余白12も踏襲
  card: {
    backgroundColor: C.panel, borderWidth: StyleSheet.hairlineWidth, borderColor: C.hairline, borderRadius: RADIUS.card,
    shadowColor: C.shadow, shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 2,
    padding: SPACE.card, marginBottom: 12,
  },
  stripRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12 },
  dayLabel: { fontSize: 15, fontWeight: '800', color: C.ink, flexShrink: 1 },
  stats: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, backgroundColor: C.bg, borderRadius: RADIUS.tile, paddingVertical: 10, paddingHorizontal: 12 },
  statHead: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statLabel: { fontSize: 11.5, fontWeight: '700', color: C.sub },
  statVal: { fontSize: 20, fontWeight: '800', color: C.ink, fontVariant: ['tabular-nums'], marginTop: 4 },
  statUnit: { fontSize: 12, fontWeight: '700', color: C.sub },
  emptyT: { fontSize: 13, color: C.faint, fontWeight: '700', marginTop: 10, textAlign: 'center' },
  slpBox: { marginTop: 14 },
  slpTitle: { fontSize: 11, fontWeight: '800', color: C.sub, letterSpacing: 0.2 },
  slpVal: { fontSize: 26, fontWeight: '800', color: C.ink, fontVariant: ['tabular-nums'], marginTop: 2 },
  slpBarWrap: { borderRadius: 7, overflow: 'hidden', marginTop: 8, backgroundColor: C.track },
  slpLegend: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8 },
  slpLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  slpDot: { width: 8, height: 8, borderRadius: 4 },
  slpLegendT: { fontSize: 11, color: C.sub, fontWeight: '700', fontVariant: ['tabular-nums'] },
  tableHead: { marginTop: 16, marginBottom: 4 },
  tableTitle: { fontSize: 11, fontWeight: '800', color: C.sub, letterSpacing: 0.2 },
  actRow: {
    flexDirection: 'row', gap: 12, paddingVertical: 6, paddingHorizontal: 6, marginHorizontal: -6,
    borderTopWidth: 0.5, borderTopColor: C.line, alignItems: 'center', borderRadius: RADIUS.input,
  },
  actRowOn: { backgroundColor: C.accentSoft, borderTopColor: C.accentSoft },
  actDate: { fontSize: 13, color: C.faint, fontWeight: '700', width: 40, fontVariant: ['tabular-nums'] },
  actDateOn: { color: C.accentInk, fontWeight: '800' },
  actCell: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  actVal: { fontSize: 13, color: C.ink, fontVariant: ['tabular-nums'] },
  linkBtn: { backgroundColor: C.bg, borderWidth: 1.5, borderColor: C.line, borderRadius: RADIUS.chip, paddingVertical: 11, alignItems: 'center', marginTop: 4 },
  linkBtnT: { fontSize: 13, fontWeight: '800', color: C.ink },
  note: { fontSize: 13, color: C.faint, lineHeight: 18, marginTop: 8 },
}));
