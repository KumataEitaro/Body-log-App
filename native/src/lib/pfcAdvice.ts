import { t } from './i18n';
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

const HIGH_P_LOW_F = () => t('鶏むね肉・白身魚・ノンオイルツナ・無脂肪ヨーグルト');
const HIGH_P = () => t('鶏肉・魚・卵・大豆製品');
const CARB = () => t('ごはん・パン・いも類・果物');

export function pfcAdvice(left: PfcLeft): string {
  const { p, f, c, kcal } = left;
  const short = (n: number) => Math.round(n);

  // カロリー超過: 数字より気持ちの立て直しを優先
  if (kcal < -200) {
    return t('今日は目標より{n}kcal多めです。1日では体脂肪になりません。水分と軽い散歩でリセットし、明日はたんぱく質多めから始めましょう。', { n: short(-kcal).toLocaleString() });
  }
  if (kcal < 0) {
    return t('ほぼ目標どおりです（{n}kcal超過）。誤差の範囲なので気にしなくて大丈夫。あとは水分を意識しましょう。', { n: short(-kcal) });
  }

  // まだほとんど食べていない
  if (p > 0 && c > 0 && kcal > 1200) {
    return t('今日はこれから。{foods}を毎食に入れると、あと{n}gのたんぱく質を無理なく達成できます。', { foods: HIGH_P(), n: short(p) });
  }

  // たんぱく質が残っていて、脂質か炭水化物が尽きている＝低脂質・高たんぱくを選ぶ場面
  if (p > 15 && (f <= 5 || c <= 10)) {
    const tight = f <= 5 && c <= 10 ? t('脂質と炭水化物') : f <= 5 ? t('脂質') : t('炭水化物');
    return t('{tight}はもう十分なので、追加するなら「低脂質・高たんぱく」の{foods}が向いています。たんぱく質はあと{n}gです。', { tight, foods: HIGH_P_LOW_F(), n: short(p) });
  }

  // たんぱく質だけ大きく残っている
  if (p > 25) {
    return t('たんぱく質があと{n}g残っています。{foods}を1品足すと、筋肉を守りながら満腹感も続きます。', { n: short(p), foods: HIGH_P() });
  }

  // 炭水化物が大きく残っている（エネルギー不足でトレの質が落ちる）
  if (c > 60 && p <= 25) {
    return t('炭水化物があと{n}g残っています。少なすぎると力が出にくくなるので、{foods}で補うのがおすすめです。', { n: short(c), foods: CARB() });
  }

  // 脂質だけ余っている
  if (f > 20 && p <= 15 && c <= 40) {
    return t('脂質にまだ{n}gの余裕があります。ナッツ・オリーブオイル・青魚など質の良い脂質で摂るとホルモンバランスに役立ちます。', { n: short(f) });
  }

  // ほぼ達成
  if (p <= 10 && f <= 15 && c <= 30) {
    return t('今日のバランスはとても良い状態です。残り{n}kcalに無理に合わせる必要はありません。', { n: short(kcal) });
  }

  return t('残り{k}kcal。たんぱく質あと{p}g・脂質あと{f}g・炭水化物あと{c}gが目安です。', { k: short(kcal), p: short(p), f: short(f), c: short(c) });
}
