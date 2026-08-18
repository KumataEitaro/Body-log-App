// 通知センター: 未対応件数の数え方（お知らせ扱いは数えない）
import { badgeCount, type Todo } from '@/lib/todos';

const todo = (key: string, urgency: Todo['urgency']): Todo => ({
  key, urgency, icon: '•', title: key, detail: '', route: '/log',
});

describe('badgeCount', () => {
  it('今日中・今週中は数え、任意（お知らせ）は数えない', () => {
    const list = [todo('a', 'now'), todo('b', 'soon'), todo('c', 'info')];
    expect(badgeCount(list)).toBe(2);
  });

  it('やることが無ければ0', () => {
    expect(badgeCount([])).toBe(0);
  });

  it('お知らせだけなら0（毎日バッジが出続けないように）', () => {
    expect(badgeCount([todo('mood', 'info')])).toBe(0);
  });
});
