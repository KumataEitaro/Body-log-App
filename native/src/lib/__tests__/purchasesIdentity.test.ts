// RevenueCat の identity 合わせを固定するテスト（QA 2026-09-10 P1-5 の再発防止）。
//
// 事故の形: configure は1プロセス1回しか効かないのに「configured: boolean」の一度きりフラグで
// 管理していたため、アプリを再起動せずにアカウントを切り替えると appUserID が前の人のまま残った。
// その状態で次の人がペイウォールで購入すると、RevenueCat の webhook は appUserID を頼りに
// **前の人の profiles.plan** をプレミアムへ更新してしまう（課金の取り違え）。
import { rcIdentityAction } from '../purchases';

describe('rcIdentityAction（configure / logIn / logOut の判断）', () => {
  it('まだ configure していなければ configure', () => {
    expect(rcIdentityAction(undefined, 'user-A')).toBe('configure');
    expect(rcIdentityAction(undefined, null)).toBe('configure');   // 未ログインでも匿名IDで初期化する
  });

  it('同じユーザーなら何もしない（毎回 logIn を投げない）', () => {
    expect(rcIdentityAction('user-A', 'user-A')).toBe('none');
    expect(rcIdentityAction(null, null)).toBe('none');
  });

  it('uid が変わったら logIn で identity を差し替える', () => {
    expect(rcIdentityAction('user-A', 'user-B')).toBe('logIn');
    expect(rcIdentityAction(null, 'user-B')).toBe('logIn');   // 匿名 → ログイン
  });

  it('サインアウト（uid が null）なら logOut', () => {
    expect(rcIdentityAction('user-A', null)).toBe('logOut');
  });
});
