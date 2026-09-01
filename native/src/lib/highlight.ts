// きょうのハイライト（B-16）— Appleヘルスケアの「ハイライト」相当。
// その日いちばん意味のある発見を1枚だけ選ぶ選定ロジック（純関数・テスト対象）。
//
// 設計:
//  ・候補は優先順位つき: 新しい法則 > 過食リスク高 > 週間ダイジェスト確定 >
//    自己ベスト更新 > 体重トレンド転換。どれも成立しなければnull（無理に埋めない）。
//  ・選定結果は「kind＋生値」で返す。文章は表示のたびに highlightText で
//    現在の言語で組み立て直す（訳文をキャッシュすると言語切替で化ける。laws.tsと同じ流儀）。
//  ・入力は画面が既に持つデータから機械的に組める形にし、重い取得はしない
//    （唯一の追加クエリ=自己ベスト用の🏋️ログはカード側が1日1回だけ引く）。
import { t } from './i18n';
import { lawText, type LawKind, type LawParams } from './laws';

// ===== 型 =====

/** タップで開く先（laws=法則図鑑への外部遷移・他は概要の詳細ページのキー） */
export type HighlightTarget = 'laws' | 'eating' | 'week' | 'strength' | 'body';

/** 選定結果。生値だけを持ち、そのままJSONでキャッシュできる形にする */
export type HighlightPick =
  | { kind: 'law'; target: 'laws'; lawKind: LawKind; lawP: LawParams }
  | { kind: 'binge'; target: 'eating'; reasonN: number }
  | { kind: 'week'; target: 'week'; rec: number; dW: number | null }
  | { kind: 'pr'; target: 'strength'; name: string; kg: number }
  | { kind: 'trend'; target: 'body'; dir: 'up' | 'down' };

export type HighlightInput = {
  today: string;                                              // YYYY-MM-DD
  law: { kind: LawKind; p: LawParams; foundAt: string } | null; // 図鑑の最新の法則（laws.latestLawRaw）
  bingeLevel: 'low' | 'elevated' | 'high' | null;             // insights.assessBingeRisk の判定
  prevDate: string | null;                                    // 前回ハイライトを判定した日（キャッシュ。週明け判定に使う）
  lastWeek: { rec: number; dW: number | null } | null;        // 先週の集計（lastWeekStats）
  pr: { name: string; kg: number } | null;                    // 直近3日の自己ベスト更新（recentPR）
  trendDir: 'up' | 'down' | 'flat';                           // 今日の体重トレンド（trend.trendDirection）
  prevTrendDir: 'up' | 'down' | 'flat' | null;                // 前回キャッシュした方向
};

// ===== 日付ヘルパー（trend.ts/changes.tsxと同じ定義） =====

function addDays(d: string, n: number): string {
  const dt = new Date(d + 'T00:00:00');
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function weekStartOf(d: string): string {
  const dt = new Date(d + 'T00:00:00');
  dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

// ===== 入力を組むための純関数ヘルパー =====

/** 先週（月〜日）の記録日数と体重変化。記録が1日も無ければnull */
export function lastWeekStats(
  rows: { date: string; intake: number | null; weight: number | null }[],
  today: string,
): { rec: number; dW: number | null } | null {
  const ws = weekStartOf(today);
  const lastWs = addDays(ws, -7);
  const lastW = rows.filter((r) => r.date >= lastWs && r.date < ws);
  const rec = lastW.filter((r) => r.intake != null).length;
  if (rec === 0) return null;
  // 体重変化 = 先週の最後の体重 − 先週開始前の最後の体重（どちらか欠けたらnull）
  const wOf = (list: typeof rows) => {
    const w = list.filter((r) => r.weight != null);
    return w.length ? Number(w[w.length - 1].weight) : null;
  };
  const wEnd = wOf(lastW);
  const wBefore = wOf(rows.filter((r) => r.date < lastWs));
  const dW = wEnd != null && wBefore != null ? Math.round((wEnd - wBefore) * 10) / 10 : null;
  return { rec, dW };
}

/**
 * 直近3日に「過去の記録を上回る」自己ベスト更新があった種目を返す（無ければnull）。
 * 初回記録（比較相手なし）はPRと呼ばない。複数あれば最も重いものを1つ。
 */
export function recentPR(
  series: { name: string; pts: { date: string; maxKg: number }[] }[],
  today: string,
): { name: string; kg: number } | null {
  const from = addDays(today, -2);   // 直近3日 = today-2 〜 today
  let best: { name: string; kg: number } | null = null;
  for (const s of series) {
    let top = { kg: 0, date: '' };
    for (const p of s.pts) if (p.maxKg > top.kg) top = { kg: p.maxKg, date: p.date };
    if (top.kg <= 0 || top.date < from || top.date > today) continue;
    // 更新（それ以前に低い記録がある）だけを祝う。初回1発目はノイズ
    const hadEarlier = s.pts.some((p) => p.date < top.date && p.maxKg > 0 && p.maxKg < top.kg);
    if (!hadEarlier) continue;
    const kg = Math.round(top.kg * 10) / 10;
    if (best == null || kg > best.kg) best = { name: s.name, kg };
  }
  return best;
}

// ===== 選定（優先順位つき・成立しなければnull） =====

export function pickHighlight(input: HighlightInput): HighlightPick | null {
  const { today } = input;

  // 1. 新しい法則の発見（foundAtが直近24h以内 = きのう以降）
  if (input.law != null && input.law.foundAt >= addDays(today, -1) && input.law.foundAt <= today) {
    return { kind: 'law', target: 'laws', lawKind: input.law.kind, lawP: input.law.p };
  }

  // 2. 過食リスク高（既存assessBingeRiskの判定をそのまま使う）
  if (input.bingeLevel === 'high') {
    return { kind: 'binge', target: 'eating', reasonN: 0 };
  }

  // 3. 週間ダイジェスト確定（週明け最初の起動＝前回判定日が先週以前）。先週の記録2日以上で1行に意味が出る
  const isFirstOpenOfWeek = input.prevDate == null || weekStartOf(input.prevDate) < weekStartOf(today);
  if (isFirstOpenOfWeek && input.lastWeek != null && input.lastWeek.rec >= 2) {
    return { kind: 'week', target: 'week', rec: input.lastWeek.rec, dW: input.lastWeek.dW };
  }

  // 4. 自己ベスト更新（直近3日のPR）
  if (input.pr != null) {
    return { kind: 'pr', target: 'strength', name: input.pr.name, kg: input.pr.kg };
  }

  // 5. 体重トレンド転換（前回保存した方向と違う向きに動き出した）
  if (input.prevTrendDir != null && input.trendDir !== 'flat' && input.trendDir !== input.prevTrendDir) {
    return { kind: 'trend', target: 'body', dir: input.trendDir };
  }

  // 6. どれも無い日はカード自体を出さない
  return null;
}

// ===== 文章生成（表示のたびに現在の言語で組み立てる） =====

export function highlightText(pick: HighlightPick): { title: string; body: string } {
  switch (pick.kind) {
    case 'law':
      return {
        title: t('新しい法則が見つかりました'),
        body: lawText(pick.lawKind, pick.lawP).title,
      };
    case 'binge':
      return {
        title: t('きょうは過食リスクが高め'),
        body: t('過去のパターンと似た流れです。たんぱく質を先に、いつもの時間に食べると崩れにくくなります。'),
      };
    case 'week':
      return {
        title: t('先週のふりかえりができました'),
        body: pick.dW != null
          ? t('先週は{n}日記録・体重{d}kg。タップで週のふりかえりへ。', { n: pick.rec, d: `${pick.dW > 0 ? '+' : ''}${pick.dW.toFixed(1)}` })
          : t('先週は{n}日記録しました。タップで週のふりかえりへ。', { n: pick.rec }),
      };
    case 'pr':
      return {
        title: t('自己ベストを更新！'),
        body: t('「{name}」が{kg}kgに到達。積み重ねの成果です。', { name: pick.name, kg: pick.kg }),
      };
    case 'trend':
      return {
        title: t('体重のトレンドが転換'),
        body: pick.dir === 'down'
          ? t('流れが下向きに変わりました。この調子です。')
          : t('流れが上向きに変わりました。早めに気づけたのは記録のおかげです。'),
      };
  }
}
