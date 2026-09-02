// きょうのハイライト（B-16）— 概要メニューの最上部に「今日の1枚」を出すカード。
// 選定ロジックは lib/highlight.ts（純関数）。このコンポーネントは
//  ① 入力集め（画面が既に持つrowsを最大限使う。追加クエリは自己ベスト用の🏋️ログ1本だけ）
//  ② 1日1回判定（AsyncStorageに日付つきでキャッシュ・同日は再計算しない）
//  ③ 描画（他のメニュー行より少しリッチな1枚・タップで該当詳細へ）
// を担当する。どの候補も成立しない日はnullを返して何も出さない。
import { useEffect, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Sparkles } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { supabase } from '@/lib/supabase';
import { C, rgba, themed } from '@/lib/ui';
import { t } from '@/lib/i18n';
import { pickHighlight, highlightText, lastWeekStats, recentPR, type HighlightPick, type HighlightTarget } from '@/lib/highlight';
import { latestLawRaw } from '@/lib/laws';
import { assessBingeRisk, type InsightDay } from '@/lib/insights';
import { trendDirection } from '@/lib/trend';
import { trainingSeries } from '@/lib/training';
import { weightLookup } from '@/lib/liftLog';

// キャッシュ: { date, trendDir, pick }。pickは生値なのでJSONで往復しても言語切替に耐える
const CACHE_KEY = 'bl-highlight-v1';
type Cache = { date: string; trendDir: 'up' | 'down' | 'flat'; pick: HighlightPick | null };

export type HighlightRow = { date: string; intake: number | null; diff: number | null; weight: number | null };

export default function HighlightCard({ rows, today, ready, onOpen }: {
  rows: HighlightRow[];
  today: string;                          // todayJST（画面と同じ基準日）
  ready: boolean;                         // rowsのロード完了後にだけ判定する（空データで当日ぶんを確定させない）
  onOpen: (target: HighlightTarget) => void;
}) {
  const [pick, setPick] = useState<HighlightPick | null>(null);

  useEffect(() => {
    if (!ready) return;
    let alive = true;
    (async () => {
      // --- 同日はキャッシュをそのまま使う（1日1回判定） ---
      let cache: Cache | null = null;
      try { cache = JSON.parse((await AsyncStorage.getItem(CACHE_KEY)) || 'null') as Cache | null; } catch { /* 壊れていたら作り直す */ }
      if (cache?.date === today) {
        if (alive) setPick(cache.pick ?? null);
        return;
      }

      // --- 新しい日: 候補の入力を集めて選定する ---
      const weights = rows.filter((r) => r.weight != null).map((r) => ({ date: r.date, value: Number(r.weight) }));
      const trendDir = trendDirection(weights);

      // 候補1: 最新の法則（AsyncStorageを読むだけ）
      let law: Awaited<ReturnType<typeof latestLawRaw>> = null;
      try { law = await latestLawRaw(); } catch { /* 図鑑が無ければ候補から外れるだけ */ }

      // 候補2: 過食リスク（画面が持つrowsから昨日までの日次を組む。p/moodは無くても主要ルールは効く）
      let bingeLevel: 'low' | 'elevated' | 'high' | null = null;
      try {
        const days: InsightDay[] = rows
          .filter((r) => r.date < today)
          .map((r) => ({ date: r.date, intake: r.intake, p: null, diff: r.diff }));
        if (days.length > 0) bingeLevel = assessBingeRisk(days, new Date(today + 'T00:00:00').getDay()).level;
      } catch { /* 判定できなければ候補から外れるだけ */ }

      // 候補3: 先週の集計（ローカル計算）
      const lastWeek = lastWeekStats(rows, today);

      // 候補4: 自己ベスト（唯一の追加クエリ。🏋️ログ最大120行を1日1回だけ）
      let pr: { name: string; kg: number } | null = null;
      try {
        const res = await supabase.from('logs').select('date,text')
          .like('text', '🏋️%').order('at', { ascending: false }).limit(120);
        const wAt = weightLookup(rows.map((r) => ({ date: r.date, weight: r.weight })));
        const series = trainingSeries(((res.data ?? []) as { date: string; text: string }[]), wAt);
        pr = recentPR([...series.entries()].map(([name, pts]) => ({ name, pts })), today);
      } catch { /* 通信断などは候補から外れるだけ */ }

      const next = pickHighlight({
        today, law, bingeLevel,
        prevDate: cache?.date ?? null,
        lastWeek, pr, trendDir,
        prevTrendDir: cache?.trendDir ?? null,
      });
      if (alive) setPick(next);
      // 方向は選定結果に関わらず毎日保存する（次の「転換」検知の比較相手になる）
      try { await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ date: today, trendDir, pick: next } satisfies Cache)); }
      catch { /* 保存失敗は翌日また計算するだけ */ }
    })();
    return () => { alive = false; };
    // rowsは毎レンダー新配列になり得るためlengthで代表させる（判定は日付キャッシュで1日1回に抑えている）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, today, rows.length]);

  if (pick == null) return null;
  const { title, body } = highlightText(pick);

  return (
    <Pressable
      style={({ pressed }) => [s.card, pressed && { transform: [{ scale: 0.985 }], opacity: 0.92 }]}
      android_ripple={{ color: rgba(C.teal, 0.14), borderless: false }}
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        onOpen(pick.target);
      }}>
      <View style={s.icon}><Sparkles size={18} color={C.teal} /></View>
      <View style={{ flex: 1 }}>
        <Text style={s.label}>{t('きょうのハイライト')}</Text>
        <Text style={s.title}>{title}</Text>
        <Text style={s.body} numberOfLines={2}>{body}</Text>
      </View>
      <Text style={s.go}>›</Text>
    </Pressable>
  );
}

const s = themed(() => ({
  // メニュー行より少しリッチ: アクセントの薄い面＋アクセント寄りの枠＋やや強い影
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: C.accentSoft, borderWidth: 1, borderColor: C.accentBorder,
    borderRadius: 18, paddingHorizontal: 14, paddingVertical: 13, marginBottom: 12,
    shadowColor: C.shadow, shadowOpacity: 0.07, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2,
    overflow: 'hidden',   // Androidリップルを角丸内にクリップ
  },
  icon: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: C.accentBadge,
    alignItems: 'center', justifyContent: 'center',
  },
  label: { fontSize: 11, fontWeight: '800', color: C.teal, letterSpacing: 0.3 },
  title: { fontSize: 15.5, fontWeight: '800', color: C.ink, marginTop: 2 },
  body: { fontSize: 12.5, color: C.sub, lineHeight: 18, marginTop: 2 },
  go: { fontSize: 21, color: C.faint, fontWeight: '600', marginLeft: 2 },
}));
