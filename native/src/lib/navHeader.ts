// スタック画面のヘッダーを1か所に集約する（2026-09-16）。
//
// なぜ要るか:
//   タブ外のスタック画面（設定・実績・法則図鑑・栄養ランキング・週次レビュー・筋トレ記録・ペイウォール）は
//   それぞれが `Stack.Screen options` を**手書きでコピーしていた**。結果:
//     ・戻るラベルが全部「戻る」。一方、概要タブの中の詳細ページは「‹ 概要」と**行き先を名乗る**。
//       同じアプリの中で流儀が2つある（熊田さん指摘・2026-09-16）
//     ・`headerTintColor` や `headerTransparent` の有無が画面ごとに揺れていた
//
// iOS の作法では、戻るボタンは**前の画面の名前**を出す。
// ところがこのアプリのスタック画面は**複数のタブから開かれる**（例: 実績は 概要・食事・設定・🔥チップの4か所）。
// 固定文字では正しく名乗れないので、**開く側が `from` を渡し、開かれた側がそれを表示する**。
// 渡し忘れても「戻る」に落ちるだけで壊れない（テストで渡し忘れを見張る）。
import { useLocalSearchParams } from 'expo-router';
import { Platform } from 'react-native';
import { C } from './ui';
import { t } from './i18n';

/** 遷移元の識別子。URL に載るので短い英字にする（表示名は下の表で引く） */
export type NavFrom =
  | 'log' | 'training' | 'coach' | 'changes'
  | 'settings' | 'achievements' | 'laws' | 'nutrient' | 'weekly';

/** `from` → 戻るボタンに出す名前。タブ名・画面名と一字一句そろえる */
export function fromLabel(from: string | undefined): string {
  switch (from) {
    case 'log': return t('食事');
    case 'training': return t('運動');
    case 'coach': return t('相談');
    case 'changes': return t('概要');
    case 'settings': return t('設定');
    case 'achievements': return t('実績');
    case 'laws': return t('あなたの法則');
    case 'nutrient': return t('栄養ランキング');
    case 'weekly': return t('週のふりかえり');
    // 渡し忘れ・ディープリンク・通知からの起動。汎用に落とす（壊さない）
    default: return t('戻る');
  }
}

/**
 * スタック画面の `Stack.Screen options` を作る。全画面がこれを使う＝見た目が揃う。
 *
 * タイトルは本文側で出す流儀なので `title: ''` のまま（ヘッダーは戻る導線だけを担う）。
 * iOS はヘッダーを透過させて本文の背景を活かし、Android は不透明にする
 * （Android の透過ヘッダーは本文と重なって読めなくなるため。2026-09-01 のβ報告）。
 */
export function stackHeaderOptions(backTitle: string) {
  return {
    headerShown: true,
    title: '',
    headerBackTitle: backTitle,
    headerTintColor: C.teal,
    headerShadowVisible: false,
    ...(Platform.OS === 'ios'
      ? { headerTransparent: true }
      : { headerStyle: { backgroundColor: C.bg } }),
  } as const;
}

/**
 * 画面側で1行呼ぶだけ。`?from=changes` を読んで「‹ 概要」になる。
 * 渡されていなければ「戻る」。
 */
export function useStackHeader() {
  return stackHeaderOptions(fromLabel(useNavFromParam()));
}

/**
 * `?from=` の値だけを読む。
 * `stackHeaderOptions` に乗らない独自のヘッダー設定を持つ画面
 * （設定＝headerLargeStyle あり／筋トレ記録＝タイトルあり／週次レビュー）が、
 * 戻るラベルだけをここから取るために使う。
 */
export function useNavFromParam(): string | undefined {
  const { from } = useLocalSearchParams<{ from?: string }>();
  return from;
}

/**
 * 遷移するときの params を作る。呼び出し側は
 *   router.push({ pathname: '/achievements', params: navFrom('changes') })
 * と書く。`ts` は「同じ画面へ2回続けて飛ぶと expo-router が同一URLを無視する」対策で、
 * 既存の呼び出しが個別に付けていたものをここへ寄せた。
 */
export function navFrom(from: NavFrom | undefined, extra?: Record<string, string>) {
  return { ...(from ? { from } : {}), ts: String(Date.now()), ...(extra ?? {}) };
}
