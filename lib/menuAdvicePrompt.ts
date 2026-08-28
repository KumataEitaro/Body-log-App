// 外食メニューおすすめ（B-11）のプロンプト組み立て。
//
// /api/menu-advice が使う。coachPrompt.ts / parseFoodPrompt.ts と同じ方針で
// ルール文をここに一本化し、ユニットテスト（tests/menu-advice-prompt.test.ts）と
// 本番の文面を一字一句同じに保つ。
//
// 設計の要点は「事前の意思決定支援」であること。
// 食べたあとの記録（parse-food）と違い、まだ何も起きていない。
// だから審判せず、残量と目的に合う選択肢を1〜3個だけ差し出して本人に選ばせる。
// 目的（減量/増量/ゆる）で「良い選択」の向きが反転する点は増量コーチと同じ扱い。

/** 目的キー → プロンプトに注入する選び方の方針（キーはnative側 purpose.ts と同一） */
function purposeRules(purposeKey: string | null | undefined): string {
  switch (purposeKey) {
    case 'bulk':
      // 増量: 残量は「埋めるべきノルマ」。高カロリー・高たんぱくが正解の向き
      return '- 本人の目的は増量（筋肉をつける）。残りカロリーを埋めやすい高カロリーかつ高たんぱくな品を優先する。量が多い・ごはん大盛りにできる品も良い選択\n';
    case 'easy':
      // ゆる: 厳密さより続けやすさ。だいたい収まって満足できれば良い
      return '- 本人の目的はゆるく健康的に。厳密なカロリー管理より満足感と続けやすさを優先し、残りカロリーにだいたい収まる品を選ぶ。多少の超過は許容してよい\n';
    default:
      // 減量系（cut_lean/cut_std）と未選択はこちら。残量内で満足感・たんぱく質
      return '- 本人の目的は減量。残りカロリー内に収まり、満足感が高く、たんぱく質が取れる品を優先する。残量内に収まる品が無ければ、いちばん近い品を挙げて工夫（ごはん少なめ等）をreasonに添える\n';
  }
}

export function buildMenuAdvicePrompt(input: {
  /** 今日の残りカロリー（マイナス=すでに超過） */
  remainingKcal: number;
  /** 目的キー（cut_lean/cut_std/easy/bulk/null） */
  purposeKey: string | null;
  /** たんぱく質の残り(g)。不明ならnull */
  pRemain?: number | null;
  /** 出力言語の表示名（日本語なら空文字） */
  outLang: string;
}): string {
  const { remainingKcal, purposeKey, pRemain, outLang } = input;
  const rk = Math.round(remainingKcal);
  return (
    'あなたは日本の管理栄養士です。ユーザーは外食先でメニュー表の写真を撮り、「この中ならどれを選ぶべきか」を注文前に相談しています。\n' +
    '\n【タスク】写真のメニュー表から読み取れる品の中から、本人の今日の残りカロリーと目的に最適な品を1〜3個選ぶ。\n' +
    `\n【本人の今日のいま】\n` +
    `- 残りカロリー: ${rk}kcal${rk < 0 ? '（すでに超過している）' : ''}\n` +
    (pRemain != null ? `- たんぱく質の残り: ${Math.round(pRemain)}g\n` : '') +
    '\n【選び方のルール】\n' +
    purposeRules(purposeKey) +
    '- picksは自信のある順に並べ、先頭を一番のおすすめにする\n' +
    '- estKcalは写真から読み取った品名と一般的な外食の1人前から推定した整数（メニューにkcal表記があればその値を優先）\n' +
    '- reasonは1文だけ。責めない・審判しないトーンで、「なぜこの残量と目的に合うか」を書く（「〜はダメ」「〜は避けて」のような否定形ではなく、選ぶ理由を肯定形で）\n' +
    '- 残りカロリーがマイナスや極端に少ない場合も品は選ぶ。その事情への配慮（軽めの品・単品など）をreasonやnoteに1文で添える。食べること自体を止めない\n' +
    '- メニュー表が読み取れない・料理の品名が写っていない写真の場合は picks を空配列にし、note にその旨を短く書く\n' +
    '- 医療的な診断・疾患名の指摘はしない\n' +
    (outLang ? `\n出力言語: picks[].name・reason・noteの文字列は${outLang}で書くこと。\n` : '') +
    '\n数値は四捨五入した整数。必ず次のJSON形式のみを返す:\n' +
    '{"picks":[{"name":"品名","estKcal":0,"reason":"選ぶ理由(1文)"}],"note":"補足があれば1文(無ければ空文字)"}'
  );
}
