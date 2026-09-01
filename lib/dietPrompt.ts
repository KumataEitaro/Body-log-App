// 食事の制約（B-18）のAIプロンプト注入。docs/DIET-MODES.md §2 の二段構えの②。
//
// parse-food（食事解析）と menu-advice（メニューおすすめ）の両方がこれを使い、
// 文面を一本化する（coachPrompt.ts / parseFoodPrompt.ts と同じ方針）。
//
// ===== 設計の要点は「断定させない」こと（§6） =====
// AIに肯定的断定（安全・食べられます・〜フリー）を書かせた瞬間、このアプリは
// アレルギー事故の責任分界の議論に足を踏み入れる。だから
//   ・判断できないときは必ず maybe
//   ・none でも「含まれていない」と書かせない
//   ・警告のためだけに使い、安心を与える文を書かせない
// の3点をプロンプト側で明示的に禁止する。UI側の免責（警告行・常設表記）と二重にかける。
//
// モード名は native/src/content/dietRules.ts の label と対応させる（表示名だけの重複）。
// キーの正本はDBの profiles.diet_modes。未知のキーは無視して壊れないようにする。
const MODE_NAMES: Record<string, string> = {
  vegan: 'ビーガン（肉・魚・卵・乳・はちみつなど動物由来すべて）',
  vegetarian: 'ベジタリアン（肉・魚。卵と乳は避けない）',
  gluten_free: 'グルテンフリー（小麦・大麦・ライ麦）',
  halal: 'ハラール（豚・アルコール）',
  dairy_free: '乳製品なし（牛乳・チーズ・バター・生クリームなど乳由来）',
};

/**
 * AI判定を注入してよいプランか（docs/DIET-MODES.md §4の線引き）。
 * 端末内の辞書判定（黒のみ）は無料でも動く。ここで有料に置くのは精度と網羅性のほう。
 * 管理者免除（isUnlimited）は呼び出し側で or を取る。
 */
export function dietAiPlan(plan: string | null | undefined): boolean {
  return plan === 'standard' || plan === 'premium';
}

/** DBのjsonb値（何が入っていてもよい）→ 既知のモード名の配列 */
export function dietModeNames(modes: unknown): string[] {
  if (!Array.isArray(modes)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of modes) {
    if (typeof m !== 'string' || seen.has(m)) continue;
    seen.add(m);
    const name = MODE_NAMES[m];
    if (name) out.push(name);
  }
  return out;
}

/**
 * 制約ブロックを組み立てる。プリセットも自由記述も無ければ空文字（＝プロンプトは従来と一字も変わらない）。
 * @param noun 判定を付ける対象の呼び名（parse-food は「品目」/ menu-advice は「候補」）
 * @param field 判定を書き込むJSONの配列名（items / picks）
 */
export function buildDietBlock(input: {
  modes: unknown;
  custom?: unknown;
  noun: string;
  field: string;
}): string {
  const { modes, custom, noun, field } = input;
  const names = dietModeNames(modes);
  // 自由記述はユーザーの言葉をそのまま渡す（構造化しない）。長すぎる入力はプロンプトを壊すので切る
  const free = typeof custom === 'string' ? custom.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
  if (names.length === 0 && !free) return '';

  return (
    '\n【食事の制約（このユーザーが避けているもの）】\n' +
    (names.length > 0 ? `- ユーザーは次を避けています: ${names.join(' / ')}\n` : '') +
    (free ? `- 本人の言葉による指定: 「${free}」\n` : '') +
    `- ${field}[] の各${noun}に "dietFlag" を必ず付ける。値は "high"（対象を含む可能性が高い）/ "maybe"（製品・店・調理によって含む・写真やメモからは確定できない）/ "none"（該当する語が見当たらない）のいずれか。\n` +
    '- 写真やメモだけで判断できない場合は必ず "maybe" にする。原材料表示を読めていないのに "none" にしてはいけない。\n' +
    `- ${noun}を勝手に省いたり並べ替えたりしない。該当しそうなものも必ず残し、判定だけを付ける。\n` +
    '- 「安全です」「食べられます」「〜フリーです」「問題ありません」など、対象を含まないと断定する表現は絶対に書かない。\n' +
    '- "none" の場合も「含まれていません」と書かない。この判定は警告のためだけに使い、安心を与える文言には使わない。\n' +
    '- 医学的・栄養学的な助言や、アレルギーの安全確認に相当する表現もしない。\n'
  );
}
