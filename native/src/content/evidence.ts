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
//    エンジン系9種（docs/INSIGHTS-ENGINE.md §3.1 の evidenceKey）は E1c で追記済み。以後の新 LawKind も同じ手順
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

// ----- E1c（エンジン系9種）で追加した出典。NCBI E-utilities（esummary）で PMID・著者・誌名・年を照合し、
//       DOI / mhlw の URL は HTTP 200 を確認（2026-09-02） -----
const NEDELTCHEVA_2009: EvidenceSource = {
  authors: 'Nedeltcheva AV, Kilkus JM, Imperial J, Kasza K, Schoeller DA, Penev PD',
  title: 'Sleep curtailment is accompanied by increased intake of calories from snacks',
  journal: 'Am J Clin Nutr. 89(1):126-133', year: 2009,
  url: 'https://pubmed.ncbi.nlm.nih.gov/19056602/',
};
const MACHT_2008: EvidenceSource = {
  authors: 'Macht M',
  title: 'How emotions affect eating: a five-way model',
  journal: 'Appetite. 50(1):1-11', year: 2008,
  url: 'https://pubmed.ncbi.nlm.nih.gov/17707947/',
};
const STEIN_2007: EvidenceSource = {
  authors: 'Stein RI, Kenardy J, Wiseman CV, Dounchis JZ, Arnow BA, Wilfley DE',
  title: "What's driving the binge in binge eating disorder?: A prospective examination of precursors and consequences",
  journal: 'Int J Eat Disord. 40(3):195-203', year: 2007,
  url: 'https://pubmed.ncbi.nlm.nih.gov/17103418/',
};
const GANGWISCH_2015: EvidenceSource = {
  authors: 'Gangwisch JE, Hale L, Garcia L, et al.',
  title: "High glycemic index diet as a risk factor for depression: analyses from the Women's Health Initiative",
  journal: 'Am J Clin Nutr. 102(2):454-463', year: 2015,
  url: 'https://pubmed.ncbi.nlm.nih.gov/26109579/',
};
const MANTANTZIS_2019: EvidenceSource = {
  authors: 'Mantantzis K, Schlaghecken F, Sünram-Lea SI, Maylor EA',
  title: 'Sugar rush or sugar crash? A meta-analysis of carbohydrate effects on mood',
  journal: 'Neurosci Biobehav Rev. 101:45-67', year: 2019,
  url: 'https://pubmed.ncbi.nlm.nih.gov/30951762/',
};
const BREYMEYER_2016: EvidenceSource = {
  authors: 'Breymeyer KL, Lampe JW, McGregor BA, Neuhouser ML',
  title: 'Subjective mood and energy levels of healthy weight and overweight/obese healthy adults on high- and low-glycemic load experimental diets',
  journal: 'Appetite. 107:253-259', year: 2016,
  url: 'https://pubmed.ncbi.nlm.nih.gov/27507131/',
};
const ZHENG_2012: EvidenceSource = {
  authors: 'Zheng J, Huang T, Yu Y, Hu X, Yang B, Li D',
  title: 'Fish consumption and CHD mortality: an updated meta-analysis of seventeen cohort studies',
  journal: 'Public Health Nutr. 15(4):725-737', year: 2012,
  url: 'https://pubmed.ncbi.nlm.nih.gov/21914258/',
};
const HU_2019: EvidenceSource = {
  authors: 'Hu Y, Hu FB, Manson JE',
  title: 'Marine Omega-3 Supplementation and Cardiovascular Disease: An Updated Meta-Analysis of 13 Randomized Controlled Trials Involving 127 477 Participants',
  journal: 'J Am Heart Assoc. 8(19):e013543', year: 2019,
  url: 'https://pubmed.ncbi.nlm.nih.gov/31567003/',
};
const GROSSO_2016: EvidenceSource = {
  authors: 'Grosso G, Micek A, Marventano S, et al.',
  title: 'Dietary n-3 PUFA, fish consumption and depression: A systematic review and meta-analysis of observational studies',
  journal: 'J Affect Disord. 205:269-281', year: 2016,
  url: 'https://pubmed.ncbi.nlm.nih.gov/27544316/',
};
const MHLW_MERCURY: EvidenceSource = {
  authors: '厚生労働省',
  title: '魚介類に含まれる水銀について（妊婦への魚介類の摂食と水銀に関する注意事項）',
  journal: '厚生労働省 医薬・生活衛生局 食品安全部', year: 2010,
  url: 'https://www.mhlw.go.jp/topics/bukyoku/iyaku/syoku-anzen/suigin/',
};
const CHOI_2004: EvidenceSource = {
  authors: 'Choi HK, Atkinson K, Karlson EW, Willett W, Curhan G',
  title: 'Purine-rich foods, dairy and protein intake, and the risk of gout in men',
  journal: 'N Engl J Med. 350(11):1093-1103', year: 2004,
  url: 'https://pubmed.ncbi.nlm.nih.gov/15014182/',
};
const JSGNU_2020: EvidenceSource = {
  authors: 'Hisatome I, Ichida K, Mineo I, et al.（日本痛風・尿酸核酸学会 ガイドライン改訂委員会）',
  title: 'Japanese Society of Gout and Uric & Nucleic Acids 2019 Guidelines for Management of Hyperuricemia and Gout 3rd edition（高尿酸血症・痛風の治療ガイドライン 第3版・英訳）',
  journal: 'Gout and Uric & Nucleic Acids. 44(Suppl):sp-1-sp-40', year: 2020,
  url: 'https://doi.org/10.14867/gnamtsunyo.44.Supplement_sp-1',
};
const EHEALTHNET_URIC: EvidenceSource = {
  authors: '山岸良匡（厚生労働省 e-ヘルスネット）',
  title: '高尿酸血症（生活習慣病などの情報）',
  journal: '厚生労働省 e-ヘルスネット', year: 2024,
  url: 'https://kennet.mhlw.go.jp/information/information/metabolic/m-05-007.html',
};
const KNOWLES_2018: EvidenceSource = {
  authors: 'Knowles OE, Drinkwater EJ, Urwin CS, Lamon S, Aisbett B',
  title: 'Inadequate sleep and muscle strength: Implications for resistance training',
  journal: 'J Sci Med Sport. 21(9):959-968', year: 2018,
  url: 'https://pubmed.ncbi.nlm.nih.gov/29422383/',
};
const CRAVEN_2022: EvidenceSource = {
  authors: 'Craven J, McCartney D, Desbrow B, et al.',
  title: 'Effects of Acute Sleep Loss on Physical Performance: A Systematic and Meta-Analytical Review',
  journal: 'Sports Med. 52(11):2669-2690', year: 2022,
  url: 'https://pubmed.ncbi.nlm.nih.gov/35708888/',
};
const MORTON_2018: EvidenceSource = {
  authors: 'Morton RW, Murphy KT, McKellar SR, et al.',
  title: 'A systematic review, meta-analysis and meta-regression of the effect of protein supplementation on resistance training-induced gains in muscle mass and strength in healthy adults',
  journal: 'Br J Sports Med. 52(6):376-384', year: 2018,
  url: 'https://pubmed.ncbi.nlm.nih.gov/28698222/',
};
const SCHOENFELD_2017: EvidenceSource = {
  authors: 'Schoenfeld BJ, Ogborn D, Krieger JW',
  title: 'Dose-response relationship between weekly resistance training volume and increases in muscle mass: A systematic review and meta-analysis',
  journal: 'J Sports Sci. 35(11):1073-1082', year: 2017,
  url: 'https://pubmed.ncbi.nlm.nih.gov/27433992/',
};
const SCHOENFELD_ARAGON_2018: EvidenceSource = {
  authors: 'Schoenfeld BJ, Aragon AA',
  title: 'How much protein can the body use in a single meal for muscle-building? Implications for daily protein distribution',
  journal: 'J Int Soc Sports Nutr. 15:10', year: 2018,
  url: 'https://pubmed.ncbi.nlm.nih.gov/29497353/',
};
const GORDON_2018: EvidenceSource = {
  authors: 'Gordon BR, McDowell CP, Hallgren M, Meyer JD, Lyons M, Herring MP',
  title: 'Association of Efficacy of Resistance Exercise Training With Depressive Symptoms: Meta-analysis and Meta-regression Analysis of Randomized Clinical Trials',
  journal: 'JAMA Psychiatry. 75(6):566-576', year: 2018,
  url: 'https://pubmed.ncbi.nlm.nih.gov/29800984/',
};
const GORDON_2017: EvidenceSource = {
  authors: 'Gordon BR, McDowell CP, Lyons M, Herring MP',
  title: 'The Effects of Resistance Exercise Training on Anxiety: A Meta-Analysis and Meta-Regression Analysis of Randomized Controlled Trials',
  journal: 'Sports Med. 47(12):2521-2532', year: 2017,
  url: 'https://pubmed.ncbi.nlm.nih.gov/28819746/',
};
const SCHUCH_2016: EvidenceSource = {
  authors: 'Schuch FB, Vancampfort D, Richards J, Rosenbaum S, Ward PB, Stubbs B',
  title: 'Exercise as a treatment for depression: A meta-analysis adjusting for publication bias',
  journal: 'J Psychiatr Res. 77:42-51', year: 2016,
  url: 'https://pubmed.ncbi.nlm.nih.gov/26978184/',
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

// ===== インサイト・エンジン系9種（E1c・docs/INSIGHTS-ENGINE.md §3.1） =====

const SLEEP_DEBT_BINGE: LawArticle = {
  meaning: {
    ja: '睡眠の不足は一晩ぶんではなく「積み重なり」で効いてきます。5日間で合計5時間足りない状態（たとえば毎晩6時間）は、本人にはもう慣れて感じにくいのに、空腹のホルモンと食べものへの欲求は静かに強まっています。\nこの法則は、あなたの記録で「睡眠負債が5時間たまった日から翌日にかけて、食べすぎが普段の何倍起きているか」を数えたものです。食べすぎの前に、眠れていない日々があった。それが見えたということです。',
    en: 'Sleep loss works by accumulation. Five hours short over five nights (say, six hours a night) no longer feels unusual, yet hunger hormones and food cravings quietly rise. This pattern counts how many times more often overeating happened on and after days when your sleep debt reached five hours. The overeating was preceded by nights of too little sleep, and now you can see it.',
  },
  science: [
    {
      text: { ja: '健康な若い男性の睡眠を2晩4時間に制限すると、満腹ホルモンのレプチンが18%減り、空腹ホルモンのグレリンが28%増え、空腹感と食欲（とくに高炭水化物・高カロリーの食品への）が強まりました。',
      en: 'Two nights of 4-hour sleep in healthy young men lowered leptin by 18%, raised ghrelin by 28% and increased hunger and appetite, particularly for calorie-dense, high-carbohydrate foods.' },
      refs: [SPIEGEL_2004],
    },
    {
      text: { ja: '睡眠を5.5時間に制限した2週間は、8.5時間の2週間と比べて、食事の量は変わらないのに間食からのカロリーが1日あたり平均220kcal増えました。増えたのは主に夜の間食で、炭水化物の多いものでした。「たまった不足」が食べ方を変える様子を示した研究です。',
      en: 'Two weeks of 5.5-hour sleep, compared with 8.5 hours, left meal intake unchanged but added about 220 kcal/day from snacks, mostly carbohydrate-rich snacks in the evening: accumulated sleep loss changes how we eat.' },
      refs: [NEDELTCHEVA_2009],
    },
    {
      text: { ja: '一晩の断眠のあとの脳画像では、食べものの選択を担う前頭葉の活動が下がり、報酬に反応する深部の領域が高カロリー食品に強く反応していました。判断より欲求が前に出る状態です。',
      en: 'After one night without sleep, brain imaging showed reduced activity in frontal regions that govern food choice and stronger responses to high-calorie foods in deep reward regions: craving gets ahead of judgement.' },
      refs: [GREER_2013],
    },
    {
      text: { ja: '17研究のメタ分析では、部分的な睡眠不足の翌日は摂取エネルギーが平均385kcal増える一方、消費エネルギーは増えていませんでした。厚生労働省の睡眠ガイドは成人に6時間以上の睡眠を目安として勧めています。',
      en: 'A meta-analysis of 17 studies found partial sleep loss adds about 385 kcal the next day with no rise in expenditure. Japan\'s sleep guideline recommends adults get at least 6 hours.' },
      refs: [AL_KHATIB_2017, MHLW_SLEEP_2023],
    },
  ],
  actions: [
    { ja: '睡眠負債が5時間に近づいた日は「食べすぎが起きやすい日」と先に決めて、朝食にたんぱく質を入れ、夜の間食を小分けにしておく。', en: 'When sleep debt nears five hours, treat it as a high-risk day in advance: put protein in breakfast and portion evening snacks ahead of time.' },
    { ja: '取り戻すのは一晩でなくていい。就寝を30分だけ早める日を2〜3日続けると、負債の数字は動きます。', en: 'You do not need to catch up in one night. Going to bed 30 minutes earlier for two or three nights moves the number.' },
    { ja: '寝る前のスマホと飲酒を減らす。どちらも眠りを浅くし、翌日の負債を大きくします。', en: 'Cut screens and alcohol before bed; both lighten sleep and grow tomorrow\'s debt.' },
  ],
  seeDoctor: {
    ja: '十分な時間寝ても眠気が抜けない、大きないびきや呼吸の止まりを指摘される、寝つけない・眠りが浅い状態が週3回以上・3か月以上続く、といった場合は睡眠の専門医に相談してください。',
    en: 'If you stay sleepy after enough time in bed, are told you snore loudly or stop breathing, or have trouble falling or staying asleep 3+ nights a week for 3+ months, see a sleep specialist.',
  },
  sources: [SPIEGEL_2004, NEDELTCHEVA_2009, GREER_2013, AL_KHATIB_2017, MHLW_SLEEP_2023],
};

const MOOD_LAG_BINGE: LawArticle = {
  meaning: {
    ja: '気分と食べ方はつながっています。ただし同じ日だけでなく、少し遅れて効くことがあります。気分が3日つづけて落ちたあと、あなたの記録では数日後に食べすぎが起きやすくなっていました。\n落ち込んだ日にそのまま食べすぎるのではなく、「疲れがたまってから」反動が来る。この時間差を知っていると、気分が落ち始めた時点で先回りできます。',
    en: 'Mood and eating are linked, and the link can run with a delay. In your log, after three consecutive days of low mood, overeating became more likely a few days later. The rebound arrives after the strain builds, not on the low day itself. Knowing the lag lets you act as soon as your mood starts to slip.',
  },
  science: [
    {
      text: { ja: '日常生活の中で気分を繰り返し記録した36研究（968人）のメタ分析では、過食の直前は普段より否定的な気分が高いことが示されています（効果量0.63）。気分の落ち込みは食べすぎの最も一貫した先行要因の一つです。',
      en: 'A meta-analysis of 36 ecological momentary assessment studies (n=968) found negative affect is elevated before binge episodes (effect size 0.63); low mood is one of the most consistent precursors of overeating.' },
      refs: [HAEDT_MATT_2011],
    },
    {
      text: { ja: '過食性障害のある女性33人が携帯端末で気分と食事を記録した研究では、過食の数時間前から気分が下がり始め、空腹感も高まっていました。「前触れ」は当日の朝にはすでに始まっています。',
      en: 'In 33 women with binge eating disorder logging mood and meals on handheld devices, mood began to decline hours before a binge and hunger rose: the warning starts well before the episode.' },
      refs: [STEIN_2007],
    },
    {
      text: { ja: '感情が食べ方に影響する経路を整理した総説では、否定的な感情は人によって「食欲を抑える」方向にも「気分をなだめるために食べる」方向にも働くとされています。どちらに出るかは、あなたの記録が教えてくれます。',
      en: 'A review of how emotions shape eating notes that negative emotions can either suppress appetite or drive eating to regulate mood, depending on the person; your own log shows which way you lean.' },
      refs: [MACHT_2008],
    },
    {
      text: { ja: '慢性的なストレスはコルチゾールと報酬系を介して、高カロリーで嗜好性の高い食べものの摂取を増やす方向に働きます。気分の低下が数日続くことは、この経路に火をつけやすい状態です。',
      en: 'Chronic stress, via cortisol and the reward system, pushes intake toward palatable high-calorie foods; several days of low mood is a state that readily lights this pathway.' },
      refs: [ADAM_EPEL_2007],
    },
  ],
  actions: [
    { ja: '気分が2日つづけて落ちたら、その時点で「数日後に食べすぎが来やすい」と見て、たんぱく質と食物繊維のある食事を先に組む。', en: 'After two low-mood days in a row, expect a rebound a few days out and plan protein- and fiber-rich meals in advance.' },
    { ja: '気分が落ちている間は赤字を小さくする。我慢が重なると、反動も大きくなります。', en: 'Keep the deficit small while your mood is low; stacked restraint means a bigger rebound.' },
    { ja: '10分の散歩や誰かとの短い会話など、食べもの以外で気分を少し上げる手を1つ決めておく。', en: 'Pick one non-food mood lifter, a 10-minute walk or a short chat, and keep it ready.' },
  ],
  seeDoctor: {
    ja: '気分の落ち込みが2週間以上ほぼ毎日続く、眠れない・楽しめない・自分を責める気持ちが強い、あるいはコントロールできない食べすぎが週1回以上・数か月続いている、といった場合は、こころや摂食に関する専門の相談が役に立ちます。医療機関や相談窓口に話してみてください。',
    en: 'If low mood lasts most days for two weeks or more, with poor sleep, loss of enjoyment or strong self-blame, or if loss-of-control eating happens weekly for months, talk to a clinician or a helpline for mental health or eating concerns.',
  },
  sources: [HAEDT_MATT_2011, STEIN_2007, MACHT_2008, ADAM_EPEL_2007],
};

const WHEAT_VS_RICE_MOOD: LawArticle = {
  meaning: {
    ja: '「小麦中心の日」と「米中心の日」で、翌朝の気分に差が出ていました。これは小麦や米そのものの善悪ではありません。パン・麺・菓子パンなどの小麦中心の食事は、砂糖や脂質、加工度の高い食品、遅い時間の食事と一緒に来やすく、白米中心の食事は主菜・汁物・野菜と一緒に来やすい、といった「食事全体の形」の違いが気分に映っている可能性があります。\n逆向き（米中心の日のほうが低い）の人もいます。主食は入り口で、見るべきなのはその日の食事の中身と生活のリズムです。',
    en: 'Your next-morning mood differed between wheat-centred and rice-centred days. This is not about wheat or rice being good or bad. Wheat-centred meals (bread, noodles, pastries) often arrive with sugar, fat, highly processed foods and late timing; rice-centred meals often come with a main dish, soup and vegetables. The pattern may reflect the shape of the whole day\'s eating. Some people see the reverse direction. The staple is the entry point; what matters is what the day\'s meals contained.',
  },
  science: [
    {
      text: { ja: '閉経後の女性約7万人を3年追った研究では、食事全体のグリセミック指数（GI）が高い人ほど、その後にうつ症状が新たに出る割合が高く、精製された穀物や添加糖の摂取が多いこととも関連していました。一方、食物繊維・野菜・果物・全粒穀物が多いことは低いリスクと関連していました。',
      en: 'Among about 70,000 postmenopausal women followed for three years, a higher dietary glycemic index and higher intake of refined grains and added sugars were associated with new depressive symptoms, while fiber, vegetables, fruit and whole grains were associated with lower risk.' },
      refs: [GANGWISCH_2015],
    },
    {
      text: { ja: '過体重・肥満を含む健康な成人80人が「高GL食」と「低GL食」を28日ずつ食べ比べた無作為化クロスオーバー試験では、高GL食のときに抑うつ症状の得点が高く、疲労感も強くなっていました。同じカロリーでも、炭水化物の質で気分が変わりうることを示しています。',
      en: 'In a randomized crossover trial in which 80 healthy adults (including overweight/obese) ate high- and low-glycemic-load diets for 28 days each, depressive symptom scores and fatigue were higher on the high-GL diet at matched calories.' },
      refs: [BREYMEYER_2016],
    },
    {
      text: { ja: '31研究のメタ分析では、炭水化物をとることで気分が良くなる効果は認められず、摂取後30〜60分の注意力の低下と疲労感の増加が見られました。「甘いもので元気になる」実感は、研究の平均では支持されていません。',
      en: 'A meta-analysis of 31 studies found no mood-lifting effect of carbohydrate intake, but lower alertness and more fatigue within 30-60 minutes: the "sugar rush" is not supported on average.' },
      refs: [MANTANTZIS_2019],
    },
    {
      text: { ja: '厚生労働省「日本人の食事摂取基準（2025年版）」は、炭水化物のエネルギー比率とともに食物繊維の目標量を示しています。主食を「何にするか」より「精製度・食物繊維・一緒に食べるもの」に目を向ける根拠になります。',
      en: 'Japan\'s Dietary Reference Intakes (2025) set targets for carbohydrate share and dietary fiber, supporting a focus on refinement, fiber and accompaniments rather than on which staple you choose.' },
      refs: [MHLW_DRI_2025],
    },
  ],
  actions: [
    { ja: '「気分が低いほうの主食」の日を1つ選んで、その日の食事に何が一緒に来ていたか（甘いもの・脂っこいもの・時間）を記録で見返す。', en: 'Pick one "low-mood staple" day and look back at what came with it: sweets, fatty foods, timing.' },
    { ja: '主食を変えるのではなく、たんぱく質と野菜を先に足す。同じパンでも卵とサラダが横にあれば、食事の形が変わります。', en: 'Rather than swapping the staple, add protein and vegetables first. The same bread with eggs and a salad beside it is a different meal.' },
    { ja: '全粒粉パン・玄米・雑穀など、精製度の低い主食を週に数回だけ混ぜてみて、翌朝の気分を記録で比べる。', en: 'Mix in less-refined staples (whole-grain bread, brown rice, mixed grains) a few times a week and compare next-morning mood in your log.' },
  ],
  seeDoctor: {
    ja: '小麦を食べたあとに腹痛・下痢・じんましん・息苦しさなどの体の症状が繰り返し出る場合は、気分の問題とは別に、セリアック病や小麦アレルギーなどの評価が必要なことがあります。自己判断で除去する前に医療機関に相談してください。',
    en: 'If eating wheat is repeatedly followed by physical symptoms such as abdominal pain, diarrhea, hives or breathlessness, this is a separate matter from mood and may need evaluation for celiac disease or wheat allergy. See a doctor before cutting wheat on your own.',
  },
  caution: {
    ja: '気分の差は主食そのものではなく、一緒に食べたもの・時間・その日の出来事の影響を受けます。診断なしに小麦（グルテン）を完全に除去することの利益は示されておらず、栄養の偏りを招くことがあります。',
    en: 'The mood difference reflects accompaniments, timing and the day\'s events, not the staple alone. Completely removing wheat (gluten) without a diagnosis has no shown benefit and can unbalance nutrition.',
  },
  sources: [GANGWISCH_2015, BREYMEYER_2016, MANTANTZIS_2019, MHLW_DRI_2025],
};

const SALMON_MASTER: LawArticle = {
  meaning: {
    ja: 'サーモンをよく食べているのは、良い習慣です。魚、とくに脂の多い魚に含まれるオメガ3系脂肪酸（EPA・DHA）は、心臓や血管の健康と関連づけて研究されてきた栄養素で、たんぱく質の質も高い食材です。\nこの法則は「もっと食べよう」でも「減らそう」でもなく、あなたが自然に身につけている良い流れを見せたものです。ひとつ加えるなら、魚の種類を少し広げると栄養の幅も広がります。',
    en: 'Eating salmon regularly is a good habit. Oily fish provide omega-3 fatty acids (EPA and DHA), long studied in relation to heart and vascular health, and high-quality protein. This pattern is neither "eat more" nor "eat less"; it shows a good rhythm you already have. If anything, widening the range of fish widens the range of nutrients.',
  },
  science: [
    {
      text: { ja: '17のコホート研究（約31万人）のメタ分析では、魚をほとんど食べない人と比べて、週1回以上魚を食べる人の冠動脈疾患による死亡は約15〜20%低く、1日15gの摂取増ごとに約6%低いという用量反応が見られました。',
      en: 'A meta-analysis of 17 cohort studies (about 310,000 people) found coronary heart disease mortality roughly 15-20% lower in people eating fish at least once a week than in those who rarely ate fish, with about 6% lower risk per additional 15 g/day.' },
      refs: [ZHENG_2012],
    },
    {
      text: { ja: '13の無作為化比較試験（約12.7万人）のメタ分析では、海産オメガ3の補給は心筋梗塞と冠動脈疾患死亡のリスクをわずかに下げ、用量が多いほど効果が大きい傾向が見られました。効果は控えめで、サプリより食事からの摂取が基本です。',
      en: 'A meta-analysis of 13 randomized trials (about 127,000 people) found marine omega-3 supplementation modestly lowered risk of myocardial infarction and coronary death, with larger effects at higher doses. The effect is modest, and food remains the first source.' },
      refs: [HU_2019],
    },
    {
      text: { ja: '観察研究のメタ分析では、魚やオメガ3の摂取が多い人ほどうつ病のリスクが低い関連が報告されています。因果までは示されていませんが、魚を食べる習慣が気分と無関係でないことを示す手がかりです。',
      en: 'A meta-analysis of observational studies reported lower depression risk with higher fish and omega-3 intake. Causation is not established, but it suggests fish habits are not unrelated to mood.' },
      refs: [GROSSO_2016],
    },
    {
      text: { ja: '厚生労働省「日本人の食事摂取基準（2025年版）」はn-3系脂肪酸の目安量を年齢・性別ごとに示しています。また同省は、魚に含まれる水銀について、種類による差と妊婦向けの摂取の目安を公表しています。サーモンは水銀の少ない魚に含まれますが、種類を偏らせないことが最も安全な食べ方です。',
      en: 'Japan\'s Dietary Reference Intakes (2025) set adequate intakes for n-3 fatty acids, and the ministry publishes guidance on mercury in fish by species, mainly for pregnancy. Salmon is among the lower-mercury fish; varying species is the safest approach.' },
      refs: [MHLW_DRI_2025, MHLW_MERCURY],
    },
  ],
  actions: [
    { ja: '今の流れを続ける。週2回前後の魚は、多くのガイドラインが目安にしている量です。', en: 'Keep the rhythm. Around two fish meals a week is what many guidelines suggest.' },
    { ja: '月に数回、サバ・イワシ・アジ・サンマなど別の青魚に置き換えてみる（缶詰でも十分）。', en: 'A few times a month, swap in another oily fish such as mackerel, sardine, horse mackerel or saury (canned is fine).' },
    { ja: '調理法を記録で見返す。焼き・蒸し・刺身が中心なら、揚げ物やクリーム系ソースの日と翌朝の体重を比べてみる。', en: 'Review how it is cooked. If grilled, steamed or raw dominate, compare next-morning weight against fried or creamy-sauce days.' },
  ],
  sources: [ZHENG_2012, HU_2019, GROSSO_2016, MHLW_DRI_2025, MHLW_MERCURY],
};

const CHICKEN_HEAVY: LawArticle = {
  meaning: {
    ja: '鶏肉は脂質が少なく、たんぱく質の質も高い、減量や筋トレの強い味方です。この法則が言っているのは「鶏肉が悪い」ではなく、「この30日はたんぱく源が鶏肉に寄っていて、魚が少ない」ということです。\n同じたんぱく質でも、魚にはオメガ3、卵にはビタミンやミネラル、大豆には食物繊維と、食材ごとに一緒に入ってくるものが違います。偏りは栄養の幅を狭めます。また肉類にはプリン体が中程度含まれるため、量が多いときに知っておきたい一般情報を下に書きました（診断ではありません）。',
    en: 'Chicken is lean, high-quality protein and a strong ally for fat loss and training. This pattern does not say chicken is bad; it says your protein sources leaned heavily on chicken over the last 30 days with little fish. Different protein foods bring different companions: omega-3 in fish, vitamins and minerals in eggs, fiber in soy. Leaning on one narrows the range. Meats also contain moderate purines, so general information for high intakes follows (this is not a diagnosis).',
  },
  science: [
    {
      text: { ja: '男性約4.7万人を12年追った研究では、肉の摂取が最も多い群は最も少ない群と比べて痛風の発症リスクが1.41倍、魚介類では1.51倍でした。一方、低脂肪の乳製品は発症リスクの低さと関連し、たんぱく質の総量そのものは痛風と関連していませんでした。問題は「たんぱく質の量」ではなく「何から取るかの偏り」です。',
      en: 'In about 47,000 men followed for 12 years, the highest meat intake was associated with 1.41 times the risk of gout versus the lowest, and seafood with 1.51 times; low-fat dairy was associated with lower risk, and total protein was not associated with gout. The issue is not protein quantity but where it comes from.' },
      refs: [CHOI_2004],
    },
    {
      text: { ja: '日本痛風・尿酸核酸学会のガイドライン（第3版）は、高尿酸血症・痛風の生活指導として、プリン体の摂取を1日400mg程度までに抑えること、適正体重の維持、アルコールと果糖を含む甘い飲料を控えること、十分な水分摂取を挙げています。肉・魚の多くは100gあたり100〜200mg程度（中程度）のプリン体を含む群にあたります。',
      en: 'The Japanese Society of Gout and Uric & Nucleic Acids guideline (3rd edition) advises limiting purine intake to about 400 mg/day, maintaining a healthy weight, moderating alcohol and fructose-sweetened drinks, and drinking enough water. Most meats and fish fall in the moderate group of roughly 100-200 mg purine per 100 g.' },
      refs: [JSGNU_2020],
    },
    {
      text: { ja: '厚生労働省 e-ヘルスネットは、血液中の尿酸値が7.0mg/dLを超える状態を高尿酸血症と説明し、プリン体の多い食品（白子・レバー・干物など）を控え、野菜・果物・豆類・全粒穀物をバランスよく取ること、アルコール全般を減らすことを勧めています。健康診断の尿酸値は、この法則と合わせて見る価値のある数字です。',
      en: 'Japan\'s e-Health Net (MHLW) describes hyperuricemia as blood uric acid above 7.0 mg/dL and advises limiting purine-rich foods (fish roe, liver, dried fish), eating vegetables, fruit, beans and whole grains in balance, and reducing alcohol. Your check-up uric acid value is worth reading alongside this pattern.' },
      refs: [EHEALTHNET_URIC],
    },
    {
      text: { ja: '厚生労働省「日本人の食事摂取基準（2025年版）」は、たんぱく質の推奨量に加えてn-3系脂肪酸などの目安量を示しています。魚・卵・大豆を混ぜることは、これらをまとめて満たす近道です。',
      en: 'Japan\'s Dietary Reference Intakes (2025) set recommended protein and adequate n-3 fatty acid intakes; mixing fish, eggs and soy is a shortcut to meeting them together.' },
      refs: [MHLW_DRI_2025],
    },
  ],
  actions: [
    { ja: '週の鶏肉のうち2回を魚に、1回を卵か大豆（豆腐・納豆）に置き換える。量は変えなくていい。', en: 'Swap two chicken meals a week for fish and one for eggs or soy (tofu, natto). Keep the amount the same.' },
    { ja: '健康診断の結果があれば「尿酸値」を見てみる。7.0mg/dLを超えていたら、この法則は医師に見せる価値があります。', en: 'If you have check-up results, look at uric acid. Above 7.0 mg/dL, this pattern is worth showing your doctor.' },
    { ja: '水分をこまめに取り、ビールや甘い飲み物は控えめに。肉の量よりこちらのほうが尿酸には効きます。', en: 'Drink water regularly and go easy on beer and sugary drinks; these matter more for uric acid than the amount of meat.' },
  ],
  seeDoctor: {
    ja: '健康診断で尿酸値が7.0mg/dLを超えている、足の親指のつけ根・足首・膝などが突然赤く腫れて強く痛む、腎臓の病気や尿路結石の経験がある、といった場合は医療機関に相談してください。この記事は一般情報で、あなたの尿酸値や病気の有無を判定するものではありません。',
    en: 'See a doctor if a check-up showed uric acid above 7.0 mg/dL, if a joint such as the base of the big toe, ankle or knee suddenly becomes red, swollen and very painful, or if you have a history of kidney disease or kidney stones. This article is general information and does not assess your uric acid or diagnose any condition.',
  },
  caution: {
    ja: '鶏肉の量だけで尿酸値や痛風のリスクは決まりません。体質・体重・アルコール・水分・腎機能など多くの要因が関わります。鶏肉を急にやめる必要はなく、たんぱく源を「混ぜる」ことが目的です。',
    en: 'Chicken intake alone does not determine uric acid or gout risk; constitution, weight, alcohol, hydration and kidney function all play a part. There is no need to stop eating chicken; the goal is to mix your protein sources.',
  },
  sources: [CHOI_2004, JSGNU_2020, EHEALTHNET_URIC, MHLW_DRI_2025],
};

const LIFT_SLEEP: LawArticle = {
  meaning: {
    ja: 'トレーニングの手応えは、前の晩にすでに半分決まっています。7時間以上眠れた日のあなたのトレは、そうでない日と比べてボリューム（重量×回数の合計）が違っていました。\n多い方向なら、睡眠が力と集中を支えている素直な形です。少ない方向の人は、よく眠れた日が「休み明けの軽い日」や「オフ日の翌日」に重なっているなど、生活のリズムが映っている可能性があります。どちらでも、睡眠とトレの記録を並べて見る価値があります。',
    en: 'How a workout feels is half decided the night before. On days after 7+ hours of sleep, your training volume (total weight x reps) differed from other days. If it was higher, sleep is plainly supporting strength and focus. If lower, well-slept days may coincide with light sessions or the day after a rest day; the pattern may reflect your weekly rhythm. Either way, sleep and training are worth reading side by side.',
  },
  science: [
    {
      text: { ja: '睡眠不足と筋力に関する研究の体系的レビューでは、睡眠が不十分なあとは筋力、とくに複数の関節を使う大きな種目（スクワット・デッドリフト・ベンチプレスなど）の出力が落ちることが示されています。単関節種目より、全身を使う種目ほど影響を受けやすいと整理されています。',
      en: 'A systematic review on inadequate sleep and muscle strength found reduced force output after poor sleep, particularly in multi-joint compound lifts (squat, deadlift, bench press), which were more affected than single-joint exercises.' },
      refs: [KNOWLES_2018],
    },
    {
      text: { ja: '急性の睡眠不足が運動パフォーマンスに与える影響を集めたメタ分析では、睡眠の不足量が大きいほど、また測定が夕方以降になるほど、パフォーマンスの低下が大きくなっていました。「寝不足の日の夕方のトレ」が最も影響を受けやすい条件です。',
      en: 'A meta-analysis of acute sleep loss and physical performance found larger declines with greater sleep loss and when testing occurred later in the day: an evening session after a short night is the most vulnerable setting.' },
      refs: [CRAVEN_2022],
    },
    {
      text: { ja: '厚生労働省「健康づくりのための睡眠ガイド2023」は、成人に6時間以上の睡眠を目安として勧め、日中の運動が睡眠の質を高めることにも触れています。睡眠とトレは、どちらかがどちらかの土台というより、互いを支え合う関係です。',
      en: 'Japan\'s sleep guideline (2023) recommends adults get at least 6 hours and notes that daytime exercise improves sleep quality: sleep and training support each other.' },
      refs: [MHLW_SLEEP_2023],
    },
  ],
  actions: [
    { ja: '重い日（スクワット・デッドリフトなど）を、よく眠れる見込みの日の翌日に置く。軽い日や有酸素は寝不足でもこなせる。', en: 'Schedule heavy days (squat, deadlift) after nights you expect to sleep well; light days and cardio tolerate a short night.' },
    { ja: '寝不足の日は無理にボリュームを追わず、重量を10%落として動きの質を守る。翌週に取り戻せます。', en: 'On short-sleep days, drop the load by about 10% and protect movement quality instead of chasing volume. You can make it up next week.' },
    { ja: 'トレの日は就寝時刻を先に決める。運動の日ほど、眠りが回復に直結します。', en: 'Set your bedtime first on training days; on those days sleep converts directly into recovery.' },
  ],
  sources: [KNOWLES_2018, CRAVEN_2022, MHLW_SLEEP_2023],
};

const LIFT_PROTEIN_PR: LawArticle = {
  meaning: {
    ja: 'たんぱく質が目標に届いた週は、あなたの自己ベスト更新が起きやすくなっていました。筋肉は「トレで壊れて、栄養と休養で作り直される」ので、材料が足りている週ほど、前回より少し強い自分に会いやすいのは自然な流れです。\nこの法則は「たんぱく質を増やせば記録が伸びる」という約束ではなく、「材料が揃っている週は、伸びるチャンスの週」という読み方が正確です。',
    en: 'In weeks when you met your protein target, personal bests came more often. Muscle is broken down in training and rebuilt with nutrition and rest, so weeks with enough building material are naturally when you meet a slightly stronger self. Read this not as "more protein guarantees records" but as "a week with the materials in place is a week of opportunity".',
  },
  science: [
    {
      text: { ja: '49の無作為化比較試験（1,863人）のメタ分析では、筋トレにたんぱく質の補給を加えると、除脂肪量が平均0.30kg、1RM筋力が平均2.49kg多く増えました。総摂取量が体重1kgあたり約1.6g/日を超えると、それ以上の上乗せはほぼ見られませんでした。',
      en: 'A meta-analysis of 49 randomized trials (1,863 people) found adding protein to resistance training increased fat-free mass by about 0.30 kg and 1RM strength by about 2.49 kg, with little further benefit above roughly 1.6 g/kg/day total intake.' },
      refs: [MORTON_2018],
    },
    {
      text: { ja: '1食で筋肉づくりに使えるたんぱく質の量を検討した総説では、体重1kgあたり約0.4gを1日4食程度に分けて取る配分が、筋肥大を最大化する上で妥当と提案されています（体重70kgなら1食約28g）。',
      en: 'A review of how much protein a single meal can use for muscle building proposed about 0.4 g/kg per meal across roughly four meals a day as a sensible distribution for maximizing hypertrophy (about 28 g per meal at 70 kg).' },
      refs: [SCHOENFELD_ARAGON_2018],
    },
    {
      text: { ja: '週あたりのトレーニング量と筋肥大の関係を調べたメタ分析では、1部位あたり週10セット以上で筋肥大が大きくなる用量反応が見られました。たんぱく質は材料、ボリュームは刺激で、どちらも揃った週が伸びる週です。',
      en: 'A meta-analysis of weekly training volume and hypertrophy found a dose-response, with greater growth at 10+ sets per muscle group per week. Protein is the material and volume the stimulus; weeks with both are the weeks that grow.' },
      refs: [SCHOENFELD_2017],
    },
    {
      text: { ja: '厚生労働省「日本人の食事摂取基準（2025年版）」は成人のたんぱく質の推奨量を示しています。筋トレをする人の目標（体重1kgあたり1.6〜2.0g程度）はこれより多めに設定されることが一般的で、アプリの目標もその範囲で計算しています。',
      en: 'Japan\'s Dietary Reference Intakes (2025) give recommended protein intakes for adults; targets for people who train (around 1.6-2.0 g/kg) are commonly set higher, and the app\'s target is computed in that range.' },
      refs: [MHLW_DRI_2025],
    },
  ],
  actions: [
    { ja: '毎食に「手のひら1枚ぶん」のたんぱく源を置く（肉・魚・卵・大豆のどれか）。1食25〜30gの目安になる。', en: 'Put a palm-sized protein source (meat, fish, eggs or soy) on every meal; that is roughly 25-30 g per meal.' },
    { ja: '重い種目を狙う週の前半に、たんぱく質を先に整える。記録更新は「揃った週」の後半に来やすい。', en: 'Get protein in order early in a week when you plan a heavy attempt; records tend to land in the second half of a week with the materials in place.' },
    { ja: '届かなかった週も落ち込まない。ボリュームと睡眠も含めて、揃った週にまた挑めばいい。', en: 'Do not dwell on a week that fell short. With volume and sleep also in place, try again in a week when everything lines up.' },
  ],
  sources: [MORTON_2018, SCHOENFELD_ARAGON_2018, SCHOENFELD_2017, MHLW_DRI_2025],
};

const LIFT_MOOD: LawArticle = {
  meaning: {
    ja: 'トレをした日の気分が、しなかった日と違っていました。高い方向なら、運動が気分を持ち上げる効果をあなたの記録が示しているということです。多くの研究で筋トレは抑うつや不安の症状を和らげることが報告されていて、あなたの体はそれを実際にやっています。\n低い方向の人は、疲労がたまっている・トレの日ほど忙しい・追い込みすぎ、といった背景が考えられます。トレそのものが悪いのではなく、量や置き方を見直す合図です。',
    en: 'Your mood on training days differed from non-training days. If it was higher, your own log shows exercise lifting your mood, in line with many studies reporting that resistance training eases depressive and anxiety symptoms. If it was lower, fatigue, busier days or pushing too hard may be behind it: not a sign that training is bad, but a cue to review its amount and placement.',
  },
  science: [
    {
      text: { ja: '33の無作為化比較試験（1,877人）のメタ分析では、筋力トレーニングは抑うつ症状を有意に軽くしていました（効果量0.66）。効果は健康状態やトレーニングの量、筋力の向上度合いに左右されにくく、幅広い人に見られました。',
      en: 'A meta-analysis of 33 randomized trials (1,877 people) found resistance training significantly reduced depressive symptoms (effect size 0.66), regardless of health status, training volume or strength gains.' },
      refs: [GORDON_2018],
    },
    {
      text: { ja: '同じグループによる16試験（922人）のメタ分析では、筋力トレーニングは不安の症状も小〜中程度軽くしていました（効果量0.31）。健康な人でより大きい効果が見られています。',
      en: 'A meta-analysis of 16 trials (922 people) by the same group found resistance training also reduced anxiety symptoms by a small-to-moderate amount (effect size 0.31), with larger effects in healthy participants.' },
      refs: [GORDON_2017],
    },
    {
      text: { ja: '25の無作為化比較試験を対象に、出版バイアスを補正したうえで運動のうつ病への効果を推定したメタ分析では、補正後も大きな効果が残っていました。運動は「気分に効く」と言える数少ない生活習慣の一つです。',
      en: 'A meta-analysis of 25 randomized trials that adjusted for publication bias still found a large effect of exercise on depression; exercise is one of the few lifestyle factors that can be said to work on mood.' },
      refs: [SCHUCH_2016],
    },
  ],
  actions: [
    { ja: '気分が落ちそうな日ほど、短くてもいいからトレを入れる（20分・2種目で十分）。', en: 'On days your mood is likely to dip, train even briefly; 20 minutes and two exercises is enough.' },
    { ja: 'トレの日の気分が低い人は、セット数を2割減らして1週間試し、気分の記録を比べる。', en: 'If your mood is lower on training days, cut sets by about 20% for a week and compare your mood log.' },
    { ja: 'トレ後の気分をひとこと記録する。「効いた日」の共通点（時間帯・種目・睡眠）が見えてきます。', en: 'Log one word about your mood after training. Common threads of the days it "worked" (time, exercises, sleep) will emerge.' },
  ],
  seeDoctor: {
    ja: '気分の落ち込みが2週間以上ほぼ毎日続く、眠れない・楽しめない・自分を責める気持ちが強い、日常生活に支障が出ている、といった場合は、運動だけで抱え込まず、こころの専門の相談窓口や医療機関に話してください。',
    en: 'If low mood lasts most days for two weeks or more, with poor sleep, loss of enjoyment, strong self-blame or difficulty with daily life, do not carry it with exercise alone; talk to a mental health service or clinician.',
  },
  sources: [GORDON_2018, GORDON_2017, SCHUCH_2016],
};

const MULTI_BINGE: LawArticle = {
  meaning: {
    ja: '食べすぎは、たいてい一つの原因では起きません。寝不足だけ、気分の低下だけ、週末だけなら乗り越えられる日でも、それが重なった日は難しくなる。この法則は、あなたの記録の中で「そろうと食べすぎが起きやすくなる条件の組み合わせ」をエンジンが見つけたものです。\n条件は朝の時点で分かるものだけを使っています。つまり、その日の朝に「今日は条件がそろっている」と気づける。気づければ、先回りできます。',
    en: 'Overeating rarely has a single cause. Short sleep alone, low mood alone or a weekend alone may be manageable, but the day they coincide is harder. This pattern is a combination of conditions that, in your log, raised the odds of overeating when they lined up. Only conditions known by the morning are used, so you can notice on the morning itself that the conditions are in place, and plan ahead.',
  },
  science: [
    {
      text: { ja: '日常生活の中で気分を繰り返し記録した36研究のメタ分析では、過食の直前は普段より否定的な気分が高いことが示されています。過食性障害のある女性を追った研究でも、過食の数時間前から気分の低下と空腹感の上昇が始まっていました。前日の気分・当日の朝の状態は、最も一貫した先行要因です。',
      en: 'A meta-analysis of 36 ecological momentary assessment studies found negative affect elevated before binge episodes, and a prospective study in women with binge eating disorder found mood declining and hunger rising hours beforehand. Mood the day before and on the morning itself is the most consistent precursor.' },
      refs: [HAEDT_MATT_2011, STEIN_2007],
    },
    {
      text: { ja: '睡眠を4時間に制限した2晩のあと、レプチンは18%減りグレリンは28%増え、空腹感と食欲が強まりました。17研究のメタ分析では、部分的な睡眠不足の翌日は摂取が平均385kcal増える一方、消費は増えていません。睡眠の条件は、他の条件の効果を「底上げ」します。',
      en: 'Two nights of 4-hour sleep cut leptin by 18% and raised ghrelin by 28% with stronger hunger; a meta-analysis of 17 studies found partial sleep loss adds about 385 kcal the next day. Sleep conditions raise the floor for every other trigger.' },
      refs: [SPIEGEL_2004, AL_KHATIB_2017],
    },
    {
      text: { ja: '厳しい食事制限は、ルールが崩れた瞬間に抑制が外れて食べすぎに向かいやすいという分析が古典的な論文で示されています。「前日が大きめの赤字」という条件が組み合わせに入るのは、この流れです。',
      en: 'Strict dieting tends to end in disinhibition and overeating the moment the rule breaks. This is why "a large deficit the day before" appears among the conditions.' },
      refs: [POLIVY_HERMAN_1985],
    },
    {
      text: { ja: '米国の全国代表調査では、金〜日曜日の摂取エネルギーは平日より多く、脂質とアルコールの割合も上がっていました。曜日は「予定・外食・お酒」の代理変数として、他の条件と重なったときに効きます。',
      en: 'In a nationally representative US survey, intake on Friday-Sunday exceeded weekdays with a higher share from fat and alcohol. Day of the week stands in for plans, eating out and drinks, and matters most when stacked with other conditions.' },
      refs: [HAINES_2003],
    },
    {
      text: { ja: '慢性的なストレスはコルチゾールと報酬系を介して、高カロリーで嗜好性の高い食べものへの欲求を高めます。複数の負荷が重なった日は、この経路が最も開きやすい日です。',
      en: 'Chronic stress, via cortisol and the reward system, heightens desire for palatable high-calorie foods; a day with several strains stacked is when this pathway opens widest.' },
      refs: [ADAM_EPEL_2007],
    },
  ],
  actions: [
    { ja: '朝、条件がそろっていると気づいた日は「今日は+200kcal緩める日」と先に決める。小さく認めるほうが、大きく崩れない。', en: 'On a morning when the conditions line up, decide in advance that today allows an extra 200 kcal. A small allowance prevents a big collapse.' },
    { ja: '条件の中で動かせるもの（睡眠・前日の赤字）を1つだけ選んで、翌週はそれを整える。全部を直す必要はない。', en: 'Pick one condition you can change (sleep, yesterday\'s deficit) and fix only that next week. You do not need to fix everything.' },
    { ja: 'そろった日も記録を続ける。組み合わせの精度は、そろった日の記録があるほど上がります。', en: 'Keep logging on stacked days too; the combination gets more accurate with every logged day it applies.' },
  ],
  seeDoctor: {
    ja: '食べすぎのあとに強い罪悪感や自己嫌悪が続く、嘔吐や絶食などで埋め合わせをしている、コントロールできない食べすぎが週に1回以上・数か月続いている、といった場合は、摂食に関する専門の相談が役に立つことがあります。医療機関や相談窓口に話してみてください。',
    en: 'If overeating is followed by lasting guilt, compensating by vomiting or fasting, or loss-of-control episodes happen weekly for months, specialist support for eating concerns can help. Talk to a clinician or a helpline.',
  },
  caution: {
    ja: '組み合わせは「同じ時期に重なりやすい」ことを示すだけで、どの条件が原因かは特定できません。条件の数が多いほど該当する日は少なくなるため、数字は日数が増えると変わることがあります。',
    en: 'A combination only shows what tends to coincide; it does not identify which condition is the cause. The more conditions, the fewer days qualify, so the number may shift as days accumulate.',
  },
  sources: [HAEDT_MATT_2011, STEIN_2007, SPIEGEL_2004, AL_KHATIB_2017, POLIVY_HERMAN_1985, HAINES_2003, ADAM_EPEL_2007],
};

// ----- 食材ナビ（protein_tier）で追加した出典（2026-09-03）。成分表は文部科学省の公式ページ -----
const MEXT_FOOD_TABLE_2020: EvidenceSource = {
  authors: '文部科学省 科学技術・学術審議会 資源調査分科会',
  title: '日本食品標準成分表（八訂）増補2023年',
  journal: '文部科学省', year: 2023,
  url: 'https://www.mext.go.jp/a_menu/syokuhinseibun/mext_00001.html',
};
const WESTERTERP_2004: EvidenceSource = {
  authors: 'Westerterp-Plantenga MS, Lejeune MP, Nijs I, van Ooijen M, Kovacs EM',
  title: 'High protein intake sustains weight maintenance after body weight loss in humans',
  journal: 'Int J Obes Relat Metab Disord. 28(1):57-64', year: 2004,
  url: 'https://pubmed.ncbi.nlm.nih.gov/14710168/',
};

const PROTEIN_TIER: LawArticle = {
  meaning: {
    ja: 'たんぱく源の「格付け（ティア）」は、あなたが食べたたんぱく源を、たんぱく質1gあたりのカロリー・脂質の割合・つい量が増えやすいか・調理の手間・価格帯で並べたものです。Aティア以上の割合は「同じたんぱく質を、どれだけ少ないカロリーで取れているか」の目安になります。\nこれはどの食材が良い・悪いという話ではありません。手羽先や豚バラにも役割があります。「同じたんぱく質量を別の食材で取ると、1食でどれだけカロリーが変わるか」を数字で見える形にしただけです。増量が目的の人は、カロリー密度と食べやすさを評価する別の基準で並びます。',
    en: 'The protein "tier" ranks the protein sources you actually ate by calories per gram of protein, share of fat, how easily portions grow, preparation effort and price. The share of A-tier-or-above shows how few calories you are spending to get your protein. This is not a verdict on foods; chicken wings and pork belly have their place. It simply makes visible how much one meal\'s calories change when the same protein comes from a different source. For people bulking, the ranking uses a separate scale that rewards energy density and ease of eating.',
  },
  science: [
    {
      text: { ja: '減量中のたんぱく質の役割をまとめた総説では、たんぱく質を多めに取る食事（体重1kgあたり1.2〜1.6g、1食25〜30g）が満腹感・体重管理・減量中の筋肉の維持に有利と整理されています。たんぱく質の「量」を確保しやすい食材を選ぶことが、その前提になります。',
      en: 'A review of protein\'s role in weight loss concludes that higher-protein diets (1.2-1.6 g/kg/day, 25-30 g per meal) support satiety, weight management and preservation of lean mass. Choosing sources that make the quantity easy to reach is the precondition.' },
      refs: [LEIDY_2015],
    },
    {
      text: { ja: '減量後の体重維持を調べた無作為化比較試験では、たんぱく質を1日あたり約18%多く取ったグループのリバウンドが半分程度に抑えられていました。同じカロリーの中でたんぱく質の割合を上げるには、たんぱく質1gあたりのカロリーが低い食材が使いやすいということです。',
      en: 'In a randomized trial of weight maintenance after loss, the group eating about 18% more protein regained roughly half as much weight. Raising protein within the same calories is easiest with foods that carry few calories per gram of protein.' },
      refs: [WESTERTERP_2004],
    },
    {
      text: { ja: '筋トレとたんぱく質の49試験のメタ分析では、総摂取量が体重1kgあたり約1.6g/日までは筋力・除脂肪量の増加が大きくなりました。増量の基準でカロリー密度を評価するのは、たんぱく質と同時にエネルギーも確保しやすい食材を上に置くためです。',
      en: 'A meta-analysis of 49 trials found gains in strength and lean mass increasing up to about 1.6 g/kg/day of total protein. The bulking scale rewards energy density so that sources supplying both protein and energy rank higher.' },
      refs: [MORTON_2018],
    },
    {
      text: { ja: 'このアプリの食材の栄養値は、文部科学省「日本食品標準成分表（八訂）」の可食部100gあたりの値を目安として使っています。品種・部位・調理で20〜30%は動くので、格付けは「だいたいの並び」として読んでください。',
      en: 'Nutrient values in this app are approximate figures from Japan\'s Standard Tables of Food Composition (8th revision), per 100 g edible portion. Variety, cut and cooking shift them by 20-30%, so read the tiers as a rough order.' },
      refs: [MEXT_FOOD_TABLE_2020],
    },
  ],
  actions: [
    { ja: 'いちばんよく食べているCティア以下の食材を、週に1回だけSティアの食材に替えてみる。全部を替える必要はない。', en: 'Once a week, swap your most-eaten C-tier-or-lower source for an S-tier one. There is no need to replace everything.' },
    { ja: '食事タブの「栄養ランキング › たんぱく源」で、いま食べているものがどのティアかを眺める。知っているだけで選び方が変わる。', en: 'Open Nutrient Ranking > Protein sources in the Meals tab and see which tier your usual foods sit in. Knowing is enough to shift your choices.' },
    { ja: '外食・コンビニでは「主菜のたんぱく源を1つ決めてから」選ぶ。サラダチキン・焼き魚・ゆで卵はどこでも手に入る。', en: 'When eating out or at a convenience store, pick the protein source first. Salad chicken, grilled fish and boiled eggs are available almost anywhere.' },
  ],
  caution: {
    ja: 'ティアは「同じたんぱく質量あたりのカロリー」を軸にした目安で、食材の善悪ではありません。脂質の多い食材にも脂溶性ビタミンや満足感といった役割があり、腎臓の病気などでたんぱく質の制限を受けている人は主治医の指示が優先です。',
    en: 'Tiers are a guide based on calories per unit of protein, not a judgement of foods. Fattier sources also supply fat-soluble vitamins and satisfaction, and anyone under medical protein restriction (e.g. kidney disease) should follow their clinician\'s advice.',
  },
  sources: [LEIDY_2015, WESTERTERP_2004, MORTON_2018, MEXT_FOOD_TABLE_2020],
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
  // インサイト・エンジン系9種（E1c）。向きのある種類（wheat_vs_rice_mood / lift_sleep / lift_mood）は
  // 1記事で両方向を扱う（sleep_factor と同じ流儀。variant 専用記事は無い）
  sleep_debt_binge: SLEEP_DEBT_BINGE,
  mood_lag_binge: MOOD_LAG_BINGE,
  wheat_vs_rice_mood: WHEAT_VS_RICE_MOOD,
  salmon_master: SALMON_MASTER,
  chicken_heavy: CHICKEN_HEAVY,
  lift_sleep: LIFT_SLEEP,
  lift_protein_pr: LIFT_PROTEIN_PR,
  lift_mood: LIFT_MOOD,
  multi_binge: MULTI_BINGE,
  // 食材ナビ（2026-09-03）。variant 'swap' / 'default' は1記事で扱う
  protein_tier: PROTEIN_TIER,
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
