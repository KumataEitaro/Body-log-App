// 過食の引き金カード（概要タブ）
// 「食べすぎた日」の前後に何が起きていたかを、本人のデータだけで可視化する。
// 相関であって因果ではないことを必ず添える。責める言葉は使わない。
import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Tornado } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { C } from '@/lib/ui';
import { t } from '@/lib/i18n';
import { fmtWeight } from '@/lib/units';
import { analyzeBinge, type AnalysisDay, type BingeReport } from '@/lib/bingeAnalysis';
import { mifflinBMR, targetKcal, type ExLevel } from '@/lib/calc';

const DOW = ['日', '月', '火', '水', '木', '金', '土'];

export default function BingeTriggerCard() {
  const [report, setReport] = useState<BingeReport | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;
      const [profRes, entRes, logRes] = await Promise.all([
        supabase.from('profiles').select('sex,height_cm,age,life_factor,init_weight').eq('id', session.user.id).maybeSingle(),
        supabase.from('entries').select('date,intake,weight,p,ex,adj').order('date', { ascending: true }).limit(400),
        supabase.from('logs').select('date,mood,text').order('date', { ascending: true }).limit(2000),
      ]);
      const prof = profRes.data as { sex: 'male' | 'female'; height_cm: number; age: number; life_factor: number; init_weight: number | null } | null;
      if (!prof || !entRes.data) return;

      // 日付ごとの気分・テキストをまとめる（過食の自己申告も引き金判定に使う）
      const moodBy = new Map<string, string>();
      const textBy = new Map<string, string>();
      for (const l of (logRes.data as { date: string; mood: string | null; text: string | null }[]) ?? []) {
        if (l.mood) moodBy.set(l.date, l.mood);
        if (l.text) textBy.set(l.date, (textBy.get(l.date) ?? '') + ' ' + l.text);
      }

      let w = Number(prof.init_weight) || 70;
      const days: AnalysisDay[] = (entRes.data as {
        date: string; intake: number | null; weight: number | null; p: number | null; ex: string | null; adj: number | null;
      }[]).map((e) => {
        if (e.weight != null) w = Number(e.weight);
        const bmr = mifflinBMR(prof.sex, w, Number(prof.height_cm), Number(prof.age));
        const target = targetKcal(bmr, Number(prof.life_factor), (e.ex as ExLevel) || 'オフ', Number(e.adj) || 0);
        const intake = e.intake == null ? null : Number(e.intake);
        return {
          date: e.date,
          intake,
          p: e.p == null ? null : Number(e.p),
          diff: intake == null ? null : Math.round(intake - target),
          weight: e.weight == null ? null : Number(e.weight),
          exKcal: e.adj == null ? null : Number(e.adj),
          mood: moodBy.get(e.date) ?? null,
          text: textBy.get(e.date) ?? null,
        };
      });
      setReport(analyzeBinge(days));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <View style={s.card}>
        <View style={s.h2Row}><Tornado size={16} color={C.teal} /><Text style={s.h2}>{t('過食の引き金')}</Text></View>
        <ActivityIndicator color={C.teal} style={{ marginTop: 10 }} />
      </View>
    );
  }
  if (!report) return null;

  if (!report.enough) {
    return (
      <View style={s.card}>
        <View style={s.h2Row}><Tornado size={16} color={C.teal} /><Text style={s.h2}>{t('過食の引き金')}</Text></View>
        <Text style={s.muted}>
          {t('3週間ほど記録が貯まると、食べすぎた日の前後に何が起きていたかを分析できます。')}
          {'\n'}{t('いまの記録')}: {t('{n}日', { n: report.totalDays })}
        </Text>
      </View>
    );
  }

  const top = report.triggers.slice(0, 4);
  const worstDow = [...report.dowRates].filter((d) => d.n >= 3).sort((a, b) => b.rate - a.rate)[0];

  return (
    <View style={s.card}>
      <View style={s.h2Row}>
        <Tornado size={16} color={C.teal} />
        <Text style={s.h2}>{t('過食の引き金')}</Text>
        <Text style={s.count}>{t('{n}日', { n: report.bingeDays })} / {t('{n}日', { n: report.totalDays })}</Text>
      </View>

      {top.length === 0 ? (
        <Text style={s.muted}>{t('いまのところ、はっきりした引き金は見つかりませんでした。良い状態です。')}</Text>
      ) : (
        <>
          <Text style={s.lead}>{t('食べすぎた日の「前」に多かったこと')}</Text>
          {top.map((tr) => (
            <View key={tr.key} style={s.trRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.trLabel}>{t(tr.label)}</Text>
                <Text style={s.trDetail}>{t(tr.detail)} ・ {t('{n}日中{m}日', { n: tr.n, m: tr.hits })}</Text>
              </View>
              <View style={s.liftBox}>
                <Text style={s.liftN}>{tr.lift.toFixed(1)}<Text style={s.liftX}>{t('倍')}</Text></Text>
                <Text style={s.liftSub}>{Math.round(tr.withRate * 100)}% / {Math.round(tr.withoutRate * 100)}%</Text>
              </View>
            </View>
          ))}
        </>
      )}

      {worstDow && worstDow.rate > 0 && (
        <Text style={s.dow}>
          {t('曜日では')} <Text style={{ fontWeight: '800', color: C.ink }}>{t(DOW[worstDow.dow])}{t('曜日')}</Text>
          {t('がいちばん多く、')}{Math.round(worstDow.rate * 100)}%{t('の日で食べすぎています。')}
        </Text>
      )}

      {/* 過食の「後」に何が起きるか */}
      <View style={s.afterBox}>
        <Text style={s.lead}>{t('食べすぎた日の「後」に起きていること')}</Text>
        {report.after.chainRate != null && (
          <Text style={s.afterT}>
            ・{t('翌日も食べすぎた割合')}: <Text style={s.afterN}>{Math.round(report.after.chainRate * 100)}%</Text>
          </Text>
        )}
        {report.after.logDropRate != null && report.after.logDropRate > 0 && (
          <Text style={s.afterT}>
            ・{t('翌日に記録が途切れた割合')}: <Text style={s.afterN}>{Math.round(report.after.logDropRate * 100)}%</Text>
          </Text>
        )}
        {report.after.weightDelta != null && (
          <Text style={s.afterT}>
            ・{t('翌朝の体重変化')}: <Text style={s.afterN}>{report.after.weightDelta >= 0 ? '+' : ''}{fmtWeight(Math.abs(report.after.weightDelta), 2).replace(/^/, report.after.weightDelta < 0 ? '-' : '')}</Text>
          </Text>
        )}
        {report.after.recoverDays != null && (
          <Text style={s.afterT}>
            ・{t('体重が戻るまで')}: <Text style={s.afterN}>{t('平均{n}日', { n: report.after.recoverDays.toFixed(1) })}</Text>
          </Text>
        )}
      </View>

      <Text style={s.note}>
        {t('※ これは相関であり原因の断定ではありません。数字は「責めるため」ではなく、前もって手を打つための材料です。')}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 20, padding: 16, marginBottom: 12 },
  h2Row: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  h2: { fontSize: 17, fontWeight: '800', color: C.ink },
  count: { marginLeft: 'auto', fontSize: 13, color: C.sub, fontVariant: ['tabular-nums'] },
  lead: { fontSize: 13, fontWeight: '800', color: C.sub, marginTop: 4, marginBottom: 6 },
  muted: { fontSize: 13, color: C.sub, lineHeight: 19 },
  trRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: C.line },
  trLabel: { fontSize: 15, fontWeight: '700', color: C.ink },
  trDetail: { fontSize: 11, color: C.faint, marginTop: 2 },
  liftBox: { alignItems: 'flex-end', width: 78 },
  liftN: { fontSize: 17, fontWeight: '800', color: C.coral, fontVariant: ['tabular-nums'] },
  liftX: { fontSize: 11, fontWeight: '700', color: C.sub },
  liftSub: { fontSize: 11, color: C.faint, fontVariant: ['tabular-nums'] },
  dow: { fontSize: 13, color: C.sub, marginTop: 10, lineHeight: 19 },
  afterBox: { marginTop: 14, borderTopWidth: 0.5, borderTopColor: C.line, paddingTop: 10 },
  afterT: { fontSize: 13, color: C.sub, lineHeight: 21 },
  afterN: { fontWeight: '800', color: C.ink },
  note: { fontSize: 11, color: C.faint, marginTop: 12, lineHeight: 16 },
});
