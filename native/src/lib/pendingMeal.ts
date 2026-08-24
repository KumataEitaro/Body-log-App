// AIが提案した献立を、相談タブ→食事タブへ渡すための受け渡し場所。
//
// DBには書かない（トレイに載せるだけで、確定は本人が✓保存で行う）。
// 画面間の受け渡しだけなのでメモリで十分。アプリを閉じたら消えるのも正しい挙動
// （翌日に昨日の提案が勝手にトレイへ載っていたら混乱する）。
import type { MealItem } from './coachAction';

let pending: MealItem[] | null = null;

export function setPendingMeal(items: MealItem[]): void {
  pending = items;
}

/** 一度読んだら消える（フォーカスのたびに同じ献立が重複して載らないように） */
export function consumePendingMeal(): MealItem[] | null {
  const v = pending;
  pending = null;
  return v;
}
