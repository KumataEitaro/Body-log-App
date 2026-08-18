// 残りPFCから「次に何を食べるといいか」を日本語の一言で返す（ローカル計算・AI不要で即時）
// 初心者は P/F/C の数字を見ても行動に移せないため、必ず具体的な食品名まで書く

export const PFC_LABEL = {
  p: 'たんぱく質',
  f: '脂質',
  c: '炭水化物',
} as const;

// 残量ストリップなど幅が狭い場所用の短縮形
export const PFC_SHORT = {
  p: 'たんぱく質',
  f: '脂質',
  c: '炭水化物',
} as const;

export type PfcLeft = { p: number; f: number; c: number; kcal: number };

const HIGH_P_LOW_F = '鶏むね肉・白身魚・ノンオイルツナ・無脂肪ヨーグルト';
const HIGH_P = '鶏肉・魚・卵・大豆製品';
const CARB = 'ごはん・パン・いも類・果物';

export function pfcAdvice(left: PfcLeft): string {
  const { p, f, c, kcal } = left;
  const short = (n: number) => Math.round(n);

  // カロリー超過: 数字より気持ちの立て直しを優先
  if (kcal < -200) {
    return `今日は目標より${short(-kcal).toLocaleString()}kcal多めです。1日では体脂肪になりません。水分と軽い散歩でリセットし、明日はたんぱく質多めから始めましょう。`;
  }
  if (kcal < 0) {
    return `ほぼ目標どおりです（${short(-kcal)}kcal超過）。誤差の範囲なので気にしなくて大丈夫。あとは水分を意識しましょう。`;
  }

  // まだほとんど食べていない
  if (p > 0 && c > 0 && kcal > 1200) {
    return `今日はこれから。${HIGH_P}を毎食に入れると、あと${short(p)}gのたんぱく質を無理なく達成できます。`;
  }

  // たんぱく質が残っていて、脂質か炭水化物が尽きている＝低脂質・高たんぱくを選ぶ場面
  if (p > 15 && (f <= 5 || c <= 10)) {
    const tight = f <= 5 && c <= 10 ? '脂質と炭水化物' : f <= 5 ? '脂質' : '炭水化物';
    return `${tight}はもう十分なので、追加するなら「低脂質・高たんぱく」の${HIGH_P_LOW_F}が向いています。たんぱく質はあと${short(p)}gです。`;
  }

  // たんぱく質だけ大きく残っている
  if (p > 25) {
    return `たんぱく質があと${short(p)}g残っています。${HIGH_P}を1品足すと、筋肉を守りながら満腹感も続きます。`;
  }

  // 炭水化物が大きく残っている（エネルギー不足でトレの質が落ちる）
  if (c > 60 && p <= 25) {
    return `炭水化物があと${short(c)}g残っています。少なすぎると力が出にくくなるので、${CARB}で補うのがおすすめです。`;
  }

  // 脂質だけ余っている
  if (f > 20 && p <= 15 && c <= 40) {
    return `脂質にまだ${short(f)}gの余裕があります。ナッツ・オリーブオイル・青魚など質の良い脂質で摂るとホルモンバランスに役立ちます。`;
  }

  // ほぼ達成
  if (p <= 10 && f <= 15 && c <= 30) {
    return `今日のバランスはとても良い状態です。残り${short(kcal)}kcalに無理に合わせる必要はありません。`;
  }

  return `残り${short(kcal)}kcal。たんぱく質あと${short(p)}g・脂質あと${short(f)}g・炭水化物あと${short(c)}gが目安です。`;
}
