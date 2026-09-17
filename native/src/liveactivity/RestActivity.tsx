// レスト残り時間の Live Activity（ロック画面＋ダイナミックアイランド）。2026-09-17。
//
// 熊田さん「iPhone の場合はアプリを閉じていても、ダイナミックアイランドで残り分数が
//           分かるような通知形態にしたい。UberEats とかそうだよね」
//
// 【勘どころ】カウントダウンは **OS に数えさせる**。
// `<Text timerInterval={{lower, upper}} countsDown />` を渡すと、アプリが動いていなくても
// OS 側が毎秒描き替える。だから 1秒ごとの update も、サーバからのプッシュも**一切要らない**。
// レストは最長10分なので、Live Activity の8時間制限・4KB制限にもまったく触れない。
//
// 【'widget' ディレクティブの制約（Expo 公式・厳守）】
// この関数は**別のJSバンドル**にコンパイルされ、拡張の中の隔離ランタイムで走る。
//   ・@expo/ui/swift-ui のコンポーネントしか描けない
//   ・hooks / state / context / async / import / モジュールスコープの参照は**すべて禁止**
//   ・したがって t() も呼べない ⇒ **文言はアプリ側で訳して props で渡す**（label / title）
import { createLiveActivity } from 'expo-widgets';
import { Text, HStack, VStack, Image, Spacer } from '@expo/ui/swift-ui';

export type RestActivityProps = {
  /** レスト開始（epoch ms） */
  startedAtMs: number;
  /** レスト終了（epoch ms）。ここへ向かって OS がカウントダウンする */
  endsAtMs: number;
  /** 種目名（例: 懸垂）。空なら見出しだけ出す */
  exercise: string;
  /** 「レスト」に当たる語（アプリ側で翻訳して渡す） */
  label: string;
};

const RestActivity = (props: RestActivityProps) => {
  'widget';
  const range = { lower: new Date(props.startedAtMs), upper: new Date(props.endsAtMs) };
  return {
    // ロック画面のバナー
    banner: (
      <HStack>
        <Image systemName="timer" />
        <VStack>
          <Text>{props.label}</Text>
          <Text>{props.exercise}</Text>
        </VStack>
        <Spacer />
        <Text timerInterval={range} countsDown />
      </HStack>
    ),
    // ダイナミックアイランド（折りたたみ）＝熊田さんの言う「UberEats のやつ」
    compactLeading: <Image systemName="timer" />,
    compactTrailing: <Text timerInterval={range} countsDown />,
    // 他アプリと同時に出ているときの最小表示
    minimal: <Text timerInterval={range} countsDown />,
    // 長押しで開く展開表示
    expandedLeading: <Text>{props.exercise || props.label}</Text>,
    expandedTrailing: <Text timerInterval={range} countsDown />,
  };
};

export default createLiveActivity('RestActivity', RestActivity);
