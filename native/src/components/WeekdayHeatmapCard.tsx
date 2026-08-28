// 曜日のリズム（概要タブ・weekmap）
// 「金曜だけ崩れる」のような曜日単位の癖は、日々のグラフでは埋もれて本人も気づけない。
// 直近8週の「摂取−目標」を曜日×週のヒートマップにして、リズムをひと目で見せる。
// 責める言葉は使わず、観察（傾向）と先回りのコツだけを添える。
import { View, Text, StyleSheet } from 'react-native';
import { CalendarRange } from 'lucide-react-native';
import { C, rgba } from '@/lib/ui';
import { t } from '@/lib/i18n';
import { todayJST } from '@/lib/calc';

export type WeekRow = { date: string; intake: number | null; target: number };

// ヘッダは月はじまり（このアプリのカレンダー・週集計はすべて月曜起点）
const DOW_MON = () => [t('月'), t('火'), t('水'), t('木'), t('金'), t('土'), t('日')];
// getDay()(0=日)の曜日名。既存の「{d}曜日」文と同じ辞書キーを使う
const DOW_JA = ['日', '月', '火', '水', '木', '金', '土'];

function addDays(d: string, n: number): string {
  const dt = new Date(d + 'T00:00:00');
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function weekStartOf(d: string): string {
  const dt = new Date(d + 'T00:00:00');
  dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

export type WeekdayRhythm = {
  /** 直近8週の記録日数が14日以上あるか（未満なら判定しない） */
  enough: boolean;
  /** 最も崩れやすい曜日（0=日〜6=土）。全曜日が目標内ならnull */
  worstDow: number | null;
  /** その曜日の平均超過kcal（worstDowがnullならnull） */
  avgOver: number | null;
};

/** 曜日ごとの平均収支から「崩れやすい曜日」を出す。カードとメニュー要約行で共用する */
export function weekdayRhythm(rows: WeekRow[], today: string): WeekdayRhythm {
  const from = addDays(today, -56);
  const recent = rows.filter((r) => r.date > from && r.date <= today && r.intake != null);
  if (recent.length < 14) return { enough: false, worstDow: null, avgOver: null };
  // 曜日別に「摂取−目標」を平均（未記録日は分母に入れない＝記録がある日の実態だけを見る）
  const sum = Array(7).fill(0) as number[];
  const cnt = Array(7).fill(0) as number[];
  for (const r of recent) {
    const dow = new Date(r.date + 'T00:00:00').getDay();
    sum[dow] += Number(r.intake) - r.target;
    cnt[dow]++;
  }
  let worstDow: number | null = null;
  let worstAvg = 0;
  for (let d = 0; d < 7; d++) {
    if (cnt[d] === 0) continue;
    const avg = sum[d] / cnt[d];
    // +0以下は「目標内」。四捨五入で+0kcalになる微小超過も傾向とは呼ばない
    if (avg >= 1 && avg > worstAvg) { worstDow = d; worstAvg = avg; }
  }
  return { enough: true, worstDow, avgOver: worstDow == null ? null : Math.round(worstAvg) };
}

/** メニュー行のサマリー1行（changes.tsxのsummaryOfから呼ぶ） */
export function weekdayRhythmSummary(rows: WeekRow[], today: string): string {
  const r = weekdayRhythm(rows, today);
  if (!r.enough) return t('記録が貯まると曜日の癖が見えます');
  if (r.worstDow == null) return t('どの曜日も安定しています');
  return t('{d}曜日に崩れやすい', { d: t(DOW_JA[r.worstDow]) });
}

export default function WeekdayHeatmapCard({ rows }: { rows: WeekRow[] }) {
  const today = todayJST();
  const rhythm = weekdayRhythm(rows, today);

  const header = (
    <View style={s.h2Row}>
      <CalendarRange size={16} color={C.teal} />
      <Text style={s.h2}>
        {t('曜日のリズム')}
        <Text style={s.h2sub}>{t('— 直近8週の摂取と目標の差')}</Text>
      </Text>
    </View>
  );

  if (!rhythm.enough) {
    return (
      <View style={s.card}>
        {header}
        <Text style={s.muted}>{t('記録が2週間ぶん貯まると、あなたの曜日のリズムが見えてきます')}</Text>
      </View>
    );
  }

  // 日付→収支のマップ（未記録はundefinedのまま＝枠だけのセルになる）
  const diffBy = new Map<string, number>();
  for (const r of rows) {
    if (r.intake != null) diffBy.set(r.date, Number(r.intake) - r.target);
  }

  // 週（8行・上が古い）×曜日（月〜日）のグリッドを組む。今週は未来ぶんが空く
  const thisWs = weekStartOf(today);
  const weeks: { date: string; diff: number | null; future: boolean }[][] = [];
  for (let i = 7; i >= 0; i--) {
    const ws = addDays(thisWs, -7 * i);
    weeks.push(Array.from({ length: 7 }, (_, j) => {
      const date = addDays(ws, j);
      return { date, diff: diffBy.get(date) ?? null, future: date > today };
    }));
  }

  // セル色: 超過はアンバーを濃度で段階化（+600kcalで最濃）、目標内は薄いteal。
  // 生HEXを増やさず、共通のrgba()でCトークンから導出する
  function cellStyle(diff: number | null, future: boolean) {
    if (future) return { backgroundColor: 'transparent' };
    if (diff == null) return { backgroundColor: 'transparent', borderWidth: 1, borderColor: C.line };
    if (diff > 0) return { backgroundColor: rgba(C.amber, 0.25 + 0.6 * Math.min(1, diff / 600)) };
    return { backgroundColor: rgba(C.teal, 0.22) };
  }

  const worst = rhythm.worstDow;
  return (
    <View style={s.card}>
      {header}

      {/* 曜日ヘッダ（月はじまり） */}
      <View style={s.gridRow}>
        {DOW_MON().map((d, j) => (
          <Text key={j} style={s.dowT}>{d}</Text>
        ))}
      </View>

      {/* 8週ぶんのヒートマップ（上が古い週・下が今週） */}
      {weeks.map((week, i) => (
        <View key={i} style={s.gridRow}>
          {week.map((c) => (
            <View key={c.date} style={[s.cell, cellStyle(c.diff, c.future)]} />
          ))}
        </View>
      ))}

      {/* 凡例 */}
      <View style={s.legend}>
        <View style={s.legendItem}>
          <View style={[s.legendDot, { backgroundColor: rgba(C.amber, 0.7) }]} />
          <Text style={s.legendT}>{t('超過')}</Text>
        </View>
        <View style={s.legendItem}>
          <View style={[s.legendDot, { backgroundColor: rgba(C.teal, 0.22) }]} />
          <Text style={s.legendT}>{t('目標内')}</Text>
        </View>
        <View style={s.legendItem}>
          <View style={[s.legendDot, { backgroundColor: 'transparent', borderWidth: 1, borderColor: C.line }]} />
          <Text style={s.legendT}>{t('未記録')}</Text>
        </View>
      </View>

      {/* 言語化1行（このカードの主役）: 観察であって審判ではない */}
      {worst != null ? (
        <>
          <Text style={[s.verdict, { color: C.amber }]}>
            {t('{d}曜日に崩れやすい傾向（平均+{n}kcal）', { d: t(DOW_JA[worst]), n: rhythm.avgOver!.toLocaleString() })}
          </Text>
          <Text style={s.tip}>
            {t('先回りのコツ: {d}曜は昼を少し厚めにすると夜の反動が減ります', { d: t(DOW_JA[worst]) })}
          </Text>
        </>
      ) : (
        <Text style={[s.verdict, { color: C.teal }]}>{t('どの曜日も安定しています')}</Text>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: C.panel, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(14,17,22,0.08)', borderRadius: 20, shadowColor: '#0e1116', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 2, padding: 16, marginBottom: 12 },
  h2Row: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  h2: { fontSize: 17, fontWeight: '800', color: C.ink },
  h2sub: { fontSize: 12, fontWeight: '700', color: C.faint },
  muted: { fontSize: 13, color: C.sub, lineHeight: 19 },
  gridRow: { flexDirection: 'row', gap: 4, marginBottom: 4 },
  dowT: { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '700', color: C.sub },
  cell: { flex: 1, aspectRatio: 1.6, borderRadius: 6 },
  legend: { flexDirection: 'row', gap: 12, marginTop: 6, flexWrap: 'wrap' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 10, height: 10, borderRadius: 3 },
  legendT: { fontSize: 11, color: C.faint, fontWeight: '700' },
  verdict: { fontSize: 14, fontWeight: '800', marginTop: 10, lineHeight: 20 },
  tip: { fontSize: 13, color: C.sub, lineHeight: 19, marginTop: 4 },
});
