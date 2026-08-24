// コーチAIのループ検証ハーネス。
// 使い方: node scripts/coach-loop.mjs <QA_SECRETを書いたファイル>
// QA_SECRET は Vercel の環境変数（Sensitive）。値を失くしたら
// vercel env rm QA_SECRET production → 新しい値で vercel env add し直す。
// 本番の /api/coach-qa を叩く＝本番と一字一句同じルール文・同じモデルで検証する。
// こちらで作るのは【本人データ】ブロック（合成ペルソナ）と評価だけ。
import fs from 'fs';

const SECRET = fs.readFileSync(process.argv[2], 'utf8').trim();
const URL_QA = 'https://bodylog-orcin.vercel.app/api/coach-qa';

function dataBlock(sc) {
  return (
    `【今日のいま（${sc.hour}時時点）】\n` +
    `今日の目標: ${sc.goal}kcal（計画） / 摂取済み: ${sc.eaten}kcal → 残り ${sc.goal - sc.eaten}kcal\n` +
    `残りPFC: P あと${sc.leftP}g / F あと${sc.leftF}g / C あと${sc.leftC}g\n` +
    `今日食べたもの: ${sc.ate || 'まだ記録なし'}\n` +
    `本人のマイ食品（よく食べる定番）: 皮なし鶏むね肉(100g 108kcal P22) / 木綿豆腐(150g 110kcal P10) / 卵(1個 76kcal P6) / 白米(150g 234kcal P4) / プロテイン(1杯 120kcal P24) / サラダチキン(1袋 114kcal P24) / オートミール(40g 140kcal P5)\n` +
    '\n' +
    `【本人データ（直近28日・今日=2026-08-24）】\n` +
    `維持カロリー目安: 2113kcal/日（基礎代謝1720）\n` +
    `目標: 80kgまで（2026-10-31まで）\n` +
    `直近7日: 平均摂取1650kcal・平均収支-460kcal・P平均128g・未記録1日\n` +
    `その前3週間: 平均摂取1710kcal・平均収支-400kcal\n` +
    `体重: 28日間で-1.9kg（現在87.4kg）\n` +
    `栄養素の推定平均: 食物繊維: 約12g/日 (目安21g・記録14日分) / 食塩相当量: データなし\n` +
    `睡眠: データなし\n` +
    `直近7日の日別:\n08/23: 摂取1720(収支-393) P131g 気分:🙂\n08/22: 摂取1590(収支-523) P140g`
  );
}

const SCENARIOS = [
  { id: 'S1朝',   hour: 7,  goal: 1580, eaten: 0,    leftP: 140, leftF: 44, leftC: 168, ate: '',
    q: '眠い。朝ごはん何がいい？', expectMeal: true },
  { id: 'S2昼',   hour: 12, goal: 1580, eaten: 420,  leftP: 118, leftF: 32, leftC: 130, ate: 'オートミール40g、卵2個、プロテイン1杯',
    q: 'コンビニで買える組み合わせで、残りに収まるものは？', expectMeal: true },
  { id: 'S3夜',   hour: 19, goal: 1580, eaten: 901,  leftP: 71,  leftF: 27, leftC: 32,  ate: 'オートミール40g、卵2個、プロテイン1杯、サラダチキン、白米150g',
    q: '今日の残りに収まる夕食を提案して', expectMeal: true },
  { id: 'S4端数', hour: 21, goal: 1580, eaten: 1400, leftP: 12,  leftF: 4,  leftC: 10,  ate: '（3食記録済み）',
    q: '残り180kcalしかない。何か食べられる？', expectMeal: true },
  { id: 'S5超過', hour: 21, goal: 1580, eaten: 1630, leftP: -5,  leftF: -3, leftC: -8,  ate: '（3食＋間食）',
    q: 'もう50kcalオーバーしてる。夜どうすればいい？', expectMeal: false },
  { id: 'S6曖昧', hour: 21, goal: 1580, eaten: 1200, leftP: 30,  leftF: 10, leftC: 20,  ate: '（3食記録済み）',
    q: '最近つらい', expectMeal: false, expectFollowUp: true },
  { id: 'S7曖昧', hour: 12, goal: 1580, eaten: 420,  leftP: 118, leftF: 32, leftC: 130, ate: 'オートミール40g、卵2個',
    q: 'なんかやる気が出ない', expectMeal: false, expectFollowUp: true },
];

let pass = 0, fail = 0;
for (const sc of SCENARIOS) {
  const res = await fetch(URL_QA, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${SECRET}` },
    body: JSON.stringify({ dataBlock: dataBlock(sc), question: sc.q }),
  });
  const j = await res.json().catch(() => ({}));
  const ans = String(j.answer || '');
  const act = j.action;
  const remaining = sc.goal - sc.eaten;

  const checks = [];
  checks.push(['APIがokを返した', !!j.ok]);
  if (!sc.expectFollowUp) {
    checks.push(['結論が太字で始まる', /^\*\*/.test(ans.trim())]);
    checks.push(['箇条書きがある', /・/.test(ans)]);
    checks.push(['👉がある', ans.includes('👉')]);
  }
  checks.push(['指示形を使っていない', !/しましょう|してください|すべきです/.test(ans)]);
  if (sc.expectMeal) {
    const hasMeal = act && act.kind === 'meal' && Array.isArray(act.items) && act.items.length >= 1;
    checks.push(['mealアクションが付いた', !!hasMeal]);
    if (hasMeal) {
      const total = act.items.reduce((a, it) => a + (Number(it.kcal) || 0), 0);
      checks.push([`合計${total}kcalが残り${remaining}kcal以内(+10%許容)`, total <= remaining * 1.1]);
      const totP = act.items.reduce((a, it) => a + (Number(it.p) || 0), 0);
      checks.push([`P合計${totP}gが過剰でない`, totP <= Math.max(sc.leftP, 0) * 1.2 + 8]);
      checks.push(['品目が2〜8個', act.items.length >= 2 && act.items.length <= 8]);
    }
  } else if (sc.expectFollowUp) {
    checks.push(['mealアクションを付けていない（曖昧な相談）', !(act && act.kind === 'meal')]);
    checks.push(['聞き返しがある（？で本人に確かめる）', /[？?]s*$|[？?]」?s*$/.test(ans.trim()) || (ans.match(/[？?]/g) || []).length >= 1]);
    checks.push(['短い（4文・200字以内目安）', ans.length <= 260]);
    checks.push(['長文分析の構造を使っていない', !ans.includes('👉')]);
  } else {
    checks.push(['mealアクションを付けていない（超過時）', !(act && act.kind === 'meal')]);
    checks.push(['「今日はここまで」の趣旨がある', /ここまで|十分|よくやって|大丈夫|これ以上食べず|締めくく|誤差/.test(ans)]);
  }

  const ng = checks.filter(([, ok]) => !ok);
  pass += checks.length - ng.length; fail += ng.length;
  console.log(`===== ${sc.id}: 「${sc.q}」（残り${remaining}kcal） =====`);
  for (const [label, ok] of checks) console.log(` ${ok ? '○' : '✗'} ${label}`);
  if (act?.kind === 'meal') console.log(' 献立:', act.label, '|', act.items.map((i) => `${i.name}${i.qty}`).join('、'));
  if (ng.length) console.log('--- 回答全文 ---\n' + ans.slice(0, 800) + '\n----------------');
  console.log('');
}
console.log(`合計: ○${pass} / ✗${fail}`);
