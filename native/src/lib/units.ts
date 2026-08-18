// 単位設定（表示層のみ変換。DBは常にメートル法=kg/cm/kmで保存する）
// データ互換を守るため、保存値は絶対に変換しない。入力時にメートル法へ戻す。
import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type WeightUnit = 'kg' | 'lb';
export type HeightUnit = 'cm' | 'ft';
export type DistanceUnit = 'km' | 'mi';
export type UnitPrefs = { weight: WeightUnit; height: HeightUnit; distance: DistanceUnit };

export const DEFAULT_UNITS: UnitPrefs = { weight: 'kg', height: 'cm', distance: 'km' };
const KEY = 'bl-units';

const LB_PER_KG = 2.20462262;
const IN_PER_CM = 0.393700787;
const MI_PER_KM = 0.621371192;

let prefs: UnitPrefs = DEFAULT_UNITS;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export async function loadUnits(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<UnitPrefs>;
      prefs = { ...DEFAULT_UNITS, ...p };
      emit();
    }
  } catch { /* 既定のまま */ }
}

export async function setUnits(patch: Partial<UnitPrefs>): Promise<void> {
  prefs = { ...prefs, ...patch };
  emit();
  try { await AsyncStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* 保存失敗は表示に影響しない */ }
}

export function getUnits(): UnitPrefs { return prefs; }

export function useUnits(): UnitPrefs {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    getUnits,
    getUnits,
  );
}

// ===== 体重 =====
export function kgToDisplay(kg: number, u: WeightUnit = prefs.weight): number {
  return u === 'lb' ? kg * LB_PER_KG : kg;
}
export function displayToKg(v: number, u: WeightUnit = prefs.weight): number {
  return u === 'lb' ? v / LB_PER_KG : v;
}
export function fmtWeight(kg: number | null | undefined, digits = 1, u: WeightUnit = prefs.weight): string {
  if (kg == null || !isFinite(Number(kg))) return '—';
  return `${kgToDisplay(Number(kg), u).toFixed(digits)}${u}`;
}
export function weightUnitLabel(u: WeightUnit = prefs.weight): string { return u; }

// ===== 身長（ftはフィート+インチの複合表示） =====
export function cmToDisplay(cm: number, u: HeightUnit = prefs.height): number {
  return u === 'ft' ? cm * IN_PER_CM : cm; // ftモードでは「総インチ」を返す
}
export function displayToCm(v: number, u: HeightUnit = prefs.height): number {
  return u === 'ft' ? v / IN_PER_CM : v;
}
export function fmtHeight(cm: number | null | undefined, u: HeightUnit = prefs.height): string {
  if (cm == null || !isFinite(Number(cm))) return '—';
  if (u === 'cm') return `${Math.round(Number(cm))}cm`;
  const totalIn = Math.round(Number(cm) * IN_PER_CM);
  return `${Math.floor(totalIn / 12)}'${totalIn % 12}"`;
}

// ===== 距離 =====
export function kmToDisplay(km: number, u: DistanceUnit = prefs.distance): number {
  return u === 'mi' ? km * MI_PER_KM : km;
}
export function displayToKm(v: number, u: DistanceUnit = prefs.distance): number {
  return u === 'mi' ? v / MI_PER_KM : v;
}
export function fmtDistance(km: number | null | undefined, u: DistanceUnit = prefs.distance): string {
  if (km == null || !isFinite(Number(km))) return '—';
  return `${kmToDisplay(Number(km), u).toFixed(1)}${u}`;
}
