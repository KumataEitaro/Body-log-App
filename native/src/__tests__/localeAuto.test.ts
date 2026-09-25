// 言語の自動追従（lib/i18n.ts・2026-09-25）: 既定は端末の設定に従い、手動で選ぶと固定、自動に戻せる
let mockLang = 'en';
jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: mockLang }],
}));

import { getLocale, isExplicitLocale, loadLocale, setLocale, setLocaleAuto, syncDeviceLocale, deviceLocaleLabel } from '@/lib/i18n';

describe('言語は端末の設定に従う（手動選択も可能）', () => {
  beforeEach(async () => {
    mockLang = 'en';
    await setLocaleAuto();
  });
  afterAll(async () => { mockLang = 'ja'; await setLocaleAuto(); });

  it('保存された手動選択が無ければ端末の言語（対応言語）になる', async () => {
    await loadLocale();
    expect(getLocale()).toBe('en');
    expect(isExplicitLocale()).toBe(false);
  });

  it('対応外の端末言語は英語に丸める', async () => {
    mockLang = 'xx';
    await setLocaleAuto();
    expect(getLocale()).toBe('en');
    expect(deviceLocaleLabel()).toBe('English');
  });

  it('手動で選ぶと固定され、端末の言語が変わっても追わない', async () => {
    await setLocale('ko');
    expect(isExplicitLocale()).toBe(true);
    mockLang = 'fr';
    expect(syncDeviceLocale()).toBe(false);
    expect(getLocale()).toBe('ko');
  });

  it('「端末の設定に従う」に戻すと端末の言語へ切り替わり、以後は前景復帰で追従する', async () => {
    await setLocale('ko');
    mockLang = 'fr';
    await setLocaleAuto();
    expect(isExplicitLocale()).toBe(false);
    expect(getLocale()).toBe('fr');
    mockLang = 'de';
    expect(syncDeviceLocale()).toBe(true);
    expect(getLocale()).toBe('de');
    expect(syncDeviceLocale()).toBe(false);   // 変化が無ければ何もしない
  });
});
