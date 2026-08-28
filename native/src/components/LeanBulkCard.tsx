// リーンバルク・ガード（概要タブ・purpose==='bulk'のときだけ表示）
// 増量の失敗は「増えすぎ（脂肪）」と「増えていない（食べ不足）」の両側にある。
// 週あたりの体重増加ペースを見張り、+0.2〜+0.4kg/週の「筋肉の乗る帯」から
// 外れたら、カロリー目標の微調整（±200〜250kcal）を具体的に促す。
import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Pressable } from 'react-native';
import { Gauge, Dumbbell, ChevronRight } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { C } from '@/lib/ui';
import { t } from '@/lib/i18n';
import { todayJST } from '@/lib/calc';

type WeightRow = { date: string; weight: number };

function addDays(d: string, n: number): string {
  const dt = new Date(d + 'T00:00:00');
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

/** 期間内の体重平均（データ2点未満はnull＝判定に使わない） */
function avgIn(rows: WeightRow[], from: string, to: string): number | null {
  const xs = rows.filter((r) => r.date > from && r.date <= to);
  if (xs.length < 2) return null;
  return xs.reduce((a, r) => a + r.weight, 0) / xs.length;
}

export type BulkPace = {
  /** 今週のペース（kg/週）。データ不足はnull */
  pace: number | null;
  /** 前の週のペース（+0.4超が「2週続く」判定用）。不足はnull */
  prevPace: number | null;
};

/** 週あたり増加ペース＝「直近7日平均 − その前7日平均」。厳密な回帰より説明しやすさを優先 */
export function bulkPace(rows: WeightRow[], today: string): BulkPace {
  const a = avgIn(rows, addDays(today, -7), today);            // 直近7日
  const b = avgIn(rows, addDays(today, -14), addDays(today, -7));  // その前7日
  const c = avgIn(rows, addDays(today, -21), addDays(today, -14)); // さらに前7日
  const pace = a != null && b != null ? Math.round((a - b) * 100) / 100 : null;
  const prevPace = b != null && c != null ? Math.round((b - c) * 100) / 100 : null;
  return { pace, prevPace };
}

export default function LeanBulkCard() {
  const router = useRouter();
  const [rows, setRows] = useState<WeightRow[] | null>(null);
  const [lifting, setLifting] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { setRows([]); return; }
      const today = todayJST();
      const [entRes, logRes] = await Promise.all([
        // ペース判定に使うのは直近28日（前週比較のため3週前まで読む）
        supabase.from('entries').select('date,weight').gte('date', addDays(today, -28)).order('date', { ascending: true }),
        // 筋トレ継続チェック: 🏋️プレフィックス（DBの解析アンカー）を直近14日で探す
        supabase.from('logs').select('date,text').gte('date', addDays(today, -14)).order('date', { ascending: true }).limit(500),
      ]);
      setRows(((entRes.data as { date: string; weight: number | null }[]) ?? [])
        .filter((r) => r.weight != null)
        .map((r) => ({ date: r.date, weight: Number(r.weight) })));
      setLifting((((logRes.data as { text: string | null }[]) ?? [])
        .some((l) => (l.text ?? '').startsWith('🏋️'))));
    } catch {
      setRows([]);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const header = (
    <View style={s.h2Row}>
      <Gauge size={16} color={C.teal} />
      <Text style={s.h2}>{t('リーンバルク・ガード')}</Text>
    </View>
  );

  if (rows === null) {
    return <View style={s.card}>{header}<ActivityIndicator color={C.teal} style={{ marginTop: 10 }} /></View>;
  }

  const { pace, prevPace } = bulkPace(rows, todayJST());

  // 判定バンド: 増量で筋肉が乗るのはおよそ+0.2〜+0.4kg/週。
  // それ以上が2週続けば脂肪優位、それ以下は摂取不足のサイン
  let tone: string = C.sub;
  let verdict = '';
  let advice = '';
  let showGoalBtn = false;
  if (pace != null) {
    if (pace > 0.4 && prevPace != null && prevPace > 0.4) {
      tone = C.amber;
      verdict = t('脂肪優位のペース');
      advice = t('+0.4kg/週超が2週続いています。カロリー上乗せを+250kcalに緩めると、脂肪を抑えた増量に戻しやすくなります。');
      showGoalBtn = true;
    } else if (pace > 0.4) {
      tone = C.amber;
      verdict = t('今週はやや速め');
      advice = t('このペースがもう1週続くようなら、緩めどきです。');
    } else if (pace >= 0.2) {
      tone = C.teal;
      verdict = t('良い増量ペース');
      advice = t('筋肉の乗りやすい帯（+0.2〜+0.4kg/週）に入っています。この調子。');
    } else {
      tone = C.amber;
      verdict = t('増えていません');
      advice = t('あと+200kcalの上乗せを検討してみてください。増量の失敗の多くは「食べ忘れ」です。');
      showGoalBtn = true;
    }
  }

  return (
    <View style={s.card}>
      {header}
      {pace == null ? (
        <Text style={s.muted}>{t('体重の記録が貯まると判定できます')}</Text>
      ) : (
        <>
          <View style={s.paceRow}>
            <Text style={[s.paceN, { color: tone }]}>
              {pace > 0 ? '+' : ''}{pace.toFixed(2)}
              <Text style={s.paceU}> {t('kg/週')}</Text>
            </Text>
            <View style={[s.badge, { borderColor: tone }]}>
              <Text style={[s.badgeT, { color: tone }]}>{verdict}</Text>
            </View>
          </View>
          <Text style={s.sub}>{t('直近7日平均と、その前7日平均の差')}</Text>
          <Text style={s.advice}>{advice}</Text>
          {lifting && (
            <View style={s.liftRow}>
              <Dumbbell size={14} color={C.teal} />
              <Text style={s.liftT}>{t('挙上も継続中 → 筋肉の乗る増量です')}</Text>
            </View>
          )}
          {showGoalBtn && (
            <Pressable
              style={s.goalBtn}
              // カロリー目標は目標体重・期日から逆算されるため、緩める操作は目標シートで行う
              onPress={() => router.push({ pathname: '/settings', params: { open: 'goalW', ts: String(Date.now()) } })}
            >
              <Text style={s.goalBtnT}>{t('目標を見直す')}</Text>
              <ChevronRight size={15} color={C.teal} />
            </Pressable>
          )}
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: C.panel, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(14,17,22,0.08)', borderRadius: 20, shadowColor: '#0e1116', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 2, padding: 16, marginBottom: 12 },
  h2Row: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  h2: { fontSize: 17, fontWeight: '800', color: C.ink },
  muted: { fontSize: 13, color: C.sub, lineHeight: 19 },
  paceRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 2 },
  paceN: { fontSize: 30, fontWeight: '800', fontVariant: ['tabular-nums'] },
  paceU: { fontSize: 14, fontWeight: '700', color: C.sub },
  badge: { borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  badgeT: { fontSize: 12, fontWeight: '800' },
  sub: { fontSize: 12, color: C.faint, marginTop: 2 },
  advice: { fontSize: 14, color: C.ink, lineHeight: 21, marginTop: 10 },
  liftRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  liftT: { fontSize: 13, fontWeight: '700', color: C.teal },
  goalBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2,
    marginTop: 12, borderWidth: 1.5, borderColor: C.accentBorder, backgroundColor: C.accentSoft,
    borderRadius: 999, paddingVertical: 10,
  },
  goalBtnT: { fontSize: 13, fontWeight: '800', color: C.teal },
});
