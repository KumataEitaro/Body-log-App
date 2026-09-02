// 王冠ゲーティング（MFP式）の判定フック。
//
// 方針: 有料機能をリストから隠さず「行タイトル＋👑」で見せ、タップで文脈つき
// ペイウォール（/paywall?src=...）へ誘導する（moment of intent は汎用提示の約2倍転換）。
//
// ただし現在は全機能無料運用のため、王冠は「課金基盤が有効なビルド」でしか出さない。
// purchasesAvailable()=false（RCキー未設定ビルド）では active=false となり、
// どの画面でも王冠非表示・通常遷移のまま＝実運用の見た目は何も変わらない。
// （無効ビルドで王冠を出すと「課金すれば開く」という嘘になるため）
import { useEffect, useSyncExternalStore } from 'react';
import { supabase } from './supabase';
import { purchasesAvailable, currentPlan, higherPlan } from './purchases';
import { isUnlimited, AI_LIMITS_ENABLED } from './calc';

// ゲート対象の機能キー。画面を足すたびにここへ追加する（文字列unionで拡張）
// 'diet'（食事の制約・B-18）は「AI判定・自由記述・メニュー判定」だけをゲートする。
// 端末内の辞書判定（黒のみ）は無料でも必ず動く＝安全に関わる最低限は有料の壁の裏に置かない
// （docs/DIET-MODES.md §4）
export type GatedFeature = 'laws' | 'digest' | 'eating' | 'coach' | 'insights' | 'diet';

// ===== plan のモジュールスコープキャッシュ =====
// プラン判定の正本はサーバー（profiles.plan。RC webhookとクーポンAPIが更新する）。
// ただし購入直後はwebhookがprofiles.planへ届くまで数秒〜数十秒の遅れがあるため、
// 端末のRC entitlement（purchases.currentPlan）も併せ、**強い方**を採用する（higherPlan）。
// これで「購入直後・復元直後・アプリ再起動（webhook未着やオフライン）」のどのケースでも、
// 王冠と広告（AdSlot）がその場で消える。弱い方に倒れることは無い＝課金した人に広告を見せない。
//
// アプリ起動中に何度も引かない: 最初のuseGateマウントで1回だけ取得し、全画面で共有。
// useSyncExternalStore なので値が変わったときだけ再レンダーされる（再レンダー地獄にしない）。
let serverPlan: string | null = null;      // profiles.plan（正本）
let entitlementPlan: string | null = null; // RC entitlement 由来（購入直後の即時反映・オフライン時）
let plan: string | null = null;            // 両者の強い方（購読者に見せる値）
let unlimited = false; // UNLIMITED_EMAILS（管理者）は常にゲートしない。plan取得と同時にemailで判定
let fetched = false;   // 取得成功後はtrue（失敗時はfalseのまま＝次のマウントで再試行）
let fetching = false;  // 多重リクエストの抑止
const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };
const getPlan = () => plan;

// 合成値を作り直し、変わっていれば購読者（useGate を呼ぶ全画面・全AdSlot）へ通知
function recompute(): void {
  const next = higherPlan(serverPlan, entitlementPlan);
  if (next === plan) return;
  plan = next;
  listeners.forEach((l) => l());
}

async function fetchPlanOnce(): Promise<void> {
  if (fetched || fetching) return;
  fetching = true;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const uid = session?.user?.id;
    if (!uid) return; // 未ログイン中は保留（ログイン後のマウントで再試行）
    // UNLIMITED免除: 管理者アカウントはプランに関係なく全機能を開放する（追加クエリなし）
    unlimited = isUnlimited(session?.user?.email);
    // サーバーの正本と端末のentitlementを並行して引く。entitlementはRC SDKのキャッシュが効くので
    // オフラインでも直近の値が返る（=再起動直後に広告が一瞬出る、を防ぐ）
    const [srv, ent] = await Promise.all([
      supabase.from('profiles').select('plan').eq('id', uid).maybeSingle(),
      currentPlan().catch(() => 'free' as const),
    ]);
    // 上書きではなく強い方を残す: applyEntitlement（購入直後）の値を、直後の引き直しで
    // RC SDK のキャッシュが一瞬古い場合に潰さない。セッション内で entitlement が下がる
    // （期限切れ）のは再起動時に反映されればよい＝広告を出す側に倒す方が害が大きい
    entitlementPlan = higherPlan(entitlementPlan, ent === 'free' ? null : ent);
    if (srv.error) { recompute(); return; } // plan列が無い環境・通信断は「無料扱い」のまま次回に任せる
    serverPlan = (srv.data?.plan as string | null) ?? null;
    fetched = true;
    recompute();
  } catch { /* 失敗しても機能は止めない（gatedはnull=無料として判定する） */ }
  finally { fetching = false; }
}

/** クーポン適用など「サーバーのplanがいま変わった」直後にキャッシュを引き直す */
export async function refreshGate(): Promise<void> {
  fetched = false;
  fetching = false;
  await fetchPlanOnce();
}

/**
 * 購入・復元が通った直後に、端末のentitlement（purchase()/restore()の戻り値）を即時反映する。
 * webhook→profiles.plan の到着を待たずに王冠と広告枠がその場で消える（AdSlot は畳むアニメへ）。
 * 併せてサーバー値も引き直すが、強い方を採るので webhook 未着で戻ってしまうことは無い。
 */
export function applyEntitlement(newPlan: string | null): void {
  entitlementPlan = newPlan == null || newPlan === 'free' ? null : newPlan;
  recompute();
  refreshGate().catch(() => {});
}

/** いまの合成プラン（React外から参照する用・テスト用）。useGate と同じ値 */
export function peekGatePlan(): string | null {
  return plan;
}

export type Gate = {
  /** ゲート機構そのものが生きているか（課金基盤が有効なビルドか） */
  active: boolean;
  /** サーバーのプラン（未取得・未設定はnull=無料扱い） */
  plan: string | null;
  /** この機能に王冠を出すべきか。active=falseなら常にfalse（何もゲートしない） */
  gated: (feature: GatedFeature) => boolean;
};

// スタンダード以上で解放されるプランか（新ティア: 全ゲート機能ともstandard解放で統一）
const STANDARD_UP = new Set(['standard', 'premium']);

/**
 * 王冠を出すかの判定（純関数・jest lib/__tests__/gate.test.ts で固定）。
 *  ・active（RCキー設定済みビルド）でなければ出さない
 *  ・**プラン上限が点火していない（AI_LIMITS_ENABLED=false）間も出さない**。サーバーが全機能を
 *    無料で通している状態で王冠を出すと「課金すれば開く」という嘘になる（2026-09-02 自己監査）。
 *    広告枠（AdSlot / shouldShowAd）はこの判定を通さない＝「広告なし」は上限と無関係に本当の差だから
 *  ・管理者（UNLIMITED_EMAILS）は常に開放
 *  ・plan が standard 未満（null/'free'/'lite'）ならロック
 */
export function isGated(active: boolean, unlimitedUser: boolean, planName: string | null, limitsOn: boolean = AI_LIMITS_ENABLED): boolean {
  if (!active || !limitsOn || unlimitedUser) return false;
  return !STANDARD_UP.has(planName ?? 'free');
}

/** 王冠ゲーティングの判定。各画面はこれ1つで「王冠を出すか」を決められる */
export function useGate(): Gate {
  // RCキー未設定ビルドでは即false（ビルド定数なのでアプリ起動中に変わらない）
  const active = purchasesAvailable();
  const p = useSyncExternalStore(subscribe, getPlan, getPlan);
  useEffect(() => {
    if (active) fetchPlanOnce(); // 無効ビルドではSupabaseにも触らない
  }, [active]);
  return {
    active,
    plan: active ? p : null,
    // 新ティア: ゲート機能はすべて「standard未満（null/'free'/'lite'）でロック」に統一。
    // UNLIMITED_EMAILS（管理者）は常に開放。feature別の必要プランが生まれたらここで出し分ける
    gated: (_feature: GatedFeature) => isGated(active, unlimited, p),
  };
}

/** テスト用: キャッシュを初期状態に戻す */
export function __resetGateForTest(): void {
  serverPlan = null; entitlementPlan = null; plan = null;
  unlimited = false; fetched = false; fetching = false; listeners.clear();
}
