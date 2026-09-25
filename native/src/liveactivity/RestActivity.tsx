// レスト残り時間の Live Activity（ロック画面＋ダイナミックアイランド）。2026-09-17。
// 2026-09-25 から iOS ビルドの既定で入る。終了時のローカル通知は廃止し、画面の外はこれ一本。
//
// 熊田さん「iPhone の場合はアプリを閉じていても、ダイナミックアイランドで残り分数が
//           分かるような通知形態にしたい。UberEats とかそうだよね」
//
// 【勘どころ】カウントダウンは **OS に数えさせる**。
// `<Text timerInterval={{lower, upper}} countsDown />` を渡すと、アプリが動いていなくても
// OS 側が毎秒描き替える。だから 1秒ごとの update も、サーバからのプッシュも**一切要らない**。
// レストは最長10分なので、Live Activity の8時間制限・4KB制限にもまったく触れない。
//
// 【終わったあと】start() に staleDate＝終了時刻を渡してあるので、その時刻を過ぎると OS が
// environment.isStale=true で描き直す。バックグラウンドでは JS が止まり end() を呼べないが、
// 島には「レスト終了」が出て、0:00 のタイマーが居座らない。畳むのは前景に戻ったとき／次の起動時。
//
// 【'widget' ディレクティブの制約（Expo 公式・厳守）】
// この関数は**別のJSバンドル**にコンパイルされ、拡張の中の隔離ランタイムで走る。
//   ・@expo/ui/swift-ui のコンポーネントしか描けない
//   ・hooks / state / context / async / import / モジュールスコープの参照は**すべて禁止**
//   ・したがって t() も呼べない ⇒ **文言はアプリ側で訳して props で渡す**（label / doneLabel）
import { createLiveActivity, type LiveActivityEnvironment } from 'expo-widgets';
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
  /** 「レスト終了」に当たる語（終了時刻を過ぎて isStale になったら出す） */
  doneLabel: string;
};

const RestActivity = (props: RestActivityProps, env: LiveActivityEnvironment) => {
  'widget';
  const range = { lower: new Date(props.startedAtMs), upper: new Date(props.endsAtMs) };
  const done = env.isStale === true;
  // 残り時間（OS が数える）。終わっていれば「レスト終了」
  const clock = done ? <Text>{props.doneLabel}</Text> : <Text timerInterval={range} countsDown />;
  return {
    // ロック画面のバナー
    banner: (
      <HStack>
        <Image systemName={done ? 'checkmark.circle' : 'timer'} />
        <VStack>
          <Text>{done ? props.doneLabel : props.label}</Text>
          <Text>{props.exercise}</Text>
        </VStack>
        <Spacer />
        {clock}
      </HStack>
    ),
    // ダイナミックアイランド（折りたたみ）＝熊田さんの言う「UberEats のやつ」
    compactLeading: <Image systemName={done ? 'checkmark.circle' : 'timer'} />,
    compactTrailing: clock,
    // 他アプリと同時に出ているときの最小表示
    minimal: clock,
    // 長押しで開く展開表示
    expandedLeading: <Text>{props.exercise || props.label}</Text>,
    expandedTrailing: clock,
  };
};

export default createLiveActivity('RestActivity', RestActivity);
