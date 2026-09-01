// ログイン / 新規登録（Web版と同じSupabaseアカウント）＋Google SSO
import { useState, useEffect } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator, Modal, ScrollView } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { SegmentedControl, OptionButton } from '@/components/ui/Selectable';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { supabase } from '@/lib/supabase';
import { parseAuthCallback } from '@/lib/authCallback';
import { C, sheetTopPad } from '@/lib/ui';
import { useTheme } from '@/lib/theme';
import { t, useLocale, setLocale, LOCALES } from '@/lib/i18n';
import { Languages, Check } from 'lucide-react-native';

WebBrowser.maybeCompleteAuthSession();
const OAUTH_REDIRECT = 'bodylog://auth-callback';

// Apple/Google両方のプロバイダ設定完了（2026-08-26）。両ボタン表示ON。
// （GoogleのみONはApp Store Review 4.8違反になるため、必ずAppleとセットで運用する）
const SHOW_GOOGLE_SSO = true;
// SupabaseのAppleプロバイダ有効化済み（2026-08-26）。ボタン表示ON。
const SHOW_APPLE_SSO = true;

export default function LoginScreen() {
  // Appleサインインボタンの白黒切替に使う（ブランド規定: ライト=黒ボタン/ダーク=白ボタン）
  const { scheme } = useTheme();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [info, setInfo] = useState('');
  // ログイン失敗時に「初めての方は新規登録へ」を出す（未登録者の行き止まり防止）
  const [showSignupHint, setShowSignupHint] = useState(false);

  async function login() {
    if (!email.trim() || !password) { setMsg(t('メールとパスワードを入力してください。')); return; }
    setBusy(true); setMsg(''); setInfo('');
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) {
        if (/invalid login/i.test(error.message)) {
          // セキュリティ上「未登録」と「パスワード違い」は区別されない（列挙攻撃対策の業界標準）。
          // かわりに新規登録への救済導線を出す（βフィードバック: 未登録の人が行き止まりになる）
          setMsg(t('メールまたはパスワードが違います。'));
          setShowSignupHint(true);
        } else {
          setMsg(t('ログインに失敗しました。通信環境を確認してください。'));
        }
      }
      // 成功時は_layoutの認証ゲートが自動でタブへ遷移させる
    } catch {
      setMsg(t('ログインに失敗しました。通信環境を確認してください。'));
    } finally {
      setBusy(false);   // 例外でもボタンを必ず戻す（回り続けると操作不能になる）
    }
  }

  async function signup() {
    const mail = email.trim();
    if (!mail || !password) { setMsg(t('メールとパスワードを入力してください。')); return; }
    if (password.length < 8) { setMsg(t('パスワードは8文字以上にしてください。')); return; }
    if (password !== password2) { setMsg(t('確認用パスワードが一致しません。')); return; }
    setBusy(true); setMsg(''); setInfo('');
    try {
    const { data, error } = await supabase.auth.signUp({ email: mail, password });
    if (error) {
      setMsg(/already registered/i.test(error.message) ? t('このメールアドレスは登録済みです。ログインしてください。')
        : /invalid/i.test(error.message) ? t('メールアドレスの形式を確認してください。')
        : t('登録に失敗しました。通信環境を確認してください。'));
      return;
    }
    // メール確認が有効な場合はセッションが返らない → 確認メール案内
    if (!data.session) {
      setInfo(t('確認メールを {mail} に送りました。メール内のリンクを開いてから、ログインしてください。', { mail }));
      setMode('login');
    }
    // セッションが返った場合は_layoutの認証ゲートが自動遷移
    } catch {
      setMsg(t('登録に失敗しました。通信環境を確認してください。'));
    } finally {
      setBusy(false);   // 例外でもボタンを必ず戻す
    }
  }

  // Google SSO: Supabase→Googleの認可ページをアプリ内ブラウザで開き、
  // bodylog://auth-callback に返ってきたコードをセッションに交換する（PKCE）
  const [gBusy, setGBusy] = useState(false);
  async function googleLogin() {
    setGBusy(true); setMsg(''); setInfo('');
    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: OAUTH_REDIRECT, skipBrowserRedirect: true },
      });
      if (error || !data?.url) {
        setMsg(/provider is not enabled/i.test(error?.message ?? '')
          ? t('Googleログインは準備中です（Supabase側のプロバイダ設定待ち）。')
          : t('Googleログインを開始できませんでした。'));
        return;
      }
      const res = await WebBrowser.openAuthSessionAsync(data.url, OAUTH_REDIRECT);
      if (res.type !== 'success' || !res.url) return; // ユーザーが閉じた
      const parsed = parseAuthCallback(res.url);
      switch (parsed.kind) {
        case 'code': {
          const { error: exErr } = await supabase.auth.exchangeCodeForSession(parsed.code);
          if (exErr) setMsg(t('ログインの完了処理に失敗しました。もう一度お試しください。'));
          return;
        }
        case 'tokens': // フォールバック: implicitフローで #access_token=… が返ってきた場合
          await supabase.auth.setSession({ access_token: parsed.access_token, refresh_token: parsed.refresh_token });
          return;
        case 'error': // Supabase/Google側が理由を返したら握りつぶさず見せる（原因調査を可能にする）
          setMsg(t('Googleログインに失敗しました: {reason}', { reason: parsed.message.slice(0, 120) }));
          return;
        default:
          setMsg(t('ログインの完了処理に失敗しました。もう一度お試しください。'));
      }
    } finally { setGBusy(false); }
  }

  // Appleでサインイン（iOSのみ）。
  // nonceを自前生成しSHA256をAppleへ、生の値をSupabaseへ渡す（トークン置換攻撃の防止）。
  // Supabase側でAppleプロバイダの有効化が必要（未設定なら分かるメッセージを出す）。
  const [aBusy, setABusy] = useState(false);
  const [appleAvail, setAppleAvail] = useState(false);
  useEffect(() => {
    if (Platform.OS === 'ios') {
      AppleAuthentication.isAvailableAsync().then(setAppleAvail).catch(() => {});
    }
  }, []);
  async function appleLogin() {
    setABusy(true); setMsg(''); setInfo('');
    try {
      const rawNonce = Array.from(await Crypto.getRandomBytesAsync(16))
        .map((b) => b.toString(16).padStart(2, '0')).join('');
      const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
      const cred = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
        nonce: hashed,
      });
      if (!cred.identityToken) { setMsg(t('Appleサインインを完了できませんでした。')); return; }
      const { error } = await supabase.auth.signInWithIdToken({
        provider: 'apple', token: cred.identityToken, nonce: rawNonce,
      });
      if (error) {
        setMsg(/provider is not enabled/i.test(error.message)
          ? t('Appleサインインは準備中です（Supabase側のプロバイダ設定待ち）。')
          : t('Appleサインインに失敗しました。もう一度お試しください。'));
      }
    } catch (e) {
      // ユーザーがキャンセルした場合は黙る（エラー扱いにしない）
      if (!(e instanceof Error && /canceled|cancelled|1001/i.test(e.message))) {
        setMsg(t('Appleサインインに失敗しました。もう一度お試しください。'));
      }
    } finally { setABusy(false); }
  }

  const isLogin = mode === 'login';
  const locale = useLocale();
  const [langOpen, setLangOpen] = useState(false);
  const langLabel = LOCALES.find((l) => l.code === locale)?.label ?? '日本語';

  return (
    // KAV(padding)は日本語IMEの候補バーが1打鍵ごとに高さを変えるたび画面全体を
    // 再レイアウトし「ガタガタ揺れる」原因になっていた（βフィードバック 2026-09-02）。
    // ScrollView + automaticallyAdjustKeyboardInsets（iOSネイティブのインセット追従）に変更
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }}
                contentContainerStyle={s.wrap}
                automaticallyAdjustKeyboardInsets
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}>
      <View style={s.inner}>
        <Pressable style={s.langBtn} onPress={() => setLangOpen(true)} hitSlop={8}>
          <Languages size={15} color={C.sub} />
          <Text style={s.langBtnT}>{langLabel}</Text>
        </Pressable>

        <Text style={s.logo}>▍BodyLog</Text>
        <Text style={s.sub}>{isLogin ? t('おかえりなさい。記録を続けましょう') : t('無料アカウントを作成（Web版と共通）')}</Text>

        {/* ログイン/新規登録の切り替え */}
        <View style={{ marginBottom: 16 }}>
          <SegmentedControl
            options={[{ key: 'login', label: t('ログイン') }, { key: 'signup', label: t('新規登録') }]}
            value={mode} onChange={(m) => { setMode(m); setMsg(''); setInfo(''); setShowSignupHint(false); }}
          />
        </View>

        <TextInput style={s.input} placeholder={t('メールアドレス')} placeholderTextColor={C.faint}
                   autoCapitalize="none" keyboardType="email-address" autoComplete="email" value={email} onChangeText={setEmail} />
        <TextInput style={s.input} placeholder={isLogin ? 'パスワード' : t('パスワード（8文字以上）')} placeholderTextColor={C.faint}
                   secureTextEntry autoComplete={isLogin ? 'password' : 'new-password'} value={password} onChangeText={setPassword} />
        {!isLogin && (
          <TextInput style={s.input} placeholder={t('パスワード（確認用）')} placeholderTextColor={C.faint}
                     secureTextEntry value={password2} onChangeText={setPassword2} />
        )}
        {msg ? <Text style={s.err}>{msg}</Text> : null}
        {showSignupHint && mode === 'login' && (
          <Pressable onPress={() => { setMode('signup'); setMsg(''); setShowSignupHint(false); }} hitSlop={8}
                     style={{ alignSelf: 'center', marginTop: 6 }}>
            <Text style={{ fontSize: 13.5, fontWeight: '700', color: C.teal, textDecorationLine: 'underline' }}>
              {t('初めての方はこちら → 新規登録に切り替える')}
            </Text>
          </Pressable>
        )}
        {info ? <Text style={s.info}>{info}</Text> : null}
        <OptionButton style={{ marginTop: 8 }} label={isLogin ? t('ログイン') : t('アカウントを作成')}
                      onPress={isLogin ? login : signup} busy={busy} />
        {/* Appleでサインイン（iOSのみ）。審査ガイドライン上、他のSSOを出すなら必須 */}
        {SHOW_APPLE_SSO && appleAvail && (
          <>
            <View style={s.orRow}>
              <View style={s.orLine} /><Text style={s.orT}>{t('または')}</Text><View style={s.orLine} />
            </View>
            {/* Appleブランドガイドライン準拠: ライト=黒ボタン白文字 / ダーク=白ボタン黒文字。
                ここは意図的な白黒固定（テーマトークンにしない）。ダークで黒ボタンだと背景に沈むため切替する */}
            <Pressable style={({ pressed }) => [s.ssoBtn, scheme === 'dark' ? s.appleBtnDark : s.appleBtn, pressed && { opacity: 0.8 }]}
                       onPress={appleLogin} disabled={aBusy}>
              {aBusy ? <ActivityIndicator color={scheme === 'dark' ? '#000' : '#fff'} /> : (
                <>
                  <Text style={[s.appleMark, scheme === 'dark' && { color: '#000' }]}></Text>
                  <Text style={[s.ssoT, { color: scheme === 'dark' ? '#000' : '#fff' }]}>{t('Appleでサインイン')}</Text>
                </>
              )}
            </Pressable>
          </>
        )}

        {/* SSO（GoogleはOAuthクライアント設定後にSHOW_GOOGLE_SSOをtrueへ） */}
{SHOW_GOOGLE_SSO && (
        <View style={s.orRow}>
          <View style={s.orLine} /><Text style={s.orT}>{t('または')}</Text><View style={s.orLine} />
        </View>
)}
{SHOW_GOOGLE_SSO && (
        <Pressable style={({ pressed }) => [s.ssoBtn, pressed && { opacity: 0.8 }]} onPress={googleLogin} disabled={gBusy}>
          {gBusy ? <ActivityIndicator color={C.ink} /> : (
            <>
              <Text style={s.gMark}>G</Text>
              <Text style={s.ssoT}>{t('Googleで続ける')}</Text>
            </>
          )}
        </Pressable>
)}
        {/* 規約同意の明示（clickwrap相当）。米国では『規約を提示せず同意したとみなす』構成は
            同意の成立自体が争われるため、登録の直前に必ず出し、実際に読める先へリンクする */}
        {!isLogin && (
          <View>
            <Text style={s.terms}>
              {t('登録すると、')}
              <Text style={s.termsLink} onPress={() => WebBrowser.openBrowserAsync('https://bodylog-orcin.vercel.app/terms')}>{t('利用規約')}</Text>
              {t('と')}
              <Text style={s.termsLink} onPress={() => WebBrowser.openBrowserAsync('https://bodylog-orcin.vercel.app/privacy')}>{t('プライバシーポリシー')}</Text>
              {t('に同意したものとみなされます。')}
            </Text>
            <Text style={s.terms}>{t('本サービスは医療機器ではなく、表示される数値はAIによる推定です。16歳未満の方は利用できません。')}</Text>
            <Text style={s.terms}>{t('記録データはあなた専用の領域に保存されます。退会（データ完全削除）はいつでも設定からできます。')}</Text>
          </View>
        )}
      </View>

      <Modal visible={langOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setLangOpen(false)}>
        <View style={s.sheet}>
          <View style={s.sheetHead}>
            <Text style={s.sheetTitle}>{t('言語')}</Text>
            <Pressable onPress={() => setLangOpen(false)} hitSlop={10}>
              <Text style={s.sheetClose}>{t('閉じる')}</Text>
            </Pressable>
          </View>
          <ScrollView>
            {LOCALES.map((l) => (
              <Pressable key={l.code} style={s.langRow}
                         onPress={() => { setLocale(l.code); setLangOpen(false); }}>
                <Text style={s.langRowT}>{l.label}</Text>
                {locale === l.code && <Check size={18} color={C.teal} strokeWidth={3} />}
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </Modal>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  // Appleサインインの白黒はブランド規定の固定色（テーマ非依存）。明暗はscheme分岐で切替
  appleBtn: { backgroundColor: '#000', borderColor: '#000' },
  appleBtnDark: { backgroundColor: '#fff', borderColor: '#fff' },
  appleMark: { color: '#fff', fontSize: 17, fontWeight: '700', marginRight: 6 },
  wrap: { flexGrow: 1, backgroundColor: C.bg, justifyContent: 'center', paddingVertical: 40 },
  inner: { paddingHorizontal: 28 },
  langBtn: {
    alignSelf: 'flex-end', flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 14,
    borderWidth: 1, borderColor: C.line, backgroundColor: C.panel,
    borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6,
  },
  langBtnT: { fontSize: 13, fontWeight: '700', color: C.sub },
  sheet: { flex: 1, backgroundColor: C.bg, paddingHorizontal: 18, paddingTop: sheetTopPad(16) },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  sheetTitle: { fontSize: 17, fontWeight: '800', color: C.ink },
  sheetClose: { fontSize: 15, fontWeight: '700', color: C.teal },
  langRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 15, borderBottomWidth: 0.5, borderBottomColor: C.line,
  },
  langRowT: { fontSize: 17, color: C.ink, fontWeight: '600' },
  logo: { fontSize: 28, fontWeight: '800', color: C.ink, marginBottom: 6 },
  sub: { fontSize: 15, color: C.sub, marginBottom: 18 },
  segWrap: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  seg: { flex: 1, backgroundColor: C.panel, borderWidth: 1.5, borderColor: C.line, borderRadius: 999, paddingVertical: 11, alignItems: 'center' },
  segOn: { backgroundColor: C.ink, borderColor: C.ink },
  segT: { fontSize: 15, fontWeight: '800', color: C.sub },
  input: {
    backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 14,
    paddingHorizontal: 16, paddingVertical: 14, fontSize: 17, color: C.ink, marginBottom: 10,
  },
  err: { color: C.coral, fontSize: 15, marginBottom: 6 },
  info: { color: C.teal, fontSize: 15, marginBottom: 6, lineHeight: 21 },
  btn: { backgroundColor: C.ink, borderRadius: 999, paddingVertical: 15, alignItems: 'center', marginTop: 8 },
  btnT: { color: C.panel, fontSize: 17, fontWeight: '800', letterSpacing: 1 },  // ink地（ダーク=明色）に追従（現状未使用スタイル）
  terms: { fontSize: 13, color: C.faint, marginTop: 8, lineHeight: 18, textAlign: 'center' },
  termsLink: { fontSize: 13, color: C.teal, fontWeight: '700', textDecorationLine: 'underline' },
  orRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 16 },
  orLine: { flex: 1, height: 0.5, backgroundColor: C.line },
  orT: { fontSize: 13, color: C.faint, fontWeight: '700' },
  ssoBtn: {
    flexDirection: 'row', gap: 8, backgroundColor: C.panel, borderWidth: 1.5, borderColor: C.line,
    borderRadius: 999, paddingVertical: 14, alignItems: 'center', justifyContent: 'center',
  },
  gMark: { fontSize: 17, fontWeight: '900', color: '#4285F4' },
  ssoT: { color: C.ink, fontSize: 15, fontWeight: '800' },
});
