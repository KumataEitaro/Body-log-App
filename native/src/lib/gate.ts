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
import { purchasesAvailable } from './purchases';
import { isUnlimited } from './calc';

// ゲート対象の機能キー。画面を足すたびにここへ追加する（文字列unionで拡張）
// 'diet'（食事の制約・B-18）は「AI判定・自由記述・メニュー判定」だけをゲートする。
// 端末内の辞書判定（黒のみ）は無料でも必ず動く＝安全に関わる最低限は有料の壁の裏に置かない
// （docs/DIET-MODES.md §4）
export type GatedFeature = 'laws' | 'digest' | 'eating' | 'coach' | 'insights' | 'diet';

// ===== plan のモジュールスコープキャッシュ =====
// プラン判定の正本はサーバー（profiles.plan。RC webhookとクーポンAPIが更新する）。
// アプリ起動中に何度も引かない: 最初のuseGateマウントで1回だけ取得し、全画面で共有。
// useSyncExternalStore なので取得完了時だけ再レンダーされる（再レンダー地獄にしない）。
let plan: string | null = null;
let unlimited = false; // UNLIMITED_EMAILS（管理者）は常にゲートしない。plan取得と同時にemailで判定
let fetched = false;   // 取得成功後はtrue（失敗時はfalseのまま＝次のマウントで再試行）
let fetching = false;  // 多重リクエストの抑止
const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };
const getPlan = () => plan;

async function fetchPlanOnce(): Promise<void> {
  if (fetched || fetching) return;
  fetching = true;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const uid = session?.user?.id;
    if (!uid) return; // 未ログイン中は保留（ログイン後のマウントで再試行）
    // UNLIMITED免除: 管理者アカウントはプランに関係なく全機能を開放する（追加クエリなし）
    unlimited = isUnlimited(session?.user?.email);
    const { data, error } = await supabase.from('profiles').select('plan').eq('id', uid).maybeSingle();
    if (error) return; // plan列が無い環境・通信断は「無料扱い」のまま次回に任せる
    plan = (data?.plan as string | null) ?? null;
    fetched = true;
    listeners.forEach((l) => l());
  } catch { /* 失敗しても機能は止めない（gatedはnull=無料として判定する） */ }
  finally { fetching = false; }
}

/** クーポン適用など「サーバーのplanがいま変わった」直後にキャッシュを引き直す */
export async function refreshGate(): Promise<void> {
  fetched = false;
  fetching = false;
  await fetchPlanOnce();
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
    gated: (_feature: GatedFeature) => active && !unlimited && !STANDARD_UP.has(p ?? 'free'),
  };
}

/** テスト用: キャッシュを初期状態に戻す */
export function __resetGateForTest(): void {
  plan = null; unlimited = false; fetched = false; fetching = false; listeners.clear();
}
