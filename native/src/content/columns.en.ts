// コラムの英語版。日本語版（columns.ts）と id / emoji / minutes を一致させる。
// 診断・治療の指示は書かない。断定を避け、出典を明記する方針も同じ。
import type { Column } from './columns';

export const COLUMNS_EN: Column[] = [
  {
    id: 'a-day-with-bodylog',
    emoji: '📱',
    title: 'A day with BodyLog (how-to guide)',
    lead: 'From a morning check-in to planning dinner with AI',
    minutes: 5,
    body:
`This app works best when you log lightly and let the AI do the heavy lifting. Here is one real day.

**7:10 — Step on the scale.** Type the number into the weight field on the Food tab. Skipping days is fine; the chart connects the gaps.

**7:15 — Pick a mood.** One face on "How do you feel?". It feeds the binge-risk forecast — worth doing most on short-sleep mornings.

**7:30 — Breakfast as a sentence.** Type "banana, plain yogurt, two boiled eggs" and hit ↑ (a photo works too). The AI splits it into items with calories and macros. Fix any amounts, then save with ✓.

**12:00 — Stuck at the convenience store.** Open the Coach tab and ask "What combination from a convenience store fits my remaining budget?" — it answers from your actual remaining calories and macros.

**16:00 — Gym.** Pick the exercise, dial the weight from last time, save. The rest timer starts automatically; the next set only needs reps.

**19:00 — Deciding dinner.** Check the remaining bar above the input, then ask the Coach: "Suggest a dinner that fits what I have left." When a meal with amounts comes back, tap **"Add this meal to the food tray"** — the items appear on the Food tab, ready to adjust and save.

**23:00 — Done.** If a day goes unlogged, tomorrow's AI won't scold you. It states the fact and moves on.

**The one habit that matters:** not perfect logging — asking the AI whenever you hesitate. Everything it can answer is listed under "What else can I ask?".`,
    sources: [],
  },

  {
    id: 'pfc-basics',
    emoji: '🍽',
    title: 'What macros actually are',
    lead: 'P, F and C — and the numbers worth aiming for',
    minutes: 4,
    body:
`Try to manage your weight and you will meet the word "macros" within a day. It looks technical, but it is just the initials of three nutrients.

**P — Protein.** The raw material for muscle, skin, hair and hormones. About 4 kcal per gram.
**F — Fat.** An energy store, and the base material for hormones and cell membranes. About 9 kcal per gram — more than twice the others.
**C — Carbohydrate.** The fastest fuel, especially for your brain and for hard training. About 4 kcal per gram.

Every calorie you eat comes from one of these three. So "total calories" and "the balance of the three" are two different questions, and they need separate answers.

・**Protein: roughly 1.6–2.2g per kg of bodyweight.** In a deficit, more protein protects muscle. Above about 2.2g/kg the extra benefit gets very small.
・**Fat: at least about 0.6–0.8g per kg.** Cut fat too far and hormone production and vitamin absorption suffer. Fat is not the enemy; too much of it is.
・**Carbohydrate: whatever is left.** Once protein and fat are set, carbs fill the remaining calories. This is the number that flexes with your training.

An example. A 70kg person eating 2,000 kcal:
・Protein 140g (560 kcal)
・Fat 55g (495 kcal)
・Carbohydrate 235g (945 kcal)

Do not treat these as rules to obey perfectly. They are a starting point. Hit protein most days, keep fat above the floor, and let carbs move with how much you are training — that alone puts you ahead of most people.

One warning. Chasing macros to the gram is a fast route to burnout. If you only remember one thing: **get enough protein, and do not drop fat too low.** The rest can be approximate.`,
    sources: [
      { label: 'ISSN Position Stand: Protein and Exercise (2017)', url: 'https://jissn.biomedcentral.com/articles/10.1186/s12970-017-0177-8' },
      { label: 'Dietary Reference Intakes (Japan, 2020)', url: 'https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/kenkou_iryou/kenkou/eiyou/syokuji_kijyun.html' },
    ],
  },
  {
    id: 'pfc-why',
    emoji: '⚖️',
    title: 'Why the balance matters, not just the total',
    lead: 'Same calories, different body',
    minutes: 4,
    body:
`Suppose two people both eat 1,800 kcal a day for three months and both lose 6kg. Same result?

On the scale, yes. Inside, no.

The person who ate enough protein loses mostly fat. The person who did not loses fat **and muscle**. Same number on the scale, different bodies — and different futures, because muscle is part of what burns your calories at rest.

**Losing muscle makes the next attempt harder.** Less muscle means a lower resting burn, which means the same diet stops working, which means you cut further, which costs more muscle. That is the loop behind "I keep regaining."

In a controlled trial, participants in an identical deficit were split into higher and lower protein groups. The higher protein group kept more lean mass and lost more fat. The calories were the same. Only the composition differed.

・Protein is the one macro your body cannot store for later. Spread it across meals rather than loading it all at dinner.
・Fat below roughly 0.5g/kg for a long stretch is associated with hormonal disruption. This matters for everyone, not only athletes.
・Carbohydrate is not required for survival, but it is required for **hard training**. Cut it to the floor and your sessions get weaker — which costs you muscle indirectly.

So the total decides **how much** you lose. The balance decides **what** you lose. Both are worth your attention.`,
    sources: [
      { label: 'Longland et al., Am J Clin Nutr (2016)', url: 'https://pubmed.ncbi.nlm.nih.gov/26817506/' },
    ],
  },
  {
    id: 'energy-balance',
    emoji: '➗',
    title: 'In the end, it is energy balance',
    lead: 'And why the scale still refuses to move',
    minutes: 4,
    body:
`Every diet that has ever worked, worked for one reason: energy in was less than energy out. There is no exception, and no food that suspends the rule.

So why does the scale sit still for two weeks while you are clearly eating less?

**Because your weight is not only fat.** On any given morning, the number includes:
・Water — glycogen holds roughly 3g of water per gram. Eat more carbs, weigh more, instantly.
・Food and waste still in transit — easily 1kg of movement.
・Sodium — a salty dinner shows up the next morning.
・For women, the menstrual cycle can swing water by 1–2kg.

Fat loss of 0.5kg in a week is real progress. But it is hiding under 1–2kg of noise. **Looking at a single day is like judging the tide by one wave.**

What to do instead:
・Weigh yourself daily, but read the **weekly average**. That is the signal.
・Give any change three weeks before you judge it.
・If the weekly average has not moved in three weeks and your logging is honest, then adjust — not before.

The other half of the problem is that intake is systematically underestimated. Studies using doubly labelled water find people under-report what they eat by 20–30% on average, and they are not lying — oil, sauces, drinks and bites while cooking simply do not register.

This is why logging matters. Not to shame you. To make the invisible visible.`,
    sources: [
      { label: 'Hall et al., Am J Clin Nutr (2011)', url: 'https://pubmed.ncbi.nlm.nih.gov/21367943/' },
      { label: 'Lichtman et al., N Engl J Med (1992)', url: 'https://pubmed.ncbi.nlm.nih.gov/1454084/' },
    ],
  },
  {
    id: 'move-vs-restrict',
    emoji: '🏃',
    title: 'Move and eat, or sit still and eat less',
    lead: 'Same balance — but not the same outcome',
    minutes: 5,
    body:
`Two ways to run a 500 kcal daily deficit:

**A.** Eat 500 kcal less.
**B.** Eat 200 kcal less and burn 300 kcal moving.

On paper, identical. In practice, B wins on almost every axis that matters.

**More food means more nutrients.** At 1,400 kcal it is genuinely hard to hit your protein, iron and calcium targets. At 1,700 kcal it is easy. The person eating more is better nourished, not worse.

**More food means less hunger.** Hunger is not only about calories — volume and protein matter. Option B lets you keep the volume that keeps you sane.

**Movement protects muscle.** A deficit alone tells your body that muscle is expensive to keep. Resistance training tells it the opposite. Same calories, different message.

**And it is more repeatable.** Severe restriction has an expiry date. Nobody sustains 1,200 kcal for a year. A 200 kcal trim plus a daily walk is something you can still be doing next spring.

The honest caveat: **you cannot outrun a bad diet.** Thirty minutes of jogging burns roughly 250 kcal — one convenience-store pastry. Exercise is a poor eraser and an excellent foundation.

・If you can only do one thing: fix intake first.
・If you can do two: add resistance training, twice a week is enough to matter.
・If you can do three: walk. Non-exercise movement adds up more than most people believe.

The goal is not to suffer efficiently. It is to build something you can keep.`,
    sources: [
      { label: 'Miller et al., Int J Obes (1997)', url: 'https://pubmed.ncbi.nlm.nih.gov/9354192/' },
      { label: 'Levine et al., Science (2005) — NEAT', url: 'https://pubmed.ncbi.nlm.nih.gov/15681386/' },
    ],
  },
  {
    id: 'binge-psychology',
    emoji: '🌪',
    title: 'What is happening when you binge',
    lead: 'It is not weak will. It is a mechanism.',
    minutes: 5,
    body:
`You held the line for five days. On the sixth night you ate everything in the kitchen and could not explain why.

That is not a character flaw. It is a predictable response, and it has been studied for eighty years.

**The Minnesota Starvation Experiment (1944).** Healthy volunteers were put in a prolonged deficit. They became obsessed with food — collecting recipes, reading menus, dreaming about meals. When food was returned, many ate far past fullness for months. These were psychologically screened, stable men. The restriction produced the behaviour.

Three mechanisms stack up:

**1. Physical.** A deficit raises ghrelin (hunger) and lowers leptin (fullness). Your appetite is not imagined; it is being amplified.

**2. Cognitive.** Labelling a food "forbidden" increases its pull. And once the rule is broken, the "what-the-hell effect" kicks in: since today is ruined, everything is permitted. **The rule itself creates the collapse.**

**3. Emotional.** Eating genuinely soothes. Under stress, poor sleep or loneliness, food is the fastest available regulator. Calling that "greed" misses what it is doing for you.

What actually helps:

・**Stop making foods forbidden.** Plan them in. A food you are allowed to eat loses most of its power.
・**Do not run an extreme deficit.** The deeper the cut, the harder the rebound. A slower loss you can hold beats a fast one you cannot.
・**Protect protein and sleep.** Both blunt appetite measurably.
・**Notice the pattern, not the failure.** Which days? After what? This app looks for exactly that — not to score you, but so you can see it coming.
・**After a big day, return to normal — do not punish.** Skipping meals the next day is what turns one night into a cycle.

One heavy day does not undo a month. The cycle of restrict-and-rebound is what does the damage — and that cycle starts with restriction, not with the binge.`,
    sources: [
      { label: 'Keys et al., The Biology of Human Starvation (1950)', url: 'https://pubmed.ncbi.nlm.nih.gov/2136000/' },
      { label: 'Polivy & Herman, Annu Rev Psychol (2002)', url: 'https://pubmed.ncbi.nlm.nih.gov/11752478/' },
    ],
  },
  {
    id: 'plateau',
    emoji: '📉',
    title: 'Getting through a plateau',
    lead: 'Stalling is adaptation, not failure',
    minutes: 5,
    body:
`Weight fell steadily for two months. Now it has not moved in three weeks, and nothing about your effort has changed.

Nothing is broken. Your body did what it is supposed to do.

**You are smaller, so you burn less.** Losing 8kg lowers your daily burn by roughly 100–200 kcal simply because there is less of you to maintain. The deficit that worked at the start is no longer a deficit.

**And you move less without noticing.** In a deficit, spontaneous movement drops — fewer steps, less fidgeting, more sitting. This is called adaptive thermogenesis, and it can account for another 100+ kcal a day. You did not decide to do it.

**And your logging drifts.** Portions creep up, small bites stop being recorded. This is the most common cause and the least comfortable to hear.

In that order, here is what to check:

・**Three weeks of the weekly average, not three days.** Water masks fat loss easily.
・**Log honestly for one week.** Weigh things you normally estimate. Very often the plateau resolves here.
・**Then, if it is real, trim about 10%** — roughly 150–200 kcal. Do not slash 500.
・**Or add movement instead of cutting.** Often kinder and equally effective.
・**Consider a planned break.** Eating at maintenance for 1–2 weeks can restore hormones and, importantly, your patience. Studies on intermittent dieting suggest it does not slow long-term results.

What not to do: cut to 1,000 kcal, train twice as hard, and try to force it. That reliably produces the binge described in the previous column.

A plateau is a sign that your body is adapting well. It just means the plan needs a small update — not that you failed.`,
    sources: [
      { label: 'Rosenbaum & Leibel, Int J Obes (2010)', url: 'https://pubmed.ncbi.nlm.nih.gov/20935667/' },
      { label: 'Byrne et al., Int J Obes (2018) — MATADOR', url: 'https://pubmed.ncbi.nlm.nih.gov/28925405/' },
    ],
  },
  {
    id: 'cheatday',
    emoji: '🍖',
    title: 'The science of the cheat day',
    lead: 'A tool when used well, a trap when not',
    minutes: 5,
    body:
`"Eat freely once a week to reset your metabolism." Half of that sentence is true and the half people rely on is not.

**What is true.** A day of higher intake — especially carbohydrate — raises leptin, refills muscle glycogen, and makes training better for several days. Psychologically it gives restriction a visible end point, which matters more than most people admit.

**What is not.** One day does not "reset" your metabolism. Metabolic adaptation is measured in weeks, not hours. And the arithmetic is unforgiving: six days at −500 kcal builds a 3,000 kcal deficit. A genuinely unrestrained day can erase all of it and then some. A large restaurant meal plus drinks and dessert reaches 3,000–4,000 kcal without difficulty.

If you use one, use it like this:

・**Call it a refeed, not a cheat.** The word matters. "Cheat" frames eating as a moral failure, which feeds the cycle.
・**Aim for maintenance, not unlimited.** Roughly +300 to +500 kcal above your target, mostly from carbohydrate.
・**Put it on a training day** — the calories go somewhere useful.
・**Keep protein where it normally is.** Increase carbs, not fat.
・**Return to normal the next day.** No compensating fast. That is where the cycle starts.
・**Expect the scale to jump 1–2kg.** That is water bound to glycogen, and it leaves within days. Do not react to it.

And the honest question: **if you need a day of escape every week, the other six days may be too strict.** A plan you do not need to escape from is a better plan.`,
    sources: [
      { label: 'Dirlewanger et al., Int J Obes (2000)', url: 'https://pubmed.ncbi.nlm.nih.gov/11126336/' },
      { label: 'Trexler et al., J Int Soc Sports Nutr (2014)', url: 'https://pubmed.ncbi.nlm.nih.gov/24571926/' },
    ],
  },
  {
    id: 'sleep-weight',
    emoji: '😴',
    title: 'Sleep and bodyweight',
    lead: 'Short sleep lowers the quality of your loss',
    minutes: 4,
    body:
`You can run a perfect deficit and train well, and still get a poor result — if you are sleeping five hours.

**Sleep changes what you lose.** In a crossover trial, participants ran the same deficit under 8.5 hours and 5.5 hours of sleep. Total weight lost was similar. But in the short-sleep condition, **only about a quarter of the loss was fat** — versus roughly half when well rested. Same diet. Different body composition.

**Sleep changes how hungry you are.** Short sleep raises ghrelin and lowers leptin. Appetite goes up, satiety goes down, and cravings skew toward high-carb, high-fat food. This is a hormonal shift, not a motivation problem.

**Sleep changes your decisions.** Tired brains discount the future and choose the immediate reward. The decision to order the pastry was, in part, made the night before.

・Aim for 7 hours. Below 6 the effects above are measurable.
・Keep the wake time fixed rather than the bedtime — it stabilises the rhythm faster.
・Caffeine has a half-life of 5–6 hours. A 4pm coffee is still working at 10pm.
・Alcohol makes you fall asleep faster and sleep worse. It suppresses REM.
・Big late meals disturb sleep; so does going to bed hungry. Something small is better than either extreme.

If you can only fix one thing this month and you are sleeping six hours, **fix the sleep, not the diet.** It is the higher-leverage change.`,
    sources: [
      { label: 'Nedeltcheva et al., Ann Intern Med (2010)', url: 'https://pubmed.ncbi.nlm.nih.gov/20921542/' },
      { label: 'Spiegel et al., Ann Intern Med (2004)', url: 'https://pubmed.ncbi.nlm.nih.gov/15583226/' },
    ],
  },
  {
    id: 'individual-variation',
    emoji: '🧬',
    title: 'Same calories, different people',
    lead: 'Why comparing yourself to others is pointless',
    minutes: 5,
    body:
`A friend eats the same as you, moves the same as you, and stays lean. You do not. That gap is real, it is measurable, and it is not a verdict on your discipline.

**The twin overfeeding study.** Bouchard and colleagues fed twelve pairs of identical twins an extra 1,000 kcal a day, six days a week, for 100 days, under supervision. Total surplus: 84,000 kcal.

Weight gain ranged from **4.3kg to 13.3kg** — a threefold spread on an identical surplus. And within each twin pair, the gain was strikingly similar. The variation between pairs was roughly three times the variation within them. Genetics set much of the response.

Where does the difference go?
・**NEAT.** Some people burn hundreds of extra calories a day through spontaneous movement without noticing. This varies enormously between individuals.
・**Digestion and absorption.** Not every calorie on the label is actually absorbed, and the fraction varies.
・**Gut microbiome.** Composition affects energy harvest from the same food.
・**Muscle mass and hormones.** Both shift the resting burn.

What this means for you:

・**Your numbers are yours.** A calculator gives you a starting estimate, not a truth. Your own three weeks of data beat any formula.
・**Comparing yourself to someone else's plan is comparing yourself to their genetics.**
・**Genes set the slope, not the destination.** Even the twins who gained the most were still following energy balance — they simply needed a different number.

This is why the app tunes its estimate from your own record rather than trusting the formula. The formula is where you start, not where you stay.`,
    sources: [
      { label: 'Bouchard et al., N Engl J Med (1990)', url: 'https://pubmed.ncbi.nlm.nih.gov/2336074/' },
      { label: 'Levine et al., Science (1999)', url: 'https://pubmed.ncbi.nlm.nih.gov/9880251/' },
    ],
  },
  {
    id: 'same-calories-different-food',
    emoji: '🥗',
    title: 'Same calories, different sources',
    lead: 'Why this app records what you ate, not just how much',
    minutes: 5,
    body:
`If calories are all that matter, 500 kcal of chicken and rice should behave like 500 kcal of crisps. They do not — and the difference has been measured directly.

**The ultra-processed food trial (Hall et al., 2019).** Twenty adults lived in a research ward and were given, in random order, two weeks of ultra-processed meals and two weeks of unprocessed meals. **The two diets were matched for calories, protein, fat, carbohydrate, sugar, sodium and fibre.** Participants could eat as much or as little as they wanted.

On the ultra-processed diet they ate about **500 kcal more per day** — and gained about 0.9kg. On the unprocessed diet they lost about 0.9kg. Same nutrients on paper. The food itself changed how much they ate.

Why:
・Ultra-processed food is eaten faster, so fullness signals arrive late.
・It is more energy-dense — more calories in less volume.
・It is engineered to be palatable in a way whole food is not.

**And the body spends different amounts digesting.** The thermic effect of food differs by processing: one study found roughly **19.9% of calories burned digesting a whole-food meal versus 10.7% for a processed meal** of the same stated calories. The number on the label is not the number you keep.

・Protein has the highest thermic effect of the three macros (20–30%), fat the lowest (0–3%).
・Fibre and volume drive fullness independently of calories.
・Blood-sugar swings affect hunger a few hours later — which shapes what you eat next.

None of this repeals energy balance. It changes how easy that balance is to hold. **Two people at the same calorie target can face completely different levels of difficulty**, purely because of what the calories are made of.

That is why this app records the contents and not only the total. Over months, "what you ate" is what makes "how much you ate" possible.`,
    sources: [
      { label: 'Hall et al., Cell Metabolism (2019)', url: 'https://pubmed.ncbi.nlm.nih.gov/31105044/' },
      { label: 'Barr & Wright, Food Nutr Res (2010)', url: 'https://pubmed.ncbi.nlm.nih.gov/20613890/' },
    ],
  },
];
