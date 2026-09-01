// 受診用レポート（PDF）
//
// 1500人監査Later群「中高年・健康管理層の本丸」。診察室で医師に見せるのはスマホの
// アプリ画面ではなく紙（かPDF）で、そこに必要なのは直近1ヶ月の要約だけ。
// 体重推移・平均摂取kcal/PFC・血圧/脈拍/血糖の表・運動日数を1〜2枚にまとめる。
//
// 実装は expo-print（HTML→PDF）＋ expo-sharing（既存のCSVエクスポートと同じ共有経路）。
// 日本語の埋め込みフォントは持たないので、フォントは端末のシステムフォントだけを指定する
// （WebKitが解決できる名前を並べ、最後にsans-serifへ落とす＝文字化け・豆腐を避ける）。
//
// 【安全】ヘッダーに必ず免責を刷り込む。ここは診断書ではなく「本人の記録の写し」で、
// 数値にはAI推定（写真・つぶやきからの栄養推定）が混ざる。医師がそれを知らないまま
// 読むことがないように、免責はレポートの最上部・毎ページ見える位置に置く。
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from './supabase';
import { t } from './i18n';
import { listVitals, todayJSTLocal, addDays, type Vital } from './vitals';
import { sumItems, type FoodItem } from './items';

const DAYS = 30;

/** HTMLに埋める前のエスケープ（メモは本人の自由文なのでそのまま流し込まない） */
function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function md(date: string): string {
  return date.slice(5).replace('-', '/');
}

type Summary = {
  from: string;
  to: string;
  weights: { date: string; kg: number }[];
  recordedDays: number;      // 摂取kcalの記録がある日数
  avgKcal: number | null;
  avgP: number | null;
  avgF: number | null;
  avgC: number | null;
  exerciseDays: number;
  vitals: Vital[];
};

/** レポートの材料を集める（どのクエリが落ちても、その節が空になるだけ） */
async function collect(): Promise<Summary | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return null;
  const to = todayJSTLocal();
  const from = addDays(to, -(DAYS - 1));

  const [entRes, logRes, vitals] = await Promise.all([
    supabase.from('entries').select('date,intake,weight').gte('date', from).lte('date', to)
      .order('date', { ascending: true }),
    supabase.from('logs').select('date,text,items').gte('date', from).lte('date', to)
      .order('date', { ascending: true }).limit(2000),
    listVitals(DAYS),
  ]);

  const ent = (entRes.data as { date: string; intake: number | null; weight: number | null }[] | null) ?? [];
  const logs = (logRes.data as { date: string; text: string | null; items: FoodItem[] | null }[] | null) ?? [];

  const weights = ent.filter((e) => e.weight != null).map((e) => ({ date: e.date, kg: Number(e.weight) }));
  const intakes = ent.filter((e) => e.intake != null).map((e) => Number(e.intake));
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

  // PFCは品目のある食事ログを日ごとに合計してから平均する（品目が無い日は分母に入れない）
  const pfcByDate = new Map<string, { p: number; f: number; c: number }>();
  const exDates = new Set<string>();
  for (const l of logs) {
    const txt = String(l.text ?? '');
    if (txt.startsWith('🏋️') || txt.startsWith('🏃')) exDates.add(l.date);
    const items = Array.isArray(l.items) ? l.items : [];
    if (items.length === 0) continue;
    const sum = sumItems(items);
    const cur = pfcByDate.get(l.date) ?? { p: 0, f: 0, c: 0 };
    pfcByDate.set(l.date, { p: cur.p + sum.p, f: cur.f + sum.f, c: cur.c + sum.c });
  }
  const pfcDays = [...pfcByDate.values()];

  return {
    from, to, weights,
    recordedDays: intakes.length,
    avgKcal: avg(intakes),
    avgP: avg(pfcDays.map((d) => d.p)),
    avgF: avg(pfcDays.map((d) => d.f)),
    avgC: avg(pfcDays.map((d) => d.c)),
    exerciseDays: exDates.size,
    vitals,
  };
}

/** 体重推移の折れ線（インラインSVG。画像を持ち込まないので端末フォント・容量に影響しない） */
function weightSvg(pts: { date: string; kg: number }[]): string {
  if (pts.length < 2) return '';
  const w = 520; const h = 120; const pad = 12;
  const vals = pts.map((p) => p.kg);
  const min = Math.min(...vals) - 0.5;
  const max = Math.max(...vals) + 0.5;
  const span = Math.max(0.1, max - min);
  const x = (i: number) => pad + (i / (pts.length - 1)) * (w - pad * 2);
  const y = (v: number) => pad + (1 - (v - min) / span) * (h - pad * 2);
  const d = pts.map((p, i) => `${x(i).toFixed(1)},${y(p.kg).toFixed(1)}`).join(' ');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
    <polyline points="${d}" fill="none" stroke="#333" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
  </svg>`;
}

function buildHtml(sm: Summary): string {
  const w0 = sm.weights[0];
  const w1 = sm.weights[sm.weights.length - 1];
  const dW = w0 && w1 ? w1.kg - w0.kg : null;

  const vitalRows = sm.vitals.length === 0
    ? `<tr><td colspan="5" class="empty">${esc(t('この期間の記録はありません'))}</td></tr>`
    : [...sm.vitals].reverse().map((v) => `<tr>
        <td>${esc(md(v.date))}</td>
        <td class="n">${v.systolic != null || v.diastolic != null ? `${v.systolic ?? '—'}/${v.diastolic ?? '—'}` : '—'}</td>
        <td class="n">${v.pulse ?? '—'}</td>
        <td class="n">${v.glucose ?? '—'}</td>
        <td class="note">${esc(v.note ?? '')}</td>
      </tr>`).join('');

  // 日本語の埋め込みフォントは持たないため、端末に必ずあるシステムフォントだけを指定する
  const FONT = `-apple-system, BlinkMacSystemFont, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", "Noto Sans CJK JP", "Noto Sans JP", "Roboto", sans-serif`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  @page { margin: 14mm 12mm; }
  body { font-family: ${FONT}; color: #1a1a1a; font-size: 12px; line-height: 1.6; }
  h1 { font-size: 18px; margin: 0 0 2px; }
  .period { font-size: 12px; color: #555; margin: 0 0 10px; }
  .disclaimer { border: 1px solid #999; border-radius: 6px; padding: 8px 10px; font-size: 11px; color: #333; margin-bottom: 14px; }
  h2 { font-size: 14px; margin: 16px 0 6px; border-bottom: 1px solid #ccc; padding-bottom: 3px; }
  .kv { display: flex; flex-wrap: wrap; gap: 6px 22px; margin: 4px 0 0; padding: 0; list-style: none; }
  .kv li { font-size: 12px; }
  .kv b { font-size: 14px; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  th, td { border-bottom: 1px solid #ddd; padding: 4px 6px; text-align: left; font-size: 11.5px; }
  th { color: #555; font-size: 10.5px; border-bottom: 1px solid #999; }
  td.n { text-align: right; font-variant-numeric: tabular-nums; }
  td.note { color: #555; }
  td.empty { color: #777; text-align: center; padding: 12px 0; }
  .foot { margin-top: 16px; font-size: 10.5px; color: #666; }
</style></head><body>
  <h1>${esc(t('受診用レポート'))}</h1>
  <p class="period">${esc(t('期間'))}: ${esc(sm.from)} 〜 ${esc(sm.to)}（${esc(t('{n}日間', { n: DAYS }))}）</p>
  <div class="disclaimer">${esc(t('このアプリは医療機器ではありません。数値はAI推定を含みます。'))}<br />${esc(t('本人がアプリに記録した内容の写しです。診断・治療の判断は医師にお任せします。'))}</div>

  <h2>${esc(t('体重'))}</h2>
  <ul class="kv">
    <li>${esc(t('最新'))}: <b>${w1 ? w1.kg.toFixed(1) : '—'}</b> kg</li>
    <li>${esc(t('期間の変化'))}: <b>${dW != null ? `${dW > 0 ? '+' : ''}${dW.toFixed(1)}` : '—'}</b> kg</li>
    <li>${esc(t('記録日数'))}: <b>${sm.weights.length}</b> ${esc(t('日'))}</li>
  </ul>
  ${weightSvg(sm.weights)}

  <h2>${esc(t('食事（1日あたりの平均）'))}</h2>
  <ul class="kv">
    <li>${esc(t('摂取'))}: <b>${sm.avgKcal != null ? sm.avgKcal.toLocaleString() : '—'}</b> kcal</li>
    <li>${esc(t('たんぱく質'))}: <b>${sm.avgP ?? '—'}</b> g</li>
    <li>${esc(t('脂質'))}: <b>${sm.avgF ?? '—'}</b> g</li>
    <li>${esc(t('炭水化物'))}: <b>${sm.avgC ?? '—'}</b> g</li>
    <li>${esc(t('記録日数'))}: <b>${sm.recordedDays}</b> ${esc(t('日'))}</li>
  </ul>

  <h2>${esc(t('バイタル（血圧・脈拍・血糖）'))}</h2>
  <table>
    <thead><tr>
      <th>${esc(t('日付'))}</th><th>${esc(t('血圧 (mmHg)'))}</th><th>${esc(t('脈拍 (bpm)'))}</th><th>${esc(t('血糖 (mg/dL)'))}</th><th>${esc(t('メモ'))}</th>
    </tr></thead>
    <tbody>${vitalRows}</tbody>
  </table>

  <h2>${esc(t('運動'))}</h2>
  <ul class="kv">
    <li>${esc(t('運動した日数'))}: <b>${sm.exerciseDays}</b> ${esc(t('日'))} / ${DAYS} ${esc(t('日'))}</li>
  </ul>

  <p class="foot">${esc(t('作成: BodyLoger'))} — ${esc(sm.to)}</p>
</body></html>`;
}

/** 受診用レポートを作って共有シートに渡す（設定＞データ・連携から呼ぶ） */
export async function shareMedicalReport(): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const sm = await collect();
    if (!sm) return { ok: false, error: t('ログインの状態を確認できませんでした。') };
    const { uri } = await Print.printToFileAsync({ html: buildHtml(sm) });

    // 生成直後のファイル名はランダムなので、共有先で意味の分かる名前に付け替える
    let out = uri;
    try {
      const named = `${FileSystem.cacheDirectory}bodylog-report-${sm.to}.pdf`;
      await FileSystem.moveAsync({ from: uri, to: named });
      out = named;
    } catch { /* 付け替えに失敗しても元のURIで共有できる */ }

    if (!(await Sharing.isAvailableAsync())) {
      return { ok: false, error: t('この端末では共有シートを開けませんでした。') };
    }
    await Sharing.shareAsync(out, { mimeType: 'application/pdf', dialogTitle: t('受診用レポート'), UTI: 'com.adobe.pdf' });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: t('レポートを作成できませんでした（{msg}）。', { msg: e instanceof Error ? e.message : String(e) }) };
  }
}
