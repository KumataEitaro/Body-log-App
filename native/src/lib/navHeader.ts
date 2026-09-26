// スタック画面のヘッダーを1か所に集約する（2026-09-16）。
//
// 2026-09-26 熊田さん: 戻るボタンは**すべて「戻る」に統一**する（「‹ 概要」のように行き先を名乗らない）。
//   経緯: 2026-09-16 に「開く側が ?from= を渡し、開かれた側が『‹ 概要』と名乗る」流儀にしたが、
//   概要タブの中の詳細ページ（自前の戻る行）や from を渡し忘れた入口（設定など）が「戻る」のままで、
//   同じアプリの中に2つの流儀がずっと同居していた。名乗る流儀は入口が増えるたびに漏れる構造なので、
//   **常に「戻る」** という漏れようのない規則へ倒す（UI の統一は最優先）。
//   `?from=` の仕組み（navFrom / useNavFromParam）は残す: ts ノンス（同じ画面を2回続けて開く）と、
//   筋トレ記録画面の「保存後の戻り先」の判定に使う。**表示文言には使わない**。
//   見張り: __tests__/navConsistency.test.ts（静的）＋ __tests__/navHeader.test.ts（実行時）
import { useLocalSearchParams } from 'expo-router';
import { Platform } from 'react-native';
import { C } from './ui';
import { t } from './i18n';

/** 遷移元の識別子。URL に載るので短い英字にする（戻り先の判定にだけ使う。表示には使わない） */
export type NavFrom =
  | 'log' | 'training' | 'coach' | 'changes'
  | 'settings' | 'achievements' | 'laws' | 'nutrient' | 'weekly';

/**
 * 戻るボタンの文言。**どこから来ても「戻る」**（2026-09-26）。
 * 引数は旧 API との互換のために受け取るが、文言には一切使わない（テストが見張る）
 */
export function fromLabel(_from?: string | undefined): string {
  return t('戻る');
}

/**
 * スタック画面の `Stack.Screen options`。全画面がこれを使う＝見た目が揃う。
 * 引数を取らない: 画面ごとに戻るラベルを変えられない形にしておく（統一の担保）。
 *
 * タイトルは本文側で出す流儀なので `title: ''` のまま（ヘッダーは戻る導線だけを担う）。
 * iOS はヘッダーを透過させて本文の背景を活かし、Android は不透明にする
 * （Android の透過ヘッダーは本文と重なって読めなくなるため。2026-09-01 のβ報告）。
 * iOS 26+ で不透明ヘッダーにすると automatic inset が二重に効いて空白帯が出る（2026-09-26・設定画面）。
 */
export function stackHeaderOptions() {
  return {
    headerShown: true,
    title: '',
    headerBackTitle: t('戻る'),
    // iOS は横幅が足りないと戻るラベルを省く。'default' を明示して「戻る」を出す意思を残す（'minimal' 禁止）
    headerBackButtonDisplayMode: 'default',
    headerTintColor: C.teal,
    headerShadowVisible: false,
    ...(Platform.OS === 'ios'
      ? { headerTransparent: true }
      : { headerStyle: { backgroundColor: C.bg } }),
  } as const;
}

/** 画面側で1行呼ぶだけ。戻るラベルは常に「戻る」 */
export function useStackHeader() {
  return stackHeaderOptions();
}

/**
 * `?from=` の値だけを読む。
 * 筋トレ記録画面が「保存後の戻り先」の判定に使う（表示文言には使わない・2026-09-26）。
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
