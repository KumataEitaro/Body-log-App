// 「何を食べる？」（食事タブ内のAI相談）のプロンプト組み立て。
//
// /api/what-to-eat が使う。menuAdvicePrompt.ts / coachPrompt.ts と同じ方針でルール文をここに
// 一本化し、vitest（tests/what-to-eat-prompt.test.ts）と本番の文面を一字一句同じに保つ。
//
// 設計の要点は「注文前・調理前の意思決定支援」であること（B-11の外食おすすめと同じ立ち位置）。
// まだ何も起きていないので審判せず、残量・時間帯・目的・本人の法則に合う候補を3つ差し出して
// 本人に選ばせる。プロンプトは文脈チップによって3つの型に分かれる:
//   item  : コンビニ／外食／時間がない → すぐ買える・頼める「一品」（コンビニは具体的な商品カテゴリ）
//   menu  : 自炊 → 主菜＋副菜＋主食の「献立」
//   snack : 間食 → 1案200kcal以内

/** 文脈チップ（native/src/lib/whatToEat.ts EAT_CONTEXTS と同一。サーバーはここを正本として検証する） */
export const EAT_CONTEXTS = ['convenience', 'eatout', 'cook', 'snack', 'quick'] as const;
export type EatContext = (typeof EAT_CONTEXTS)[number];

export type EatPromptKind = 'item' | 'menu' | 'snack';

/** 文脈 → プロンプト型（nativeの promptKindOf と同じ写像） */
export function eatPromptKind(ctx: EatContext): EatPromptKind {
  if (ctx === 'cook') return 'menu';
  if (ctx === 'snack') return 'snack';
  return 'item';
}

/** 時間帯8区分（native/src/lib/timeSlots.ts TIME_SLOTS_8 と同一キー） */
export const EAT_SLOTS = ['earlyMorning', 'morning', 'forenoon', 'noon', 'afternoon', 'evening', 'night', 'lateNight'] as const;
export type EatSlot = (typeof EAT_SLOTS)[number];

const SLOT_LABEL: Record<EatSlot, string> = {
  earlyMorning: '早朝（4〜7時）', morning: '朝（7〜10時）', forenoon: '午前（10〜12時）', noon: '昼（12〜14時）',
  afternoon: '午後（14〜17時）', evening: '夕方（17〜20時）', night: '夜（20〜23時）', lateNight: '深夜（23〜4時）',
};

/** JSTの時 → 8区分（クライアントが slot を送ってこない旧版・欠落時の保険） */
export function slotOfHour(hour: number): EatSlot {
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  if (h >= 4 && h < 7) return 'earlyMorning';
  if (h >= 7 && h < 10) return 'morning';
  if (h >= 10 && h < 12) return 'forenoon';
  if (h >= 12 && h < 14) return 'noon';
  if (h >= 14 && h < 17) return 'afternoon';
  if (h >= 17 && h < 20) return 'evening';
  if (h >= 20 && h < 23) return 'night';
  return 'lateNight';
}

/** 提案は3案（nativeの PICK_TARGET と同値） */
export const EAT_PICK_TARGET = 3;

/** 1候補。dietFlag は食事の制約（B-18）に該当した可能性（該当なしはキーごと無し） */
export type EatPick = { name: string; estKcal: number; p: number; f: number; c: number; reason: string; dietFlag?: 'high' | 'maybe' };

/** AI応答のpicksを想定形だけに整える（プロンプトインジェクション等での型崩れを通さない）。最大3案 */
export function sanitizeEatPicks(v: unknown): EatPick[] {
  if (!Array.isArray(v)) return [];
  const clamp = (x: unknown, max: number) => {
    const n = Math.round(Number(x));
    return Number.isFinite(n) && n >= 0 && n <= max ? n : null;
  };
  const out: EatPick[] = [];
  for (const p of v) {
    if (p == null || typeof p !== 'object') continue;
    const o = p as Record<string, unknown>;
    const name = String(o.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
    const estKcal = clamp(o.estKcal, 3000);
    if (!name || estKcal == null) continue;
    const pick: EatPick = {
      name, estKcal,
      p: clamp(o.p, 500) ?? 0, f: clamp(o.f, 500) ?? 0, c: clamp(o.c, 500) ?? 0,
      reason: String(o.reason ?? '').replace(/\s+/g, ' ').trim().slice(0, 200),
    };
    // 安全を意味する値（none）はクライアントへ渡さない（docs/DIET-MODES.md §6）
    if (o.dietFlag === 'high' || o.dietFlag === 'maybe') pick.dietFlag = o.dietFlag;
    out.push(pick);
    if (out.length >= EAT_PICK_TARGET) break;
  }
  return out;
}

/** 目的キー → 選び方の方針（キーは lib/purpose.ts PURPOSE_PRESETS と同一） */
function purposeRules(purposeKey: string | null | undefined): string {
  switch (purposeKey) {
    case 'bulk':
      return '- 本人の目的は増量（筋肉をつける）。残りカロリーを埋めやすい高カロリーかつ高たんぱくな案を優先する。量を増やせる・炭水化物をしっかり取れる案も良い選択\n';
    case 'easy':
      return '- 本人の目的はゆるく健康的に。厳密なカロリー管理より満足感と続けやすさを優先し、残りカロリーにだいたい収まる案を出す。多少の超過は許容してよい\n';
    default:
      return '- 本人の目的は減量。残りカロリー内に収まり、満足感が高く、たんぱく質が取れる案を優先する。残量内に収まる案が無ければ、いちばん近い案を挙げて工夫（ごはん少なめ等）をreasonに添える\n';
  }
}

/** 文脈ごとの「型」の指示。nameの書式まで指定して、カードに載せたときの見た目を揃える */
function kindRules(ctx: EatContext): string {
  switch (ctx) {
    case 'convenience':
      return '【提案の型: コンビニの一品】\n' +
        '- 日本のコンビニで実際に買える具体的な商品カテゴリで答える（例: サラダチキン、鮭おにぎり、ゆで卵、カップ味噌汁、ギリシャヨーグルト、サラダ、豆腐バー、バナナ、無糖ヨーグルト）。特定の商品名・メーカー名は書かない\n' +
        '- 1案＝1〜3点の組み合わせ。nameは「サラダチキン＋鮭おにぎり」のように「＋」でつなぐ\n';
    case 'eatout':
      return '【提案の型: 外食の一品】\n' +
        '- 定食屋・ファミレス・チェーン店・居酒屋などで一般的に頼める料理名や定食で答える（例: 焼き魚定食（ごはん少なめ）、鶏の照り焼き丼、サラダ＋グリルチキン）。店名・メーカー名は書かない\n' +
        '- 1案＝1つの料理または定食。ごはん少なめ等の頼み方の工夫は名前の括弧内に添える\n';
    case 'quick':
      return '【提案の型: 時間がないときの一品】\n' +
        '- 調理不要か5分以内に用意できるものだけ（買ってそのまま・レンジ・お湯を注ぐ・切るだけ）。火を使う調理は出さない\n' +
        '- 1案＝1〜3点の組み合わせ。nameは「＋」でつなぐ\n';
    case 'cook':
      return '【提案の型: 自炊の献立】\n' +
        '- 主菜＋副菜＋主食の献立で答える。nameは「鶏むねの照り焼き・ほうれん草のおひたし・ごはん150g」のように「・」で区切り、主食には量（g）を書く\n' +
        '- 家庭にありがちな食材で、15〜30分で作れるもの。特別な調味料・器具は前提にしない\n';
    case 'snack':
      return '【提案の型: 間食】\n' +
        '- 1案200kcal以内の間食だけ。estKcalが200を超える案は絶対に出さない\n' +
        '- 小腹を満たしつつ、次の食事を邪魔しないもの（たんぱく質・食物繊維が取れる案を優先）\n';
  }
}

export function buildWhatToEatPrompt(input: {
  context: EatContext;
  /** 残りkcal（マイナス=すでに超過） */
  remainingKcal: number;
  pRemain?: number | null;
  fRemain?: number | null;
  cRemain?: number | null;
  slot: EatSlot;
  purposeKey: string | null;
  /** 本人の一言（例:「魚がいい」「安く」）。空なら行を出さない */
  note?: string;
  /** 出力言語の表示名（日本語なら空文字） */
  outLang: string;
  /** 食事の制約（B-18）の注入ブロック。未設定・無料プランでは空文字 */
  dietBlock?: string;
  /** 本人の法則（端末内分析・coachInsightsBlock）。空なら省く */
  insights?: string;
  /** 直近3日の食材タグ要約（「米: 約540g・鶏肉: 約300g」）。空なら省く */
  recentTags?: string;
  /** マイ食品の名前上位（最大10） */
  myFoods?: string[];
  /** 恒常的な制約（profiles.constraints_note） */
  constraintsNote?: string | null;
  /** 妊娠・授乳中（profiles.maternity） */
  maternity?: boolean;
  /** 再試行（1回目がJSONとして読めなかった）。形式の念押しを足す */
  retry?: boolean;
}): string {
  const { context, remainingKcal, pRemain, fRemain, cRemain, slot, purposeKey, outLang, dietBlock, insights, recentTags, retry } = input;
  const rk = Math.round(remainingKcal);
  const note = String(input.note ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const constraints = String(input.constraintsNote ?? '').replace(/\s*[\r\n]+\s*/g, ' / ').trim().slice(0, 500);
  const myFoods = (input.myFoods ?? []).map((s) => String(s).trim()).filter(Boolean).slice(0, 10);
  const kind = eatPromptKind(context);
  const g = (label: string, v: number | null | undefined) => (v != null && Number.isFinite(v) ? `- ${label}の残り: ${Math.round(v)}g\n` : '');

  return (
    'あなたは日本の管理栄養士です。ユーザーは食事の記録アプリの中で「いま何を食べようか」を決める前に相談しています。\n' +
    `\n【タスク】本人の今日の残りカロリー・残りPFC・時間帯・目的に合う候補をちょうど${EAT_PICK_TARGET}案、自信のある順に出す。先頭が一番のおすすめ。\n` +
    '\n' + kindRules(context) +
    `\n【本人の今日のいま（${SLOT_LABEL[slot]}）】\n` +
    `- 残りカロリー: ${rk}kcal${rk < 0 ? '（すでに超過している）' : ''}\n` +
    g('たんぱく質', pRemain) + g('脂質', fRemain) + g('炭水化物', cRemain) +
    (note ? `- 本人の一言（最優先で尊重する）: 「${note}」\n` : '') +
    (recentTags ? `- 直近3日でよく食べた食材: ${recentTags}\n` : '') +
    (myFoods.length ? `- 本人のマイ食品（いつもの定番）: ${myFoods.join(' / ')}\n` : '') +
    (insights ? `\n${insights}\n` : '') +
    '\n【選び方のルール】\n' +
    purposeRules(purposeKey) +
    (constraints ? `- 【最優先】ユーザーの恒常的な制約（提案がこれに反してはならない）: ${constraints}\n` : '') +
    (input.maternity ? '- 【最優先】本人は妊娠中または授乳中。カロリーを減らす方向の言い回しはせず、栄養の充足を軸に選ぶ。生もの・アルコール・カフェインの多いものは候補にしない\n' : '') +
    `- 時間帯を考慮する: 朝なら1日の残りの配分、${kind === 'snack' ? '間食なら次の食事を邪魔しない量' : '夜・深夜なら最後の1食として軽め・消化に優しいもの'}を意識する\n` +
    (recentTags ? '- 直近3日で偏っている食材は3案すべての主役にしない。少なくとも1案は別の食材群に振る（偏りを指摘・批判はしない）\n' : '') +
    (myFoods.length ? '- マイ食品に合うものがあれば、3案のうち1案までは本人の定番を主役にしてよい（再現しやすい）。無理に使わない\n' : '') +
    '- 3案は互いに違う方向性にする（同じ主菜の言い換えを並べない）\n' +
    '- estKcal・p・f・cは一般的な1人前から推定した整数（kcal・g）\n' +
    '- reasonは1文だけ。責めない・審判しないトーンで、「なぜこの残量・時間帯・目的に合うか」を肯定形で書く（「〜はダメ」「〜は避けて」の否定形は使わない）\n' +
    '- 残りカロリーがマイナスや極端に少ない場合も3案出す。その事情への配慮（軽めの案・少量）をreasonやnoteに1文で添える。食べること自体を止めない\n' +
    '- 医療的な診断・疾患名の指摘・治療に関わる助言はしない\n' +
    (dietBlock || '') +
    (outLang ? `\n出力言語: picks[].name・reason・noteの文字列は${outLang}で書くこと。\n` : '') +
    (retry ? '\n【重要】前回の応答はJSONとして読めませんでした。前置き・説明・コードフェンスを一切書かず、JSONオブジェクトだけを返すこと。\n' : '') +
    '\n数値は四捨五入した整数。必ず次のJSON形式のみを返す（picksはちょうど3要素）:\n' +
    // 制約が設定されている人だけ picks に dietFlag を足す（未設定の人の応答形は従来どおり）
    `{"picks":[{"name":"候補名","estKcal":0,"p":0,"f":0,"c":0,"reason":"選ぶ理由(1文)"${dietBlock ? ',"dietFlag":"none"' : ''}}],"note":"補足があれば1文(無ければ空文字)"}`
  );
}
