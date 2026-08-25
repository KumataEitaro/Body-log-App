// 食事解析のループ検証ハーネス。
// 使い方: node scripts/parse-loop.mjs <QA_SECRETを書いたファイル>
// 本番の /api/parse-food-qa（本物のルール文・本物のモデル）に自由な書き方の
// 入力を投げ、「無言にならない・記録につながる・余計に聞き返さない」を機械評価する。
import fs from 'fs';

const SECRET = fs.readFileSync(process.argv[2], 'utf8').trim();
const URL_QA = 'https://bodylog-orcin.vercel.app/api/parse-food-qa';

// 実ユーザーに近いマイ食品辞書（辞書ルールの経路も踏む）
const DICT =
  '\n【ユーザー登録のマイ食品辞書（基準量あたり）】\n' +
  '- 野菜鍋 基準量:全量 = 450kcal P30 F12 C40\n' +
  '- プロテイン 基準量:1杯 = 120kcal P24 F2 C3 ／ 1回分の量:基準量の1倍=120kcal\n' +
  '辞書ルール:\n' +
  '- メモに辞書の名前（表記ゆれ含む）が出てきたら、一般的な推定ではなく登録値を基準に、書かれた分量に比例スケールして計算する（例: 基準量が全量で「1/3食べた」なら1/3倍、「丼1杯」など基準量と単位が違う場合は常識的に換算）。\n' +
  '- 分量の記載がなく「1回分の量」が登録されている場合は、質問せず1回分として計算する。「2杯」「2回分」等とあれば1回分×2。\n' +
  '- 分量の記載がなく、1回分の量も未登録で、基準量が「全量」など一度に食べきらない量の場合は、itemsに含めず"questions"配列に「◯◯はどのくらい食べましたか？（全量で△△kcal）」形式の日本語の質問を入れる。\n' +
  '- 分量の記載がなく、基準量が1個・1杯など単品の場合は基準量1つ分として計算する。\n';

const S = [
  { id: 'S1 曖昧な単位', text: 'キャベツ一袋',
    check: (r) => [
      ['品目になる or 質問が付く', (r.items?.length ?? 0) >= 1 || (r.questions?.length ?? 0) >= 1],
      ['仮定した場合はassumptionsに明記', (r.items?.length ?? 0) === 0 || (r.assumptions?.length ?? 0) >= 1],
    ] },
  { id: 'S2 総量申告', text: 'ウーバー等で6000キロカロリー食べた！笑',
    check: (r) => [
      ['1品目に変換される', (r.items?.length ?? 0) >= 1],
      ['kcalが申告値±10%', Math.abs((r.items?.[0]?.kcal ?? 0) - 6000) <= 600],
    ] },
  { id: 'S3 愚痴だけ', text: '今日は仕事で最悪だった。もう疲れた',
    check: (r) => [
      ['品目にしない', (r.items?.length ?? 0) === 0],
      ['moodを拾う', typeof r.mood === 'string' && r.mood.length > 0],
    ] },
  { id: 'S4 体重だけ', text: '体重87.4',
    check: (r) => [
      ['weightを拾う', Math.abs((r.weight ?? 0) - 87.4) < 0.01],
      ['品目にしない', (r.items?.length ?? 0) === 0],
    ] },
  { id: 'S5 明確な入力', text: '鶏むね肉200gと白米150g',
    check: (r) => [
      ['品目2件', (r.items?.length ?? 0) === 2],
      ['余計に聞き返さない', (r.questions?.length ?? 0) === 0],
    ] },
  { id: 'S6 聞き返しへの返答', text: '1/3くらい',
    history: [
      { role: 'user', text: '野菜鍋' },
      { role: 'ai', text: '野菜鍋はどのくらい食べましたか？（全量で450kcal）' },
    ],
    check: (r) => [
      ['文脈が繋がって品目化される', (r.items?.length ?? 0) >= 1],
      ['1/3にスケールされる(150kcal±20%)', Math.abs((r.items?.[0]?.kcal ?? 0) - 150) <= 30],
    ] },
  { id: 'S7 絵文字だけ', text: '🍜',
    check: (r) => [
      ['ラーメン等として品目化 or 質問', (r.items?.length ?? 0) >= 1 || (r.questions?.length ?? 0) >= 1],
    ] },
];

let pass = 0, fail = 0;
for (const sc of S) {
  const res = await fetch(URL_QA, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${SECRET}` },
    body: JSON.stringify({ text: sc.text, dictBlock: DICT, history: sc.history ?? [] }),
  });
  const j = await res.json().catch(() => ({}));
  const r = j.result ?? {};
  const checks = [
    ['APIがokを返した', !!j.ok],
    ['replyが必ずある（無言の禁止）', typeof r.reply === 'string' && r.reply.trim().length > 0],
    ...sc.check(r),
  ];
  const ng = checks.filter(([, ok]) => !ok);
  pass += checks.length - ng.length; fail += ng.length;
  console.log(`===== ${sc.id}: 「${sc.text}」 =====`);
  for (const [label, ok] of checks) console.log(` ${ok ? '○' : '✗'} ${label}`);
  console.log(` reply: ${String(r.reply ?? '').slice(0, 90)}`);
  if (r.items?.length) console.log(` items: ${r.items.map((i) => `${i.name}${i.qty ?? ''}=${i.kcal}kcal`).join('、')}`);
  if (r.assumptions?.length) console.log(` 仮定: ${r.assumptions.join(' / ')}`);
  if (r.questions?.length) console.log(` 質問: ${r.questions.join(' / ')}`);
  console.log('');
}
console.log(`合計: ○${pass} / ✗${fail}`);
