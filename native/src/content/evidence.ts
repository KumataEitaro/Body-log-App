// 法則の解説記事のエビデンス・カタログ（docs/INSIGHTS-ENGINE.md §0・§5・E1b）
//
// 役割: 「あなたの法則」の各カードをタップしたときに読める記事（app/law-detail.tsx）の本文。
// Appleヘルスケアの解説記事の骨格（§0）に合わせ、法則ごとに次の節を持つ:
//   ②これは何を意味するか ③科学的背景（出典つき） ④あなたができること（3つ）
//   ⑤医療機関に相談する目安（該当する法則のみ） ⑥注意（記事固有・共通注意は COMMON_CAUTIONS）
//   ⑦出典
// （①「あなたのデータ」は法則の生値から画面側で描くので、ここには無い）
//
// 執筆の規約:
//  ・出典は **実在を確認した文献だけ**（PubMed / DOI / 公的機関の公式ページ）。確認できない候補は載せない
//  ・「最新の研究では…」等の煽りは書かない。査読論文・メタ分析・公的ガイドラインを優先する
//  ・断定しない・診断しない。「〜と報告されている」「〜のとき〜が起きやすい」の線を守る
//  ・本文は長文のため t() を通さず { ja, en } の多言語オブジェクト（remoteContent の L10n と同じ流儀）。
//    英語は要点のみでよい。他言語は ja → en にフォールバック（pickL10n）
//  ・キーは evidenceKey（'kind' または 'kind:variant'）。未登録キーは FALLBACK_ARTICLE（準備中）に落ちる。
//    並行セッションが増やす新しい LawKind は、docs/INSIGHTS-ENGINE.md §3 末尾の表の evidenceKey で
//    ここに記事を追記する（E1c）
//  ・リモートの laws_text（lib/remoteContent）が同じ id に article を持てば **節ごとに上書き** する
import { getRemoteContent, pickL10n, type L10n, type RemoteLawArticle } from '@/lib/remoteContent';

// ===== 型 =====

/** 出典1件。url は DOI か PubMed か公的機関の公式ページ（https のみ） */
export type EvidenceSource = {
  authors: string;   // 「姓 イニシャル, …」。4名以上は et al.
  title: string;     // 原題
  journal: string;   // 誌名（略誌名）＋巻号ページ。公的文書は発行主体
  year: number;
  url: string;
};

/** 科学的背景の1段落。refs は同じ記事の sources の要素（番号は画面側で sources の位置から振る） */
export type SciencePara = { text: L10n; refs: EvidenceSource[] };

export type LawArticle = {
  meaning: L10n;          // ②これは何を意味するか（非審判・1〜2段落）
  science: SciencePara[]; // ③科学的背景
  actions: L10n[];        // ④あなたができること（3つ・小さく始められるもの）
  seeDoctor?: L10n;       // ⑤医療機関に相談する目安（該当する法則のみ）
  caution?: L10n;         // ⑥記事固有の注意（共通注意 COMMON_CAUTIONS に加えて出す）
  sources: EvidenceSource[]; // ⑦出典（science の refs はすべてここに含まれる）
};

// ===== 出典（実在確認済み・2026-09-02） =====
// 同じ文献を複数の記事で使うため定数にする。URLは PubMed（PMID）を第一候補、無ければ DOI

const SPIEGEL_2004: EvidenceSource = {
  authors: 'Spiegel K, Tasali E, Penev P, Van Cauter E',
  title: 'Brief communication: Sleep curtailment in healthy young men is associated with decreased leptin levels, elevated ghrelin levels, and increased hunger and appetite',
  journal: 'Ann Intern Med. 141(11):846-850', year: 2004,
  url: 'https://pubmed.ncbi.nlm.nih.gov/15583226/',
};
const GREER_2013: EvidenceSource = {
  authors: 'Greer SM, Goldstein AN, Walker MP',
  title: 'The impact of sleep deprivation on food desire in the human brain',
  journal: 'Nat Commun. 4:2259', year: 2013,
  url: 'https://pubmed.ncbi.nlm.nih.gov/23922121/',
};
const AL_KHATIB_2017: EvidenceSource = {
  authors: 'Al Khatib HK, Harding SV, Darzi J, Pot GK',
  title: 'The effects of partial sleep deprivation on energy balance: a systematic review and meta-analysis',
  journal: 'Eur J Clin Nutr. 71:614-624', year: 2017,
  url: 'https://doi.org/10.1038/ejcn.2016.201',
};
const HAEDT_MATT_2011: EvidenceSource = {
  authors: 'Haedt-Matt AA, Keel PK',
  title: 'Revisiting the affect regulation model of binge eating: a meta-analysis of studies using ecological momentary assessment',
  journal: 'Psychol Bull. 137(4):660-681', year: 2011,
  url: 'https://pubmed.ncbi.nlm.nih.gov/21574678/',
};
const RACETTE_2008: EvidenceSource = {
  authors: 'Racette SB, Weiss EP, Schechtman KB, et al.',
  title: 'Influence of weekend lifestyle patterns on body weight',
  journal: 'Obesity (Silver Spring)', year: 2008,
  url: 'https://pubmed.ncbi.nlm.nih.gov/18551108/',
};
const ORSAMA_2014: EvidenceSource = {
  authors: 'Orsama AL, Mattila E, Ermes M, van Gils M, Wansink B, Korhonen I',
  title: 'Weight rhythms: weight increases during weekends and decreases during weekdays',
  journal: 'Obes Facts. 7(1):36-47', year: 2014,
  url: 'https://pubmed.ncbi.nlm.nih.gov/24504358/',
};
const KREITZMAN_1992: EvidenceSource = {
  authors: 'Kreitzman SN, Coxon AY, Szaz KF',
  title: 'Glycogen storage: illusions of easy weight loss, excessive weight regain, and distortions in estimates of body composition',
  journal: 'Am J Clin Nutr. 56(1 Suppl):292S-293S', year: 1992,
  url: 'https://pubmed.ncbi.nlm.nih.gov/1615908/',
};
const HE_2001: EvidenceSource = {
  authors: 'He FJ, Markandu ND, Sagnella GA, MacGregor GA',
  title: 'Effect of salt intake on renal excretion of water in humans',
  journal: 'Hypertension. 38(3):317-320', year: 2001,
  url: 'https://pubmed.ncbi.nlm.nih.gov/11566897/',
};
const MCHILL_2017: EvidenceSource = {
  authors: 'McHill AW, Phillips AJ, Czeisler CA, et al.',
  title: 'Later circadian timing of food intake is associated with increased body fat',
  journal: 'Am J Clin Nutr. 106(5):1213-1219', year: 2017,
  url: 'https://pubmed.ncbi.nlm.nih.gov/28877894/',
};
const GARAULET_2013: EvidenceSource = {
  authors: 'Garaulet M, Gómez-Abellán P, Alburquerque-Béjar JJ, Lee YC, Ordovás JM, Scheer FA',
  title: 'Timing of food intake predicts weight loss effectiveness',
  journal: 'Int J Obes (Lond). 37(4):604-611', year: 2013,
  url: 'https://pubmed.ncbi.nlm.nih.gov/23357955/',
};
const VUJOVIC_2022: EvidenceSource = {
  authors: 'Vujović N, Piron MJ, Qian J, et al.',
  title: 'Late isocaloric eating increases hunger, decreases energy expenditure, and modifies metabolic pathways in adults with overweight and obesity',
  journal: 'Cell Metab. 34(10):1486-1498', year: 2022,
  url: 'https://doi.org/10.1016/j.cmet.2022.09.007',
};
const CRISPIM_2011: EvidenceSource = {
  authors: 'Crispim CA, Zimberg IZ, dos Reis BG, Diniz RM, Tufik S, de Mello MT',
  title: 'Relationship between food intake and sleep pattern in healthy individuals',
  journal: 'J Clin Sleep Med. 7(6):659-664', year: 2011,
  url: 'https://pubmed.ncbi.nlm.nih.gov/22171206/',
};
const ST_ONGE_2016: EvidenceSource = {
  authors: 'St-Onge MP, Roberts A, Shechter A, Choudhury AR',
  title: 'Fiber and saturated fat are associated with sleep arousals and slow wave sleep',
  journal: 'J Clin Sleep Med. 12(1):19-24', year: 2016,
  url: 'https://doi.org/10.5664/jcsm.5384',
};
const IAO_2021: EvidenceSource = {
  authors: 'Iao SI, Jansen E, Shedden K, et al.',
  title: 'Associations between bedtime eating or drinking, sleep duration and wake after sleep onset: findings from the American Time Use Survey',
  journal: 'Br J Nutr. 127(12)', year: 2021,
  url: 'https://doi.org/10.1017/S0007114521003597',
};
const WING_2005: EvidenceSource = {
  authors: 'Wing RR, Phelan S',
  title: 'Long-term weight loss maintenance',
  journal: 'Am J Clin Nutr. 82(1 Suppl):222S-225S', year: 2005,
  url: 'https://pubmed.ncbi.nlm.nih.gov/16002825/',
};
const BURKE_2011: EvidenceSource = {
  authors: 'Burke LE, Wang J, Sevick MA',
  title: 'Self-monitoring in weight loss: a systematic review of the literature',
  journal: 'J Am Diet Assoc. 111(1):92-102', year: 2011,
  url: 'https://pubmed.ncbi.nlm.nih.gov/21185970/',
};
const BYRNE_2003: EvidenceSource = {
  authors: 'Byrne S, Cooper Z, Fairburn C',
  title: 'Weight maintenance and relapse in obesity: a qualitative study',
  journal: 'Int J Obes Relat Metab Disord. 27(8):955-962', year: 2003,
  url: 'https://doi.org/10.1038/sj.ijo.0802305',
};
const LEIDY_2015: EvidenceSource = {
  authors: 'Leidy HJ, Clifton PM, Astrup A, et al.',
  title: 'The role of protein in weight loss and maintenance',
  journal: 'Am J Clin Nutr. 101(6):1320S-1329S', year: 2015,
  url: 'https://pubmed.ncbi.nlm.nih.gov/25926512/',
};
const HAINES_2003: EvidenceSource = {
  authors: 'Haines PS, Hama MY, Guilkey DK, Popkin BM',
  title: 'Weekend eating in the United States is linked with greater energy, fat, and alcohol intake',
  journal: 'Obes Res. 11(8):945-949', year: 2003,
  url: 'https://pubmed.ncbi.nlm.nih.gov/12917498/',
};
const ADAM_EPEL_2007: EvidenceSource = {
  authors: 'Adam TC, Epel ES',
  title: 'Stress, eating and the reward system',
  journal: 'Physiol Behav. 91(4):449-458', year: 2007,
  url: 'https://pubmed.ncbi.nlm.nih.gov/17543357/',
};
const POLIVY_HERMAN_1985: EvidenceSource = {
  authors: 'Polivy J, Herman CP',
  title: 'Dieting and binging. A causal analysis',
  journal: 'Am Psychol. 40(2):193-201', year: 1985,
  url: 'https://pubmed.ncbi.nlm.nih.gov/3857016/',
};
const MHLW_SLEEP_2023: EvidenceSource = {
  authors: '厚生労働省',
  title: '健康づくりのための睡眠ガイド2023',
  journal: '厚生労働省 健康・生活衛生局', year: 2024,
  url: 'https://www.mhlw.go.jp/content/001305530.pdf',
};
const MHLW_DRI_2025: EvidenceSource = {
  authors: '厚生労働省',
  title: '日本人の食事摂取基準（2025年版）',
  journal: '厚生労働省「日本人の食事摂取基準」策定検討会報告書', year: 2024,
  url: 'https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/kenkou_iryou/kenkou/eiyou/syokuji_kijyun.html',
};

// ===== 共通の注意（⑥）。すべての記事の末尾に出す =====
export const COMMON_CAUTIONS: L10n[] = [
  {
    ja: '相関は因果ではありません。この法則は「同じ時期に起きやすい」ことを示すだけで、原因を特定するものではありません。',
    en: 'Correlation is not causation. This pattern only shows what tends to happen together; it does not identify a cause.',
  },
  {
    ja: '体の反応には大きな個人差があります。研究は集団の平均を示すもので、あなたに当てはまるかどうかは、あなた自身の記録が教えてくれます。',
    en: 'Individual responses vary widely. Studies describe group averages; your own log is the best guide to what applies to you.',
  },
  {
    ja: 'BodyLogerは医療機器ではなく、診断や治療の代わりにはなりません。気になる症状があるときは医療機関に相談してください。',
    en: 'BodyLoger is not a medical device and does not replace diagnosis or treatment. See a healthcare professional about any symptoms that concern you.',
  },
];

// ===== 記事 =====

const FOOD_UP: LawArticle = {
  meaning: {
    ja: '翌日の体重が増えるとき、その大部分は「脂肪が増えた」のではなく、水分・塩分・グリコーゲン（糖質の貯蔵）・消化途中の食べものの重さです。1日で体脂肪が数百グラム増えるには数千kcalの超過が必要で、1食では起きにくいことです。\n塩分と糖質が多い食事は、翌朝に体が保持する水分を増やします。だからこの法則は「避けるべき食べもの」ではなく、「翌朝の体重に一時的なノイズを入れる食べもの」と読むのが正確です。',
    en: 'A next-day weight increase is mostly water, salt, glycogen (stored carbohydrate) and food still being digested, not body fat. Gaining several hundred grams of fat in one day would take thousands of excess kcal. Read this pattern as "a food that adds temporary noise to tomorrow\'s scale", not as a food to avoid.',
  },
  science: [
    {
      text: { ja: 'グリコーゲンは3〜4倍の重さの水と一緒に貯蔵されます。糖質の多い食事のあとに体重が増え、数日で戻るのはこのためで、体組成の推定を歪めるほど大きいことが指摘されています。',
      en: 'Glycogen is stored with 3-4 times its weight in water, which is why weight rises after a carbohydrate-rich meal and falls again within days.' },
      refs: [KREITZMAN_1992],
    },
    {
      text: { ja: '食塩の摂取量が増えると体は水分を保持します。高血圧の人を対象にした研究では、食塩の摂取が100mmol（食塩相当量で約6g）増えると1日の尿量が約0.4L減る、つまりそのぶんの水が体に残ると推定されています。',
      en: 'Higher salt intake makes the body retain water: each extra 100 mmol of sodium (about 6 g of salt) was estimated to reduce 24-hour urine volume by roughly 0.4 L.' },
      refs: [HE_2001],
    },
    {
      text: { ja: '80人の毎日の体重を追った研究では、体重は週末に増えて平日に減るという週内のリズムが見つかっています。日々の上下は「食べ方の周期」を映す正常な揺れです。',
      en: 'Daily weights of 80 adults showed a weekly rhythm: weight rises over the weekend and falls during the week. Day-to-day swings are a normal reflection of eating patterns.' },
      refs: [ORSAMA_2014],
    },
  ],
  actions: [
    { ja: '翌朝だけでなく「翌々日」の体重も見る。2日で戻っていれば、増えたのは水分です。', en: 'Check the scale two days later, not just the next morning. If it is back down, the gain was water.' },
    { ja: '同じ食べものの「塩分控えめ・量控えめ」版を一度試して、翌朝の差を記録で比べる。', en: 'Try a lower-salt or smaller version of the same food once and compare the next-day difference in your log.' },
    { ja: '体重は1日の値ではなく週平均で見る（概要タブのトレンドがその形です）。', en: 'Judge weight by the weekly average (the trend in the Overview tab), not by a single day.' },
  ],
  seeDoctor: {
    ja: 'むくみが何日も引かない、片側の足だけが腫れる、息切れや動悸を伴う、といった場合は食事の影響とは別の原因が考えられます。医療機関に相談してください。',
    en: 'Swelling that lasts for days, swelling in only one leg, or swelling with shortness of breath or palpitations may have a cause unrelated to food. See a doctor.',
  },
  sources: [KREITZMAN_1992, HE_2001, ORSAMA_2014],
};

const FOOD_SAFE: LawArticle = {
  meaning: {
    ja: '翌日に体重が下がりやすい食べものは、「食べると痩せる食べもの」ではありません。塩分や糖質が少なめで水分を溜めにくい、あるいは満腹感が高くてその日の総量が自然に抑えられた、といった理由が考えられます。\nあなたの体に「合う」食べものを知っていることは強みです。無理な我慢ではなく、置き換えの候補として使ってください。',
    en: 'A food followed by a lower weight the next day is not a "weight-loss food". It is more likely lower in salt or carbohydrate (less water retention) or more filling, so the day\'s total intake stayed lower. Use it as a swap, not as a rule.',
  },
  science: [
    {
      text: { ja: '体重の日々の上下の多くは、グリコーゲンとそれに伴う水分の出入りで説明できます。糖質・塩分が少ない食事のあとに体重が下がるのは、体脂肪の減少ではなく水分の変化が中心です。',
      en: 'Much of the day-to-day swing in weight is glycogen and its bound water. A lower reading after a low-carbohydrate, low-salt meal is mainly water, not fat.' },
      refs: [KREITZMAN_1992, HE_2001],
    },
    {
      text: { ja: 'たんぱく質は満腹感を高め、食欲と体重管理を助けることが複数のメタ分析で示されています。目安として体重1kgあたり1.2〜1.6g/日、1食25〜30gのたんぱく質が食欲面で有利と報告されています。',
      en: 'Protein increases satiety and supports appetite and weight management; intakes of 1.2-1.6 g/kg/day and 25-30 g per meal have been reported as beneficial.' },
      refs: [LEIDY_2015],
    },
    {
      text: { ja: '厚生労働省「日本人の食事摂取基準（2025年版）」は、たんぱく質や食物繊維の目標量、食塩相当量の目標量を年齢・性別ごとに示しています。「合う食べもの」を選ぶときの土台になります。',
      en: 'Japan\'s Dietary Reference Intakes (2025) set targets for protein, dietary fiber and salt by age and sex, and are a sound basis for choosing foods that suit you.' },
      refs: [MHLW_DRI_2025],
    },
  ],
  actions: [
    { ja: 'この食べものを「いつもの一品の置き換え」に使う（増やすのではなく、入れ替える）。', en: 'Use this food as a swap for a usual item, rather than adding it on top.' },
    { ja: 'なぜ合うのかを一度考えてみる（たんぱく質が多い？ 塩分が少ない？ 量が自然に収まる？）。', en: 'Ask why it suits you: more protein, less salt, or a portion that naturally stays small?' },
    { ja: '一つの食べものに寄せすぎない。多様な食材のほうが栄養の偏りが出にくい。', en: 'Do not lean on a single food; variety keeps nutrition balanced.' },
  ],
  sources: [KREITZMAN_1992, HE_2001, LEIDY_2015, MHLW_DRI_2025],
};

const WEEKDAY: LawArticle = {
  meaning: {
    ja: '特定の曜日に食べる量が増えるのは、意志の弱さではなく生活のリズムです。予定・外食・お酒・睡眠の変化は曜日に紐づいていて、全国規模の調査でも週末の摂取量は平日より多いことが繰り返し確認されています。\n「崩れる曜日」が分かっているなら、それはコントロールできる材料が一つ増えたということです。',
    en: 'Eating more on certain days reflects your weekly routine, not willpower: plans, eating out, alcohol and sleep all follow the calendar, and national surveys consistently find higher intake on weekends. Knowing your "off day" gives you one more thing you can plan around.',
  },
  science: [
    {
      text: { ja: '米国の全国代表調査では、金〜日曜日の摂取エネルギーは平日より1日あたり平均82kcal多く、19〜50歳では115kcal多いこと、脂質とアルコールからのエネルギーの割合が週末に上がることが報告されています。',
      en: 'In a nationally representative US survey, intake on Friday-Sunday averaged 82 kcal/day more than on weekdays (115 kcal for ages 19-50), with a higher share of energy from fat and alcohol.' },
      refs: [HAINES_2003],
    },
    {
      text: { ja: '1年間の減量試験では、週末は摂取が増えて活動が減り、週あたり約0.08kgの体重増につながっていました。食事制限で減量していた人は週末に減量が止まり、運動で減量していた人は週末に体重が増えていました。',
      en: 'In a one-year trial, weekends brought higher intake and lower activity, adding about 0.08 kg per week; the diet group stopped losing on weekends and the exercise group gained.' },
      refs: [RACETTE_2008],
    },
    {
      text: { ja: '80人の毎日の体重では、体重は土曜日から増え始め、火曜日から減り始める週内のリズムが見つかっています。減量に成功した人ほど、この「平日に取り戻す」形がはっきりしていました。',
      en: 'Daily weights of 80 adults rose from Saturday and fell from Tuesday; those who lost weight showed this weekday recovery most clearly.' },
      refs: [ORSAMA_2014],
    },
    {
      text: { ja: '長期にわたって減量を維持している人たちの特徴の一つとして、平日と週末で食事のパターンを一貫させていることが挙げられています。',
      en: 'People who maintain weight loss long term commonly keep a consistent eating pattern across weekdays and weekends.' },
      refs: [WING_2005],
    },
  ],
  actions: [
    { ja: 'その曜日の予定（外食・飲み会）を先に見て、朝と昼を少し軽めに組む。', en: 'Look at that day\'s plans (eating out, drinks) in advance and keep breakfast and lunch a little lighter.' },
    { ja: 'その曜日だけ、最初の一口をたんぱく質にする（満腹感が先に来る）。', en: 'On that day, make the first bite protein so fullness arrives earlier.' },
    { ja: '翌日はふつうに記録を続ける。「リセット」も「埋め合わせ」も要らない。', en: 'The next day, just keep logging. No reset, no compensation needed.' },
  ],
  sources: [HAINES_2003, RACETTE_2008, ORSAMA_2014, WING_2005],
};

const WEEKDAY_STABLE: LawArticle = {
  meaning: {
    ja: 'どの曜日も同じように食べられているのは、目立たないけれど大きな強みです。多くの人は週末に摂取が増え、平日に取り戻す形になります。あなたの記録にはその揺れが小さい。\n減量の維持に成功している人の特徴として「平日と週末の食べ方が一貫している」ことが挙げられていて、あなたはすでにそれを実践しています。',
    en: 'Eating about the same on every day of the week is a quiet but real strength. Most people eat more on weekends and recover on weekdays; your log shows little of that swing. Consistency across the week is a known trait of people who keep weight off.',
  },
  science: [
    {
      text: { ja: '長期にわたって減量を維持している人たちは、高い活動量や朝食をとることに加えて、平日と週末で食事のパターンを一貫させていることが報告されています。',
      en: 'Long-term maintainers report, among other habits, keeping a consistent eating pattern across weekdays and weekends.' },
      refs: [WING_2005],
    },
    {
      text: { ja: '一般には体重は週末に増えて平日に減る週内リズムがあり、80人の毎日の体重でもそのパターンが確認されています。曜日の揺れが小さい人は、このリズムに振り回されにくいと言えます。',
      en: 'Weight generally follows a weekly rhythm, rising over the weekend and falling on weekdays; a small day-of-week swing means you are less exposed to it.' },
      refs: [ORSAMA_2014],
    },
    {
      text: { ja: '食事・運動・体重を記録し続ける「自己モニタリング」は、体系的レビューで一貫して減量と関連しています。安定を保つ最も確かな方法は、今の記録を続けることです。',
      en: 'Self-monitoring of diet, activity and weight is consistently associated with weight loss in systematic reviews; keeping your current log is the surest way to stay steady.' },
      refs: [BURKE_2011],
    },
  ],
  actions: [
    { ja: '今のリズムを変えない。うまくいっているものは、いじらないのが正解。', en: 'Keep your current rhythm. What works does not need fixing.' },
    { ja: 'イベントの多い週だけ、体重を週平均で確認しておく。', en: 'In weeks with many events, glance at the weekly average weight.' },
    { ja: '記録は続ける。曜日の安定は、記録を続けている人にだけ見える法則です。', en: 'Keep logging. This kind of stability is only visible to people who keep records.' },
  ],
  sources: [WING_2005, ORSAMA_2014, BURKE_2011],
};

const BINGE_TRIGGER: LawArticle = {
  meaning: {
    ja: '食べすぎには前触れがあります。多くの場合、その種は「前日」にあります。我慢しすぎた日・たんぱく質が少なかった日・眠れなかった日・気分が落ちた日の翌日は、体と脳が食べものを強く求めるように傾きます。\nこれは意志の弱さではなく、予測できる反応です。予測できるなら、先回りできます。',
    en: 'Overeating has warning signs, and the seed is often planted the day before: too much restraint, too little protein, short sleep or low mood tilt body and brain toward food the next day. This is a predictable response, not weak will, and what is predictable can be planned for.',
  },
  science: [
    {
      text: { ja: '厳しい食事制限は、体の生理的な調節を「頭で決めたルール」で上書きすることになり、ルールが崩れた瞬間に抑制が外れて食べすぎに向かいやすい、という分析が古典的な論文で示されています（「我慢しすぎた翌日」の説明）。',
      en: 'Strict dieting replaces physiological regulation with cognitive rules; when the rule breaks, disinhibition follows and overeating becomes likely.' },
      refs: [POLIVY_HERMAN_1985],
    },
    {
      text: { ja: '日常生活の中で気分を繰り返し記録した36研究（968人）のメタ分析では、過食の直前は普段より否定的な気分が高いことが示されています（効果量0.63）。気分が落ちた翌日に食べすぎが起きやすいのは、この流れです。',
      en: 'A meta-analysis of 36 ecological momentary assessment studies (n=968) found negative affect is elevated before binge episodes (effect size 0.63).' },
      refs: [HAEDT_MATT_2011],
    },
    {
      text: { ja: '睡眠を4時間に制限した2晩のあと、満腹ホルモンのレプチンは18%減り、空腹ホルモンのグレリンは28%増え、空腹感と食欲が強まりました。一晩の断眠では、高カロリー食品への欲求が増え、判断を担う前頭葉の活動が下がることも脳画像で示されています。17研究のメタ分析では、部分的な睡眠不足の翌日は摂取が平均385kcal増える一方、消費エネルギーは増えませんでした。',
      en: 'Two nights of 4-hour sleep cut leptin by 18% and raised ghrelin by 28% with stronger hunger; one night of total sleep loss increased desire for high-calorie food and reduced frontal-lobe activity; a meta-analysis of 17 studies found partial sleep loss adds about 385 kcal the next day with no rise in expenditure.' },
      refs: [SPIEGEL_2004, GREER_2013, AL_KHATIB_2017],
    },
    {
      text: { ja: '慢性的なストレスはコルチゾールと報酬系を介して、高カロリーで嗜好性の高い食べものの摂取を増やす方向に働くことが総説で整理されています。',
      en: 'Chronic stress, via cortisol and the reward system, pushes intake toward highly palatable, high-calorie foods.' },
      refs: [ADAM_EPEL_2007],
    },
    {
      text: { ja: 'たんぱく質は満腹感を高めます。1食あたり25〜30gのたんぱく質が食欲の面で有利と報告されており、「前日のたんぱく質が少なかった」引き金の対策になります。',
      en: 'Protein increases satiety; about 25-30 g per meal has been reported to help appetite control.' },
      refs: [LEIDY_2015],
    },
  ],
  actions: [
    { ja: '引き金の日の翌朝は、たんぱく質を含む朝食を先にとる（卵・ヨーグルト・納豆・魚のどれか一つで十分）。', en: 'The morning after a trigger day, start with a protein breakfast (an egg, yogurt, natto or fish is enough).' },
    { ja: '「我慢の日」を作らない。赤字は小さく、毎日。大きな赤字の翌日ほど反動が来ます。', en: 'Avoid "restraint days". Keep the deficit small and daily; big deficits invite rebounds.' },
    { ja: '食べすぎた日も記録を続ける。記録が途切れた翌日は、それ自体が引き金になります。', en: 'Log even on overeating days. A gap in logging is itself a trigger the next day.' },
  ],
  seeDoctor: {
    ja: '食べすぎのあとに強い罪悪感や自己嫌悪が続く、嘔吐や絶食などで埋め合わせをしている、コントロールできない食べすぎが週に1回以上・数か月続いている、といった場合は、摂食に関する専門の相談が役に立つことがあります。医療機関や相談窓口に話してみてください。',
    en: 'If overeating is followed by lasting guilt, compensating by vomiting or fasting, or loss-of-control episodes happen weekly for months, specialist support for eating concerns can help. Talk to a clinician or a helpline.',
  },
  sources: [POLIVY_HERMAN_1985, HAEDT_MATT_2011, SPIEGEL_2004, GREER_2013, AL_KHATIB_2017, ADAM_EPEL_2007, LEIDY_2015],
};

const TIMESLOT: LawArticle = {
  meaning: {
    ja: '夜に食べること自体が悪いわけではありません。ただ、同じカロリーでも「体内時計に対して遅い時間」にとると、空腹感が強まり、消費エネルギーがわずかに下がることが、条件をそろえた実験で報告されています。\n夜勤や遅い帰宅なら、時計の21時ではなく「あなたの一日の終わり」に対して遅いかどうかで考えてください。',
    en: 'Eating at night is not wrong in itself. But when the same calories are eaten late relative to your body clock, controlled experiments report stronger hunger and slightly lower energy expenditure. If you work nights or get home late, think in terms of your own day\'s end rather than the clock.',
  },
  science: [
    {
      text: { ja: '過体重・肥満の成人を対象にした無作為化クロスオーバー試験では、同じ食事を4時間遅らせるだけで空腹感が増え、空腹ホルモン（グレリン）と満腹ホルモン（レプチン）の比が上がり、起きている間の消費エネルギーが下がり、脂肪組織の遺伝子発現が脂肪を溜める方向に変わりました。',
      en: 'In a randomized crossover trial in adults with overweight/obesity, shifting identical meals 4 hours later increased hunger and the ghrelin:leptin ratio, lowered waking energy expenditure and shifted adipose gene expression toward fat storage.' },
      refs: [VUJOVIC_2022],
    },
    {
      text: { ja: '日常生活の中で食事の時刻と体内時計（メラトニン分泌の開始）を測った研究では、体内時計上の夜に近い時間に多く食べる人ほど体脂肪率とBMIが高く、時計の時刻・摂取量・食事内容とは関連がありませんでした。問題は「何時か」より「あなたの夜にどれだけ近いか」です。',
      en: 'In free-living adults, eating closer to melatonin onset (biological night) was associated with higher body fat and BMI, independent of clock time, amount or composition of food.' },
      refs: [MCHILL_2017],
    },
    {
      text: { ja: '420人が20週間の減量プログラムに参加した研究では、一日の主な食事（この地域では昼食）を15時以降にとる人は、それより早い人に比べて減量の幅が小さく、ペースも遅いことが報告されています。',
      en: 'Among 420 people in a 20-week weight-loss program, those who ate their main meal after 3 pm lost less weight and more slowly than earlier eaters.' },
      refs: [GARAULET_2013],
    },
    {
      text: { ja: '就寝の1時間以内に飲食した人は、夜中に目が覚める（中途覚醒）リスクが高いことが米国の大規模な時間利用調査で示されています。厚生労働省の睡眠ガイドも、就寝直前の夜食は控えることを勧めています。',
      en: 'Eating or drinking within an hour of bedtime was associated with more waking after sleep onset in a large US time-use survey; Japan\'s sleep guideline also advises against late-night snacks right before bed.' },
      refs: [IAO_2021, MHLW_SLEEP_2023],
    },
  ],
  actions: [
    { ja: '夕食を1時間だけ早める。全部は変えなくていい、1時間で十分な変化です。', en: 'Move dinner one hour earlier. You do not need to change everything; one hour is a real change.' },
    { ja: '夜の分を夕方に「前借り」する（17時ごろに軽い間食を入れると、夜の量が自然に減る）。', en: 'Borrow from the night: a light snack around 5 pm naturally shrinks the late meal.' },
    { ja: '夜に食べる日は、就寝までに2時間あける。', en: 'On late-eating days, leave two hours before bed.' },
  ],
  seeDoctor: {
    ja: '朝はほとんど食欲がなく、夜中に目が覚めて食べる、あるいは一日の大半を夜に食べるパターンが数か月続いているときは、睡眠や摂食の専門家に相談する価値があります。',
    en: 'If for months you have little appetite in the morning, wake at night to eat, or eat most of your day\'s food at night, it is worth talking to a sleep or eating specialist.',
  },
  sources: [VUJOVIC_2022, MCHILL_2017, GARAULET_2013, IAO_2021, MHLW_SLEEP_2023],
};

const RECOVER: LawArticle = {
  meaning: {
    ja: '食べすぎた翌朝の体重増の大部分は、水分・グリコーゲン・消化途中の食べものです。数日で戻るのが普通で、あなたの記録はそれを実際に示しています。\n「戻る」と知っていることは強みです。食べすぎのあとに一番危ないのは体重ではなく、「もうダメだ」と全部をやめてしまうこと。あなたにはその心配がいらない根拠があります。',
    en: 'Most of the weight gain after overeating is water, glycogen and food in transit, and it normally clears within days. Your own log shows this. Knowing it will come back down protects you from the real risk after a big day: giving up entirely.',
  },
  science: [
    {
      text: { ja: 'グリコーゲンは3〜4倍の重さの水と一緒に貯蔵されるため、糖質を多くとったあとの体重は見かけ上大きく増え、貯蔵が使われると戻ります。塩分も体の水分を増やします（食塩約6gの差で約0.4L）。',
      en: 'Glycogen is stored with 3-4 times its weight in water, so weight jumps after carbohydrate-rich eating and falls as stores are used; salt also retains water (about 0.4 L per 6 g of salt).' },
      refs: [KREITZMAN_1992, HE_2001],
    },
    {
      text: { ja: '毎日体重を測った80人では、体重は週末に上がり平日に下がるリズムがあり、減量に成功した人ほど「上がっても戻す」形がはっきりしていました。上がることではなく、戻すことが結果を分けます。',
      en: 'Among 80 adults weighing daily, weight rose on weekends and fell on weekdays, and successful losers showed the clearest "rise then recover" pattern. Recovering, not never rising, made the difference.' },
      refs: [ORSAMA_2014],
    },
    {
      text: { ja: '減量後に体重が戻った人と維持できた人を比べた質的研究では、戻った人に「全か無か」の二分法的な考え方が多く見られました。一度の食べすぎを「失敗」と見なして全部をやめることが、リバウンドの心理的な要因の一つです。',
      en: 'A qualitative study comparing regainers with maintainers found dichotomous (all-or-nothing) thinking more common among regainers; treating one lapse as total failure is a psychological route to regain.' },
      refs: [BYRNE_2003],
    },
    {
      text: { ja: '長期に減量を維持している人の共通点として、体重を自分で測り続けていることが挙げられています。食べすぎのあとも測り続ける人ほど、戻る過程を確認できます。',
      en: 'Long-term maintainers commonly keep weighing themselves; those who keep weighing after a big day get to see the recovery.' },
      refs: [WING_2005],
    },
  ],
  actions: [
    { ja: '翌日はふつうに食べる。絶食や極端な埋め合わせは、次の食べすぎの引き金になります。', en: 'Eat normally the next day. Fasting or extreme compensation sets up the next overeating.' },
    { ja: '体重は測り続ける。見ないと不安が増えるだけで、見れば「戻る」のが確認できます。', en: 'Keep weighing. Not looking only feeds anxiety; looking lets you watch it come back down.' },
    { ja: '4日以上戻らないときだけ、週平均の摂取量を見直す。', en: 'Only if it has not recovered after 4 days, review your weekly average intake.' },
  ],
  sources: [KREITZMAN_1992, HE_2001, ORSAMA_2014, BYRNE_2003, WING_2005],
};

const COMEBACK: LawArticle = {
  meaning: {
    ja: '記録が途切れるのは失敗ではなく、長く続けている人なら誰にでも起きることです。結果を分けるのは「途切れないこと」ではなく「戻ってくること」で、あなたの履歴にはそれがあります。\n途切れたあとに戻ってきた回数は、あなたの続ける力そのものです。',
    en: 'A gap in logging is not a failure; it happens to everyone who keeps going for long. What separates outcomes is not never stopping but coming back, and your history shows you do.',
  },
  science: [
    {
      text: { ja: '食事・運動・体重の記録（自己モニタリング）は、22研究を対象にした体系的レビューで一貫して減量と関連しており、行動的な減量支援の中心と位置づけられています。記録に「戻る」ことは、その効果を再開することです。',
      en: 'Self-monitoring of diet, exercise and weight was consistently associated with weight loss across 22 studies and is considered the centerpiece of behavioral weight programs. Returning to logging restarts that effect.' },
      refs: [BURKE_2011],
    },
    {
      text: { ja: '10%以上の減量を1年以上維持している人たちの特徴として、体重の自己モニタリングを続けていることが挙げられています。完璧に続けることより、続ける習慣に戻ることが維持につながります。',
      en: 'People maintaining a 10%+ weight loss for over a year commonly keep monitoring their weight; returning to the habit matters more than never missing.' },
      refs: [WING_2005],
    },
    {
      text: { ja: '減量後に体重が戻った人には、「全か無か」の二分法的な考え方や、目標に届かないと努力をやめてしまう傾向が見られました。途切れても再開できる人は、この落とし穴を避けています。',
      en: 'Regainers showed all-or-nothing thinking and a tendency to abandon efforts when goals were missed; people who resume after a gap avoid that trap.' },
      refs: [BYRNE_2003],
    },
  ],
  actions: [
    { ja: '再開の日は1品だけの記録でOK。ハードルは低いほど戻りやすい。', en: 'On the day you come back, logging one item is enough. The lower the bar, the easier the return.' },
    { ja: '途切れた理由を一行だけメモする（旅行・体調・忙しさ）。次に同じ状況が来たとき、先回りできる。', en: 'Note in one line why you stopped (travel, illness, busy). Next time you can plan ahead.' },
    { ja: 'ストリークではなく「今月の記録日数」を見る。途切れても積み上がる数字です。', en: 'Watch monthly logged days instead of the streak. It keeps growing even after a gap.' },
  ],
  sources: [BURKE_2011, WING_2005, BYRNE_2003],
};

const SLEEP_FACTOR: LawArticle = {
  meaning: {
    ja: '21時以降に食べた日の睡眠が、食べなかった日と違っています。方向はどちらもあり得ます。短くなる人は「遅い帰宅→遅い夕食→遅い就寝」の連鎖や、就寝前の食事による寝つきや中途覚醒の影響が考えられます。長くなる人は、遅く食べる日が翌日休みの日と重なっている、といった生活要因の可能性があります。\n大切なのは時間の長さだけでなく質です。この法則は「遅い食事と睡眠がつながっている」という手がかりとして使ってください。',
    en: 'Your sleep differs on nights after eating past 9 pm. Either direction is possible: shorter sleep may reflect a late-home → late-dinner → late-bed chain or eating close to bedtime; longer sleep may reflect late-eating days falling before days off. Sleep quality matters as much as duration. Use this as a clue that late meals and sleep are linked for you.',
  },
  science: [
    {
      text: { ja: '米国の大規模な時間利用調査（2003〜2018年）では、就寝の1時間以内に飲食した人は睡眠時間がやや長い一方で、夜中に目が覚める（中途覚醒）リスクが高いことが示されています。睡眠の「長さ」と「質」は別の指標です。',
      en: 'In the American Time Use Survey (2003-2018), eating or drinking within an hour of bedtime went with slightly longer sleep but higher odds of waking after sleep onset; duration and quality are different measures.' },
      refs: [IAO_2021],
    },
    {
      text: { ja: '健康な成人52人の睡眠を睡眠ポリグラフで測った研究では、就寝前の脂質や糖質の摂取が多いほど寝つくまでの時間が長い傾向がありました。別の研究では、食物繊維が多いと深い睡眠が増え、飽和脂肪が多いと深い睡眠が減り、糖が多いと覚醒が増えていました。',
      en: 'In 52 healthy adults studied with polysomnography, more fat and carbohydrate before bed went with longer sleep latency; in another study, more fiber predicted more slow-wave sleep, more saturated fat less, and more sugar more arousals.' },
      refs: [CRISPIM_2011, ST_ONGE_2016],
    },
    {
      text: { ja: '同じ食事を4時間遅らせる実験では、空腹感が増え、消費エネルギーがわずかに下がりました。さらに睡眠不足の翌日は摂取が平均385kcal増えるというメタ分析があり、「遅い食事→短い睡眠→翌日の食べすぎ」の循環になりやすいことが示唆されます。',
      en: 'Shifting identical meals 4 hours later increased hunger and lowered expenditure; a meta-analysis found sleep loss adds about 385 kcal the next day, suggesting a late meal → short sleep → overeating loop.' },
      refs: [VUJOVIC_2022, AL_KHATIB_2017],
    },
    {
      text: { ja: '厚生労働省「健康づくりのための睡眠ガイド2023」は、成人は6時間以上の睡眠を目安とし、就寝直前の夜食や眠るための飲酒は控えるよう勧めています。',
      en: 'Japan\'s sleep guideline (2023) recommends adults get at least 6 hours and avoid late-night snacks and alcohol as a sleep aid right before bed.' },
      refs: [MHLW_SLEEP_2023],
    },
  ],
  actions: [
    { ja: '遅い日は軽く。たんぱく質と食物繊維を中心に、脂っこいものと甘いものは控えめに。', en: 'Eat light when it is late: lean on protein and fiber, go easy on fatty and sweet foods.' },
    { ja: '食べてから寝るまで2時間あける。むずかしい日は1時間でも違う。', en: 'Leave two hours between eating and bed; even one hour helps on hard days.' },
    { ja: '短く寝た翌朝は「空腹が強くなる日」と決めて、朝食にたんぱく質を入れておく。', en: 'After a short night, expect stronger hunger and put protein in breakfast.' },
  ],
  seeDoctor: {
    ja: '大きないびきや呼吸の止まりを指摘される、日中に強い眠気がある、寝つけない・眠りが浅い状態が週3回以上・3か月以上続く、といった場合は睡眠の専門医に相談してください。',
    en: 'If you are told you snore loudly or stop breathing, feel very sleepy in the day, or have trouble falling or staying asleep 3+ nights a week for 3+ months, see a sleep specialist.',
  },
  sources: [IAO_2021, CRISPIM_2011, ST_ONGE_2016, VUJOVIC_2022, AL_KHATIB_2017, MHLW_SLEEP_2023],
};

/** 未登録キーのフォールバック（準備中）。注意と一般的な行動だけを出す */
export const FALLBACK_ARTICLE: LawArticle = {
  meaning: {
    ja: 'この法則の解説記事は準備中です。法則そのものはあなたの記録から計算されたもので、記事が無くても数字の意味は変わりません。',
    en: 'The article for this pattern is being prepared. The pattern itself is computed from your own log, and the numbers mean the same with or without the article.',
  },
  science: [
    {
      text: { ja: '記事が整うまでは、あなたの記録そのものが一番の根拠です。同じ条件の日が増えるほど、法則の数字は安定していきます。',
      en: 'Until the article is ready, your own log is the best evidence. The more days under the same conditions, the more stable the number becomes.' },
      refs: [],
    },
  ],
  actions: [
    { ja: '記録を続ける。法則は記録が貯まるほど精度が上がります。', en: 'Keep logging. Patterns get more accurate as records accumulate.' },
    { ja: '体重や摂取は1日ではなく週平均で見る。', en: 'Judge weight and intake by weekly averages, not single days.' },
    { ja: '気になることはAI相談で聞く。あなたの法則を踏まえて答えます。', en: 'Ask the AI coach about anything that puzzles you; it answers with your patterns in mind.' },
  ],
  sources: [],
};

// ===== カタログ =====

/** evidenceKey → 記事。キーは 'kind' または 'kind:variant'（lawVariant と同じ variant） */
export const EVIDENCE: Record<string, LawArticle> = {
  food_up: FOOD_UP,
  food_safe: FOOD_SAFE,
  weekday: WEEKDAY,
  'weekday:stable': WEEKDAY_STABLE,
  binge_trigger: BINGE_TRIGGER,
  timeslot: TIMESLOT,
  recover: RECOVER,
  comeback: COMEBACK,
  sleep_factor: SLEEP_FACTOR,
};

/** kind＋variant → 実際に使う evidenceKey（'kind:variant' が無ければ 'kind'。どちらも無ければ 'kind' を返す＝呼び出し側で準備中判定） */
export function evidenceKeyOf(kind: string, variant: string = 'default'): string {
  const v = `${kind}:${variant}`;
  if (variant !== 'default' && EVIDENCE[v]) return v;
  return kind;
}

/** リモートの article を探す（'kind:variant' → 'kind' の順。lib/laws.remoteLawText と同じ順） */
function remoteArticle(kind: string, variant: string): RemoteLawArticle | undefined {
  const list = getRemoteContent().lawsText;
  if (list.length === 0) return undefined;
  const hit = (variant !== 'default' ? list.find((x) => x.id === `${kind}:${variant}`)?.article : undefined)
    ?? list.find((x) => x.id === kind)?.article;
  return hit;
}

/**
 * 表示用の記事を返す。同梱（EVIDENCE）を土台に、リモートの article があれば節ごとに上書きする。
 * ready=false は同梱もリモートも無い＝準備中（FALLBACK_ARTICLE）。
 * リモートの science.refs（1始まりの番号）は、リモートの sources（無ければ同梱の sources）を指す
 */
export function getLawArticle(kind: string, variant: string = 'default'): { key: string; article: LawArticle; ready: boolean } {
  const key = evidenceKeyOf(kind, variant);
  const base = EVIDENCE[key];
  const ov = remoteArticle(kind, variant);
  if (!base && !ov) return { key, article: FALLBACK_ARTICLE, ready: false };
  const start: LawArticle = base ?? FALLBACK_ARTICLE;
  if (!ov) return { key, article: start, ready: true };
  const sources: EvidenceSource[] = ov.sources ?? start.sources;
  const science: SciencePara[] = ov.science
    ? ov.science.map((p) => ({ text: p.text, refs: (p.refs ?? []).map((n) => sources[n - 1]).filter((s): s is EvidenceSource => s != null) }))
    : start.science;
  const article: LawArticle = {
    meaning: ov.meaning ?? start.meaning,
    science,
    actions: ov.actions ?? start.actions,
    seeDoctor: ov.seeDoctor === '' ? undefined : (ov.seeDoctor ?? start.seeDoctor),
    caution: ov.caution ?? start.caution,
    sources,
  };
  return { key, article, ready: true };
}

/** 出典番号（1始まり）。science の refs を sources の位置で番号にする。無い出典は 0（画面側で出さない） */
export function sourceNumber(article: LawArticle, src: EvidenceSource): number {
  const i = article.sources.findIndex((s) => s === src || s.url === src.url);
  return i < 0 ? 0 : i + 1;
}

/** 多言語文言を表示言語で（remoteContent.pickL10n の再輸出。記事側で import を1本にするため） */
export const pickArticleText = pickL10n;
