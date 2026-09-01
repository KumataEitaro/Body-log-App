import { buildInviteUrl, INVITE_URL } from '@/lib/invite';

// 招待リンクの組み立て。?from= は相手の画面に「◯◯さんからの招待です」と出るだけの値だが、
// URLとして壊れていると共有シートから飛べなくなるため、エンコードと上限を固定で守る。
describe('buildInviteUrl（招待リンクの組み立て）', () => {
  it('名前が無ければパラメータを付けない', () => {
    expect(buildInviteUrl()).toBe(INVITE_URL);
    expect(buildInviteUrl(null)).toBe(INVITE_URL);
    expect(buildInviteUrl('')).toBe(INVITE_URL);
    expect(buildInviteUrl('   ')).toBe(INVITE_URL);
  });

  it('名前を ?from= に載せる', () => {
    expect(buildInviteUrl('くまた')).toBe(`${INVITE_URL}?from=${encodeURIComponent('くまた')}`);
  });

  it('URLとして危険な記号をエンコードする（リンクが途中で切れない）', () => {
    const url = buildInviteUrl('a&b=c #d');
    expect(url).not.toContain('&b');
    expect(url).not.toContain('#');
    expect(url.startsWith(`${INVITE_URL}?from=`)).toBe(true);
  });

  it('20文字で切る（Web側の表示上限と同じ）', () => {
    const url = buildInviteUrl('あ'.repeat(50));
    expect(decodeURIComponent(url.split('from=')[1])).toBe('あ'.repeat(20));
  });

  it('前後・連続の空白を整える', () => {
    expect(decodeURIComponent(buildInviteUrl('  く  また  ').split('from=')[1])).toBe('く また');
  });

  it('着地点は未ログインで見える紹介ページ', () => {
    expect(INVITE_URL).toBe('https://bodylog-orcin.vercel.app/invite');
  });
});
