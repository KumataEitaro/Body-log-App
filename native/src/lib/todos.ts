// 通知センターの中身: 「いま入力すべきこと」を、設定した目標と紐づけて洗い出す。
// 目標を立てていない項目は出さない（使わない機能を毎日せかさないため）。
import { supabase } from './supabase';
import { todayJST } from './calc';

export type Todo = {
  key: string;
  icon: string;
  title: string;
  detail: string;
  route: '/log' | '/training' | '/changes' | '/settings';
  urgency: 'now' | 'soon' | 'info';  // now=今日中 / soon=今週中 / info=お知らせ
};

export type TodoResult = { todos: Todo[]; checkedAt: string };

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

/** 今日の入力状況と目標を突き合わせて、やることリストを作る */
export async function buildTodos(): Promise<TodoResult> {
  const today = todayJST();
  const todos: Todo[] = [];

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return { todos, checkedAt: today };

  const weekAgo = new Date(Date.parse(today) - 7 * 86400000).toISOString().slice(0, 10);

  const [entRes, goalRes, photoRes, logRes] = await Promise.all([
    supabase.from('entries').select('date,intake,weight,mood').gte('date', weekAgo).order('date', { ascending: false }),
    supabase.from('goals').select('*').maybeSingle(),
    supabase.from('body_photos').select('date').order('date', { ascending: false }).limit(1),
    supabase.from('logs').select('date,text,adj').gte('date', weekAgo),
  ]);

  const entries = (entRes.data as { date: string; intake: number | null; weight: number | null; mood: string | null }[]) ?? [];
  const todayEntry = entries.find((e) => e.date === today);
  const goal = (goalRes.data ?? null) as Record<string, unknown> | null;
  const logs = (logRes.data as { date: string; text: string | null; adj: number | null }[]) ?? [];

  // --- 食事: 目標体重を設定しているなら毎日の記録が前提になる ---
  if (todayEntry?.intake == null) {
    todos.push({
      key: 'meal',
      icon: '🍽',
      title: '今日の食事がまだ未記録です',
      detail: '1行書くだけでOK。記録が続くほど数字が現実に近づきます。',
      route: '/log',
      urgency: 'now',
    });
  }

  // --- 体重: 目標体重があるなら毎日、なければ3日以上空いたときだけ ---
  const lastWeight = entries.find((e) => e.weight != null);
  const daysSinceWeight = lastWeight ? daysBetween(lastWeight.date, today) : 99;
  const hasWeightGoal = goal?.target_weight != null;
  if (todayEntry?.weight == null && (hasWeightGoal || daysSinceWeight >= 3)) {
    todos.push({
      key: 'weight',
      icon: '⚖️',
      title: hasWeightGoal ? '今日の体重がまだです' : `体重が${daysSinceWeight >= 99 ? '未記録' : `${daysSinceWeight}日ぶり`}です`,
      detail: hasWeightGoal ? '目標日までの計画を正しく引き直すために使います。' : '週に数回でも記録があると、傾向が読めるようになります。',
      route: '/log',
      urgency: hasWeightGoal ? 'now' : 'soon',
    });
  }

  // --- 運動: 週の回数目標を立てている人にだけ、残り回数を知らせる ---
  const perWeek = goal?.ex_per_week != null ? Number(goal.ex_per_week) : null;
  if (perWeek && perWeek > 0) {
    const monday = new Date(Date.parse(today));
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    const ws = monday.toISOString().slice(0, 10);
    const exDays = new Set(
      logs.filter((l) => l.date >= ws && (l.text?.startsWith('🏃') || l.text?.startsWith('🏋️'))).map((l) => l.date),
    ).size;
    if (exDays < perWeek) {
      todos.push({
        key: 'exercise',
        icon: '🏃',
        title: `今週の運動があと${perWeek - exDays}回`,
        detail: `目標は週${perWeek}回。いまは${exDays}回です。散歩でも1回に数えられます。`,
        route: '/training',
        urgency: 'soon',
      });
    }
  }

  // --- 体の写真: 週1回のペース（前回から7日以上） ---
  const lastPhoto = (photoRes.data as { date: string }[] | null)?.[0]?.date ?? null;
  if (!photoRes.error) {
    const d = lastPhoto ? daysBetween(lastPhoto, today) : 99;
    if (d >= 7) {
      todos.push({
        key: 'photo',
        icon: '📸',
        title: lastPhoto ? `体の写真が${d}日ぶりです` : '体の写真をまだ撮っていません',
        detail: '同じ場所・同じポーズで週1枚。数字に出ない変化が見えます。',
        route: '/changes',
        urgency: 'soon',
      });
    }
  }

  // --- 気分: 過食の引き金を掴むための材料 ---
  if (!todayEntry?.mood) {
    todos.push({
      key: 'mood',
      icon: '💭',
      title: '今日の気分が未記録です',
      detail: '気分と食欲はつながっています。1タップで記録できます。',
      route: '/log',
      urgency: 'info',
    });
  }

  // --- 目標そのものが未設定なら、それが最優先 ---
  if (!goal || goal.target_weight == null) {
    todos.unshift({
      key: 'goal',
      icon: '🎯',
      title: '目標がまだ設定されていません',
      detail: '目標を決めると、毎日の「あと食べられる量」が自動で計算されます。',
      route: '/settings',
      urgency: 'now',
    });
  }

  // --- 昨日の抜け（穴埋め） ---
  const y = new Date(Date.parse(today) - 86400000).toISOString().slice(0, 10);
  const yEntry = entries.find((e) => e.date === y);
  const yHasMeal = logs.some((l) => l.date === y && l.text && !l.text.startsWith('🏃') && !l.text.startsWith('🏋️'));
  if (entries.length > 1 && yEntry?.intake == null && !yHasMeal) {
    todos.push({
      key: 'backfill',
      icon: '📝',
      title: '昨日の食事が未記録のままです',
      detail: 'ざっくりでOK。抜けが続くと収支の数字と現実がズレていきます。',
      route: '/log',
      urgency: 'soon',
    });
  }

  return { todos, checkedAt: today };
}

/** バッジに出す件数（お知らせ扱いは数えない） */
export function badgeCount(todos: Todo[]): number {
  return todos.filter((x) => x.urgency !== 'info').length;
}
