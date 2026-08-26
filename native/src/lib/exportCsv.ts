// 記録のCSVエクスポート。
//
// 「データは本人のもの」を形にする（MFP比較で挙がった数少ない負け筋のひとつ）。
// 全記録を1枚のCSVに平らに出す: 食事は品目1行ずつ、運動・体重も同じ表に種類列で並べる。
// ExcelでそのままJST・日本語が読めるよう、UTF-8 BOM付きで書く。
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { supabase } from './supabase';
import { t } from './i18n';
import type { FoodItem } from './items';

function esc(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function timeJST(at: string | null | undefined): string {
  if (!at) return '';
  const ms = Date.parse(at);
  if (Number.isNaN(ms)) return '';
  const d = new Date(ms + 9 * 3600_000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

export async function exportAllCsv(): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const [logsRes, entRes] = await Promise.all([
      supabase.from('logs').select('date,at,text,items,weight,ex,adj').order('date', { ascending: true }).limit(5000),
      supabase.from('entries').select('date,weight,waist,bodyfat').order('date', { ascending: true }),
    ]);
    if (logsRes.error || entRes.error) {
      return { ok: false, error: t('データの取得に失敗しました。通信環境を確認してください。') };
    }

    const rows: string[] = [];
    rows.push(['type', 'date', 'time', 'name', 'qty', 'kcal', 'p_g', 'f_g', 'c_g', 'note'].join(','));

    for (const l of logsRes.data ?? []) {
      const time = timeJST(l.at as string | null);
      const items = (l.items as FoodItem[] | null) ?? [];
      for (const it of items) {
        rows.push(['meal', l.date, time, esc(it.name), esc(it.qty),
          Math.round(Number(it.kcal) || 0), Math.round(Number(it.p) || 0),
          Math.round(Number(it.f) || 0), Math.round(Number(it.c) || 0), ''].join(','));
      }
      const text = String(l.text ?? '');
      if (items.length === 0 && text) {
        // 運動（🏋️/🏃）やメモだけの記録も1行として残す
        rows.push(['activity', l.date, time, esc(text), '', '', '', '', '',
          l.adj ? `adj=${l.adj}` : ''].join(','));
      }
      if (l.weight != null) {
        rows.push(['weight', l.date, time, '', '', '', '', '', '', `${l.weight}kg`].join(','));
      }
    }
    for (const e of entRes.data ?? []) {
      if (e.weight == null && e.waist == null && e.bodyfat == null) continue;
      rows.push(['body', e.date, '', '', '', '', '', '', '',
        esc([e.weight != null ? `weight=${e.weight}` : '', e.waist != null ? `waist=${e.waist}` : '', e.bodyfat != null ? `bodyfat=${e.bodyfat}` : ''].filter(Boolean).join(' '))].join(','));
    }

    const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
    const uri = `${FileSystem.cacheDirectory}bodylog-export-${today}.csv`;
    await FileSystem.writeAsStringAsync(uri, '﻿' + rows.join('\n'), { encoding: FileSystem.EncodingType.UTF8 });

    if (!(await Sharing.isAvailableAsync())) {
      return { ok: false, error: t('この端末では共有シートを開けませんでした。') };
    }
    await Sharing.shareAsync(uri, { mimeType: 'text/csv', dialogTitle: 'BodyLog Export' });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: t('エクスポートに失敗しました（{msg}）。', { msg: e instanceof Error ? e.message : String(e) }) };
  }
}
