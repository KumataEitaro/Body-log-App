// アカウント復旧の導線が存在することを機械的に見張る（2026-09-16）。
//
// 事故の形: 2026-09-16 まで、このアプリには**パスワード再設定の導線が1つも無かった**。
// `resetPasswordForEmail` はアプリにも Web にも1度も呼ばれておらず、
// メール＋パスワードで登録した人がパスワードを忘れると、体重・食事・写真の全記録に
// 二度と辿り着けなかった。ヘルスケアアプリでこれは実質的なデータ消失にあたる。
// しかも問い合わせ先は「アプリ内の設定 → サポート」だけで、**入れない人には届かない**。
//
// 開発者本人（審査用アカウント）が先にこの状態に陥って発覚した。
// 「消す導線（/delete-account）はあるのに、取り戻す導線が無い」状態を二度と作らない。
import fs from 'fs';
import path from 'path';

const NATIVE = path.resolve(__dirname, '..');
const REPO = path.resolve(NATIVE, '..', '..');
const read = (p: string) => fs.readFileSync(p, 'utf8');

describe('パスワードを忘れた人の出口がある', () => {
  const login = read(path.join(NATIVE, 'app', 'login.tsx'));

  it('アプリのログイン画面に「パスワードをお忘れですか？」がある', () => {
    expect(login).toMatch(/パスワードをお忘れですか/);
  });

  it('アプリが resetPasswordForEmail を呼ぶ', () => {
    expect(login).toMatch(/resetPasswordForEmail\(/);
  });

  it('再設定メールの戻り先は Web（bodylog:// にしない）', () => {
    // メールを PC で開く人がいる。bodylog:// は PC では開けず行き止まりになる
    expect(login).toMatch(/PASSWORD_RESET_URL = 'https:\/\/[^']+\/reset-password'/);
    const call = login.match(/resetPasswordForEmail\([^)]*\)/)?.[0] ?? '';
    expect(call).toContain('PASSWORD_RESET_URL');
    expect(call).not.toContain('bodylog://');
  });

  it('登録の有無で返事を変えない（列挙攻撃対策）', () => {
    // resetPasswordForEmail のエラーを見て分岐していたら、登録済みかどうかが漏れる
    const fn = login.slice(login.indexOf('async function sendReset'), login.indexOf('async function signup'));
    expect(fn).toMatch(/catch \{[^}]*\}/);          // 理由を握って
    expect(fn).not.toMatch(/setMsg\(.*error/);       // エラー内容を出さない
  });
});

describe('ログインできない人が連絡できる', () => {
  it('アプリのログイン画面に連絡先が出ている（アプリ内サポートはログイン後にしか無い）', () => {
    const login = read(path.join(NATIVE, 'app', 'login.tsx'));
    expect(login).toMatch(/SUPPORT_MAIL = '[^']+@[^']+'/);
    expect(login).toMatch(/mailto:\$\{SUPPORT_MAIL\}/);
  });

  it('Web のサポートページが、未ログインでも読める形で再設定と連絡先を案内している', () => {
    const support = read(path.join(REPO, 'app', 'support', 'page.tsx'));
    expect(support).toMatch(/\/reset-password/);
    expect(support).toMatch(/mailto:/);
  });
});

describe('Web に再設定ページがある', () => {
  const p = path.join(REPO, 'app', 'reset-password', 'page.tsx');

  it('/reset-password のページが存在する', () => {
    expect(fs.existsSync(p)).toBe(true);
  });

  it('PKCE（?code）と implicit（#access_token）の両方を受ける', () => {
    const src = read(p);
    expect(src).toMatch(/exchangeCodeForSession/);
    expect(src).toMatch(/onAuthStateChange|getSession/);
  });

  it('新しいパスワードを updateUser で保存する', () => {
    expect(read(p)).toMatch(/updateUser\(\{\s*password/);
  });

  it('リンク切れでも行き止まりにしない（その場で再送できる）', () => {
    const src = read(p);
    expect(src).toMatch(/invalid/);
    expect(src).toMatch(/resetPasswordForEmail\(/);
  });

  it('ブラウザ版クローズの振り分け（proxy.ts）で /reset-password を塞いでいない', () => {
    // 2026-09-16: 作った直後、sunset ページへリダイレクトされて機能しなかった。
    // 未ログインでないと意味が無いページなので、公開ページの許可リストに必ず載せる
    const proxy = read(path.join(REPO, 'proxy.ts'));
    expect(proxy).toContain("path === '/reset-password'");
  });

  it('Web のログイン画面からも再設定へ行ける', () => {
    expect(read(path.join(REPO, 'app', 'login', 'page.tsx'))).toMatch(/\/reset-password/);
  });
});

describe('ログイン方法を増やせる（入り口を2つにする）', () => {
  it('lib/identityLink.ts が linkIdentity を使う', () => {
    const src = read(path.join(NATIVE, 'lib', 'identityLink.ts'));
    expect(src).toMatch(/supabase\.auth\.linkIdentity\(/);
    expect(src).toMatch(/getUserIdentities\(/);
  });

  it('設定画面に「ログイン方法を追加する」がある', () => {
    const src = read(path.join(NATIVE, 'app', 'settings.tsx'));
    expect(src).toMatch(/ログイン方法を追加する/);
    expect(src).toMatch(/linkProvider|addLogin/);
  });

  it('Apple の追加は iOS だけに出す', () => {
    const src = read(path.join(NATIVE, 'app', 'settings.tsx'));
    expect(src).toMatch(/Platform\.OS === 'ios' && !linkedIds\.includes\('apple'\)/);
  });
});
