// ブラウザ版のクローズ案内（2026-09-02）。
// Web版のUIは役目を終え、iOSアプリ（BodyLoger）へ一本化した。
// データは同じSupabaseなので、同じメールアドレスでアプリにログインすれば全部そのまま。
// このページとAPI・規約・サポート・app-ads.txtだけがWebに残る。
export const metadata = { title: 'BodyLoger — アプリへ移行しました' };

export default function SunsetPage() {
  return (
    <main style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#fbfbfa', color: '#0e1116', fontFamily: "'Hiragino Sans','Yu Gothic',sans-serif",
      padding: 24,
    }}>
      <div style={{ maxWidth: 480, textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>📱</div>
        <h1 style={{ fontSize: 24, fontWeight: 800, margin: '0 0 12px' }}>
          BodyLogerはアプリになりました
        </h1>
        <p style={{ fontSize: 15, lineHeight: 1.9, color: '#6a7280', margin: '0 0 20px' }}>
          ブラウザ版の提供は終了しました。<br />
          記録・目標などのデータはすべてそのまま残っています。<br />
          <b style={{ color: '#0e1116' }}>同じメールアドレス（またはGoogle / Apple）でアプリにログイン</b>
          すれば、続きから使えます。
        </p>
        <p style={{
          fontSize: 14, fontWeight: 700, background: '#e6f7f2', color: '#059669',
          borderRadius: 12, padding: '12px 16px', display: 'inline-block',
        }}>
          App Storeで「BodyLoger」を検索
        </p>
        <p style={{ fontSize: 12, color: '#9aa1ab', marginTop: 24 }}>
          <a href="/terms" style={{ color: '#9aa1ab' }}>利用規約</a>
          {' ・ '}
          <a href="/privacy" style={{ color: '#9aa1ab' }}>プライバシーポリシー</a>
          {' ・ '}
          <a href="/support" style={{ color: '#9aa1ab' }}>お問い合わせ</a>
        </p>
      </div>
    </main>
  );
}
