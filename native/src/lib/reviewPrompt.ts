// ★レビュー依頼を出すかどうかの判定。
//
// 背景: 公開後にいちばん怖いのは「不満を言う場所が無い人が、いきなり★1を付ける」こと。
// 受け皿（アプリ内フィードバック）を作ったうえで、★の依頼は**満足している瞬間にだけ**出す。
// 起動回数や日数だけを見て機械的に出すダイアログは、うまくいっていない人にも刺さり、
// かえって低評価を集めてしまう（＝依頼しないほうがマシになる）。
//
// 出す条件（すべて満たす初回だけ）:
//   1. 記録が通算14日以上 …… アプリの価値をまだ知らない人に星を聞かない
//   2. 直近で「成功体験」がある …… バッジ獲得 or 目標達成 or ストリーク7日以上のいずれか
//   3. まだ一度も依頼していない（'bl-review-asked'）
//   4. 直近30日以内に「不具合」のフィードバックを送っていない（'bl-feedback-bug-at'）
//      …… 不満を書いたばかりの人に星を求めるのは、いちばんやってはいけないこと
//
// 実際に出すかの最終判断はOS側にもある（StoreReviewは年3回までに制限される）。
// こちらで回数を細かく管理しすぎず、「一度依頼したら二度と聞かない」だけを守る。
import AsyncStorage from '@react-native-async-storage/async-storage';

/** 依頼済みフラグ（一度立ったら二度と依頼しない） */
export const REVIEW_ASKED_KEY = 'bl-review-asked';
/** 「不具合」フィードバックを最後に送った時刻（ISO文字列）。冷却期間の起点 */
export const BUG_SENT_KEY = 'bl-feedback-bug-at';

/** 依頼に必要な通算記録日数 */
export const MIN_RECORDED_DAYS = 14;
/** 成功体験のひとつとして数えるストリークの下限 */
export const MIN_STREAK = 7;
/** 不具合を報告した人を除外する期間（日） */
export const BUG_COOLDOWN_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export type ReviewSignals = {
  /** 通算の記録日数 */
  recordedDays: number;
  /** 現在のストリーク（日） */
  streak: number;
  /** 直近でバッジを獲得したか */
  justEarnedBadge: boolean;
  /** 目標（体重）を達成したか */
  goalReached: boolean;
  /** 過去に一度でも依頼したか */
  alreadyAsked: boolean;
  /** 最後に「不具合」を送った時刻（ISO文字列）。未送信はnull */
  bugSentAt: string | null;
  /** 判定時刻（ms）。テストしやすいように外から渡す */
  now: number;
};

/** 不具合の報告から冷却期間内か（＝いま星を聞いてはいけない人か） */
export function inBugCooldown(bugSentAt: string | null, now: number): boolean {
  if (!bugSentAt) return false;
  const at = Date.parse(bugSentAt);
  // 壊れた値は「冷却中」に倒す（読めない値のせいで不満のある人に依頼するより安全）
  if (Number.isNaN(at)) return true;
  // 未来の時刻（端末時計のずれ）も冷却中とみなす
  if (at > now) return true;
  return now - at < BUG_COOLDOWN_DAYS * DAY_MS;
}

/** 「いま成功体験の直後か」。バッジ・目標達成・ストリークのどれか1つで足りる */
export function hasWinMoment(sig: Pick<ReviewSignals, 'justEarnedBadge' | 'goalReached' | 'streak'>): boolean {
  return sig.justEarnedBadge || sig.goalReached || sig.streak >= MIN_STREAK;
}

/** ★レビューを依頼してよいか（純関数・この判定だけをテストする） */
export function shouldAskReview(sig: ReviewSignals): boolean {
  if (sig.alreadyAsked) return false;
  if (sig.recordedDays < MIN_RECORDED_DAYS) return false;
  if (!hasWinMoment(sig)) return false;
  if (inBugCooldown(sig.bugSentAt, sig.now)) return false;
  return true;
}

/** 「不具合」を送ったことを記録する（フィードバック送信の成功時に呼ぶ） */
export async function markBugReported(nowISO = new Date().toISOString()): Promise<void> {
  try { await AsyncStorage.setItem(BUG_SENT_KEY, nowISO); } catch { /* 冷却が効かないだけ */ }
}

/** 端末に保存している判定材料（依頼済みか・不具合の報告時刻）を読む */
export async function readReviewState(): Promise<{ alreadyAsked: boolean; bugSentAt: string | null }> {
  try {
    const [[, asked], [, bug]] = await AsyncStorage.multiGet([REVIEW_ASKED_KEY, BUG_SENT_KEY]);
    return { alreadyAsked: asked === '1', bugSentAt: bug ?? null };
  } catch {
    // 読めないときは「依頼済み」に倒す（不用意に出すより出さないほうがよい）
    return { alreadyAsked: true, bugSentAt: null };
  }
}

/**
 * 条件を満たしていればOSのレビュー依頼を出す。
 * 依頼した（＝OSに要求を投げた）ときだけtrueを返し、フラグを立てる。
 */
export async function maybeAskReview(
  input: Pick<ReviewSignals, 'recordedDays' | 'streak' | 'justEarnedBadge' | 'goalReached'>,
): Promise<boolean> {
  try {
    const { alreadyAsked, bugSentAt } = await readReviewState();
    if (!shouldAskReview({ ...input, alreadyAsked, bugSentAt, now: Date.now() })) return false;

    // 依存を実際に依頼する瞬間まで引き込まない（判定だけならネイティブモジュールは不要）
    const StoreReview = await import('expo-store-review');
    if (!(await StoreReview.isAvailableAsync())) return false;

    // 先にフラグを立てる。requestReviewは「出したかどうか」を返さない仕様なので、
    // 後で立てると失敗時に何度も出しにいく可能性がある（聞くのは一度きり、を優先）
    await AsyncStorage.setItem(REVIEW_ASKED_KEY, '1');
    await StoreReview.requestReview();
    return true;
  } catch {
    return false;   // レビュー依頼が出ないだけ。アプリの体験は何も変わらない
  }
}
