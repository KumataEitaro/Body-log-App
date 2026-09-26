// 運動の種目アイコン（lib/activityIcons.ts）が ACTIVITIES の全種目を覆っていることを固定する（2026-09-26）。
// 種目を足したときにアイコンの登録を忘れても、activityIcon() はカテゴリ既定へ落ちるので画面は壊れないが、
// 「絵文字をやめて洗練されたアイコンに」の意図（種目ごとに意味のある絵）が薄れる。ここで抜けを気づかせる。
import { ACTIVITIES, ACTIVITY_GROUPS } from '@/lib/activities';
import { ACTIVITY_ICON, GROUP_ICON, activityIcon } from '@/lib/activityIcons';

describe('運動の種目アイコン', () => {
  it('ACTIVITIES の全種目にアイコンが登録されている（既定を使う種目も明示）', () => {
    const missing = ACTIVITIES.filter((a) => typeof ACTIVITY_ICON[a.id] !== 'object' && typeof ACTIVITY_ICON[a.id] !== 'function').map((a) => a.id);
    expect(missing).toEqual([]);
  });

  it('ACTIVITY_ICON に ACTIVITIES に無い id が紛れていない（改名の取りこぼし）', () => {
    const known = new Set(ACTIVITIES.map((a) => a.id));
    expect(Object.keys(ACTIVITY_ICON).filter((id) => !known.has(id))).toEqual([]);
  });

  it('全カテゴリに既定のアイコンがあり、未登録の id はカテゴリ既定へ落ちる', () => {
    for (const g of ACTIVITY_GROUPS) expect(GROUP_ICON[g.key]).toBeTruthy();
    expect(activityIcon('walk_dog')).toBe(ACTIVITY_ICON.walk_dog);
    expect(activityIcon('no-such-activity')).toBeTruthy();   // 落ちない（Trophy）
  });

  it('絵文字の e フィールドは残っている（他で文字列として使う可能性があるため消さない）', () => {
    for (const a of ACTIVITIES) expect(typeof a.e).toBe('string');
  });
});
