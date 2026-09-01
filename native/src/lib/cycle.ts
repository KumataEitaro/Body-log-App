// 生理周期モード（月経開始日の記録と、体重グラフへの重ね表示）。
//
// 1500人ペルソナ監査「日本ダイエット層: 女性の周期変動を説明しないグラフが停滞期離脱を生む」。
// 月経前〜月経中は水分貯留で体重が1〜2kg増えることがある。それを「太った」と受け取ると
// 理不尽な自己嫌悪と離脱を生む。**「これは水分かもしれません」と言えるだけで救われる人がいる。**
//
// 【この機能がやらないこと（設計の背骨）】
// ・診断しない。医療行為をしない。症状も体調スコアも持たない（記録するのは開始日と任意メモだけ）。
// ・**次回の予測をしない。** 「次はいつ」を出した瞬間、避妊や妊活の判断材料として使われうる。
//   ここは医療領域なので踏み込まない。平均周期長は「これまでの記録の平均」として過去だけを語る。
// ・「痩せていない」とも「大丈夫」とも断定しない。言えるのは「〜の可能性があります」まで。
//
// 【プライバシー】本アプリで最も機微なデータ。テーブルは supabase/migration-28.sql
// 【ユーザー実行待ち】でRLSは本人のみ。機能自体が既定OFF（CYCLE_ENABLED_KEY）で、
// ONにした本人以外にはカードも帯も一度も現れず、読み書きも起きない。
// テーブル未作成・通信失敗はすべて空配列扱い（機能が静かに非表示になるだけで壊れない）。
import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from 'expo-router';
import { supabase } from './supabase';
import { t } from './i18n';

/** 「生理周期を記録する」設定（既定OFF＝キーが無ければ機能ごと非表示） */
export const CYCLE_ENABLED_KEY = 'bl-cycle-enabled';

/** グラフに敷く帯の既定日数（開始日から5日間）。個人差があるので目安であることを凡例で断る */
export const PERIOD_BAND_DAYS = 5;

/** 水分貯留の説明を出す窓: 月経開始の3日前〜開始後3日 */
export const WATER_WINDOW_BEFORE = 3;
export const WATER_WINDOW_AFTER = 3;

// 記録が途切れたまま「周期200日目」と名乗ると意味を失うどころか不安を煽る。
// 直近の開始日から90日を超えたら「周期◯日目」は言わない（nullに落ちる）。
const MAX_CYCLE_DAY = 90;

// 周期長として平均に採る範囲。打ち間違い（同月内の重複入力・年の打ち間違い）を弾くだけの
// 幅で、正常/異常の医学的判定ではない
const MIN_CYCLE_LEN = 15;
const MAX_CYCLE_LEN = 60;

export type CycleLog = { start_date: string; note: string | null };

// ---- 日付ユーティリティ（lib/calcと同値。循環importを避けてここに置く。vitals.tsと同じ流儀） ----
export function todayJSTLocal(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}

export function addDays(d: string, n: number): string {
  const dt = new Date(d + 'T00:00:00');
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) / 86400000);
}

/** YYYY-MM-DDとして実在する日付か（'2026-02-31'や'' 'abc' undefinedを弾く）。
 *  日付は端末ローカルの0時として扱うため、UTC比較（toISOString）ではなく
 *  年月日の成分どうしで突き合わせる（JSTでは1日ずれてすべて不正になってしまう） */
function isDate(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  const dt = new Date(v + 'T00:00:00');
  if (Number.isNaN(dt.getTime())) return false;
  return dt.getFullYear() === y && dt.getMonth() + 1 === m && dt.getDate() === d;
}

/**
 * 開始日の並びを正規化する（不正データ・重複・順不同に耐える入口）。
 * 返り値は「実在する日付だけ・重複なし・昇順」。以下の純関数はすべてこれを通す。
 */
export function normalizeStarts(dates: unknown[]): string[] {
  const ok = (dates ?? []).filter(isDate);
  return [...new Set(ok)].sort();
}

/**
 * 周期◯日目（開始日当日=1日目）。
 * - dateより前の直近の開始日から数える
 * - 開始日が1件も無い／dateがどの開始日より前／90日を超えて記録が途切れている → null
 */
export function cycleDay(startDates: string[], date: string): number | null {
  if (!isDate(date)) return null;
  const starts = normalizeStarts(startDates);
  let last: string | null = null;
  for (const s of starts) { if (s <= date) last = s; else break; }
  if (last == null) return null;
  const n = daysBetween(last, date) + 1;
  return n >= 1 && n <= MAX_CYCLE_DAY ? n : null;
}

/**
 * これまでの記録の平均周期長（日）。**次回予測には使わない**（過去の平均を述べるだけ）。
 * - 連続する開始日の間隔のうち、15〜60日に収まるものだけを採る（打ち間違いを弾く）
 * - 直近6間隔まで（古い記録に引っぱられて実感とずれるのを防ぐ）
 * - 採れる間隔が無ければ null
 */
export function averageCycleLength(startDates: string[]): number | null {
  const starts = normalizeStarts(startDates);
  const gaps: number[] = [];
  for (let i = 1; i < starts.length; i++) {
    const g = daysBetween(starts[i - 1], starts[i]);
    if (g >= MIN_CYCLE_LEN && g <= MAX_CYCLE_LEN) gaps.push(g);
  }
  const use = gaps.slice(-6);
  if (use.length === 0) return null;
  return Math.round(use.reduce((a, b) => a + b, 0) / use.length);
}

/**
 * 水分貯留の説明を添える窓か（月経開始の3日前〜開始後3日）。
 * ここがtrueのときだけ「増加は水分の可能性があります」の一文を出す。
 * 「体重が増えていない」ことの保証ではないので、呼び出し側も断定表現に使ってはいけない。
 */
export function isWaterRetentionWindow(startDates: string[], date: string): boolean {
  if (!isDate(date)) return false;
  return normalizeStarts(startDates).some(
    (s) => date >= addDays(s, -WATER_WINDOW_BEFORE) && date <= addDays(s, WATER_WINDOW_AFTER)
  );
}

/**
 * 直近n周期の一覧（新しい順）。length=次の開始日までの日数（最新＝進行中はnull）。
 * 打ち間違いで15〜60日の外に出た間隔もそのまま見せる（本人が直せるように隠さない）。
 */
export function recentCycles(startDates: string[], n = 3): { start: string; length: number | null }[] {
  const starts = normalizeStarts(startDates);
  return starts
    .map((s, i) => ({ start: s, length: i + 1 < starts.length ? daysBetween(s, starts[i + 1]) : null }))
    .slice(-n)
    .reverse();
}

/**
 * 体重グラフに敷く月経期間の帯。開始日から既定5日間。
 * 次の開始日が近い（記録間隔が5日未満）ときは重ならないよう手前で切る。
 */
export function menstrualBands(startDates: string[], days = PERIOD_BAND_DAYS): { from: string; to: string }[] {
  const starts = normalizeStarts(startDates);
  const span = Math.max(1, Math.round(days));
  return starts.map((s, i) => {
    let to = addDays(s, span - 1);
    const next = starts[i + 1];
    if (next != null && to >= next) to = addDays(next, -1);
    return { from: s, to: to < s ? s : to };
  });
}

/** メニュー行の要約1行（周期◯日目＋平均。未記録なら記録への誘い） */
export function cycleSummary(startDates: string[], date: string): string {
  const d = cycleDay(startDates, date);
  if (d == null) return t('開始日を記録する');
  const avg = averageCycleLength(startDates);
  return avg != null
    ? t('周期{n}日目・これまでの平均{a}日', { n: d, a: avg })
    : t('周期{n}日目', { n: d });
}

// ---- 保存・読み出し（テーブル未作成・通信失敗は静かに空扱い） ----

/** 直近limit件の開始日（昇順）。cycle_logs未作成なら空配列 */
export async function listCycleStarts(limit = 24): Promise<CycleLog[]> {
  try {
    const { data, error } = await supabase.from('cycle_logs')
      .select('start_date,note')
      .order('start_date', { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return (data as Record<string, unknown>[])
      .map((r) => ({ start_date: String(r.start_date), note: r.note == null ? null : String(r.note) }))
      .filter((r) => isDate(r.start_date))
      .sort((a, b) => (a.start_date < b.start_date ? -1 : 1));
  } catch { return []; }
}

/** 開始日を1件保存（同じ日は上書き＝unique(user_id,start_date)のupsert） */
export async function saveCycleStart(uid: string, startDate: string, note?: string | null):
  Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDate(startDate)) return { ok: false, error: t('日付を確認してください。') };
  if (startDate > todayJSTLocal()) return { ok: false, error: t('未来の日付は記録できません。') };
  try {
    const { error } = await supabase.from('cycle_logs').upsert({
      user_id: uid, start_date: startDate, note: (note ?? '').trim() || null,
    }, { onConflict: 'user_id,start_date' });
    if (error) return { ok: false, error: t('保存できませんでした。通信環境を確認してもう一度お試しください。') };
    return { ok: true };
  } catch {
    return { ok: false, error: t('保存できませんでした。通信環境を確認してもう一度お試しください。') };
  }
}

/** 1件の削除（記録をやめたい・打ち間違いを消したいときに必ず消せる） */
export async function deleteCycleStart(startDate: string): Promise<boolean> {
  try {
    const { error } = await supabase.from('cycle_logs').delete().eq('start_date', startDate);
    return !error;
  } catch { return false; }
}

// ---- 「生理周期を記録する」設定（既定OFF） ----

export async function isCycleEnabled(): Promise<boolean> {
  try { return (await AsyncStorage.getItem(CYCLE_ENABLED_KEY)) === '1'; } catch { return false; }
}

export async function setCycleEnabled(on: boolean): Promise<void> {
  try {
    if (on) await AsyncStorage.setItem(CYCLE_ENABLED_KEY, '1');
    else await AsyncStorage.removeItem(CYCLE_ENABLED_KEY);
  } catch { /* 保存失敗は次回起動でOFFに戻るだけ（安全側） */ }
}

/** 設定のON/OFF（画面フォーカスごとに読み直す。useWeekStepsGoalと同じ流儀） */
export function useCycleEnabled(): boolean {
  const [on, setOn] = useState(false);
  const read = useCallback(() => { isCycleEnabled().then(setOn).catch(() => {}); }, []);
  useEffect(() => { read(); }, [read]);
  useFocusEffect(read);
  return on;
}
