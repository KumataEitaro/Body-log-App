// 「広告なしで使えます →」の控えめなスナックバー。
//
// 出す瞬間: **全画面広告（インタースティシャル）が閉じ切ったあと**。
// 広告を1枚見終わった直後が「広告を消したい」がいちばん自分の言葉になっている瞬間で、
// ここでの提示が最も効く。1回だけ・約6秒・×で閉じる（UndoSnackbar と同じ文法）。
//
// ===== AdMobポリシー上、絶対にやらないこと（配信停止のリスク） =====
//  1. **広告ビューに重ねない**。これは広告が閉じ切ってから（AdEventType.CLOSED のあと）
//     アプリ側のUIとして出る。広告の上には何も置かない
//  2. **広告の閉じるボタンを模倣しない**。この×はスナックバー自身を閉じるだけで、
//     広告の×の位置・見た目とは無関係（バナーの上に偽の×を置くのも同様に禁止）
//  3. **広告の表示を妨げない**。広告が出ている間はこのUIは存在しない
//
// ===== 文言の規約（docs/STRATEGY.md「静かな伴走者」） =====
//  - 事実だけを言う。「広告なしで使えます」＝プランの説明であって、広告への文句ではない
//  - 「我慢」「邪魔」「うんざり」「しつこい」など、罪悪感や不快感を煽る語を使わない
//  - 回数に応じて文言を強めない（1回目と2回目で同じ文言）。エスカレーションはしない
//  - 「あと◯回で…」のような焦らせ方をしない
//
// 表示条件は lib/ads.ts の shouldPitchAdRemoval（純関数）に集約:
// 広告が実際に出る状態（課金有効ビルド×無料プラン）× 直近1週間に1回以上見ている ×
// 今日の提示が2回未満。**RCキー未設定の現運用では常に false ＝この部品は眠ったまま**。
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import Reanimated, { SlideInDown, SlideOutDown } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { C, themed } from '@/lib/ui';
import { t } from '@/lib/i18n';
import { useGate } from '@/lib/gate';
import { useReduceMotion } from '@/lib/motion';
import { shouldPitchAdRemoval } from '@/lib/ads';
import { readPitchShownToday, readWeeklyImpressions, recordPitchShown } from '@/lib/adImpressions';

// 表示時間（約6秒）。Undoの5秒より少し長い＝読んでから判断する余裕を作る。
// 触覚は出さない（広告の直後に振動させると「広告に反応させられた」感じになる）
const PITCH_MS = 6000;

export type AdPitch = {
  /**
   * 誘導を出す（条件を満たさなければ何もしない）。
   * 全画面広告が**閉じ切ってから**呼ぶこと。
   */
  pitch: () => void;
  /** 画面末尾に描く要素 */
  element: ReactNode;
};

/**
 * 「広告なしで使えます」スナックバーの状態と表示要素。
 * bottom は画面下端からの距離（タブバーの上に重ねる位置は画面ごとに違う）。
 */
export function useAdPitch(bottom = 24): AdPitch {
  const { active, plan } = useGate();
  const router = useRouter();
  const [shown, setShown] = useState(0); // 0=非表示。1以上は表示中（key として使う）
  const keyRef = useRef(0);
  const gateRef = useRef({ active, plan });
  gateRef.current = { active, plan };

  const pitch = useCallback(() => {
    const g = gateRef.current;
    // 広告が出ない状態（RCキー未設定・課金者）では、非同期の読み込みすら始めない
    if (!shouldPitchAdRemoval({ active: g.active, plan: g.plan, impressions7d: 1, shownTodayCount: 0 })) return;
    (async () => {
      const [impressions7d, shownTodayCount] = await Promise.all([readWeeklyImpressions(), readPitchShownToday()]);
      if (!shouldPitchAdRemoval({ active: g.active, plan: g.plan, impressions7d, shownTodayCount })) return;
      await recordPitchShown();
      setShown(++keyRef.current);
    })().catch(() => { /* 誘導が出ないだけ。画面は止めない */ });
  }, []);

  const element = (
    // ラッパーは常設（アンマウント時の退場アニメを生かす）。触れない領域は素通し
    <View pointerEvents="box-none" style={[sp.wrap, { bottom }]}>
      {shown > 0 && (
        <Bar key={shown}
             onClose={() => setShown(0)}
             onOpen={() => { setShown(0); router.push('/paywall?src=ads_after' as never); }} />
      )}
    </View>
  );
  return { pitch, element };
}

function Bar({ onClose, onOpen }: { onClose: () => void; onOpen: () => void }) {
  const reduce = useReduceMotion();
  useEffect(() => {
    const id = setTimeout(onClose, PITCH_MS);
    return () => clearTimeout(id);
    // onClose は毎レンダー作り直されるが、タイマーは1回だけ張る
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Reanimated.View
      entering={reduce ? undefined : SlideInDown.springify().damping(18)}
      exiting={reduce ? undefined : SlideOutDown.duration(180)}
      style={sp.bar}
      testID="ad-pitch-snackbar"
    >
      {/* 本文ぜんたいがペイウォールへの導線（小さい文字を狙わせない）。
          文言は「広告なしで使えます」＝プランの事実のみ。回数や煽りは足さない */}
      <Pressable style={sp.main} onPress={onOpen} accessibilityRole="button"
                 accessibilityLabel={t('広告なしで使えます')}>
        <Text style={sp.label} numberOfLines={1}>{t('広告なしで使えます')}</Text>
        <Text style={sp.go}>→</Text>
      </Pressable>
      {/* この×はスナックバーを閉じるだけ。広告の閉じるボタンとは無関係（AdMob違反にならない
          位置・見た目にする＝広告ビューの外・アクセント色を使わない小さな×） */}
      <Pressable hitSlop={12} onPress={onClose} accessibilityRole="button" accessibilityLabel={t('閉じる')}>
        <Text style={sp.x}>×</Text>
      </Pressable>
    </Reanimated.View>
  );
}

const sp = themed(() => ({
  // 呼び出し側の bottom 指定で、タブバーの上に重なる位置に出す（UndoSnackbar と同じ流儀）
  wrap: { position: 'absolute', left: 16, right: 16, alignItems: 'stretch' },
  bar: {
    alignSelf: 'stretch',
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 16,
    paddingHorizontal: 14, paddingVertical: 11,
    shadowColor: C.shadow, shadowOpacity: 0.14, shadowRadius: 16, shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { flex: 1, fontSize: 14, fontWeight: '700', color: C.ink },
  go: { fontSize: 15, fontWeight: '800', color: C.accentInk },
  // ×は控えめ（faint）。アクセント色にすると「押させたいボタン」に見えてしまう
  x: { fontSize: 17, fontWeight: '700', color: C.faint, paddingHorizontal: 2 },
}));
