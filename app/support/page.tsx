// App Store申請用のサポートページ（サポートURLとして登録する）
export const metadata = { title: 'サポート | BodyLog' };

export default function SupportPage() {
  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: '48px 20px', lineHeight: 1.9 }}>
      <h1 style={{ fontSize: 24, fontWeight: 800 }}>BodyLog サポート</h1>

      <h2 style={{ fontSize: 17, fontWeight: 700, marginTop: 28 }}>よくある質問</h2>

      <h3 style={{ fontSize: 14.5, fontWeight: 700, marginTop: 18 }}>Q. 目標カロリーはどう決まりますか？</h3>
      <p>プロフィール（性別・身長・年齢・直近体重）から基礎代謝を計算し、活動レベルと運動記録、目標体重・目標日から1日の目安を自動計算します。目標は「設定 → 体重の目標」からいつでも変更できます。</p>

      <h3 style={{ fontSize: 14.5, fontWeight: 700, marginTop: 18 }}>Q. 食事の記録が面倒です。</h3>
      <p>「唐揚げ定食」のように1行書くだけでAIが栄養素を推定します。写真からの推定や、よく食べるものをワンタップで足せる「マイ食品」も使えます。</p>

      <h3 style={{ fontSize: 14.5, fontWeight: 700, marginTop: 18 }}>Q. Apple ヘルスケアと連携できますか？</h3>
      <p>できます。「設定 → データ・連携」から体重の取り込み、「運動」タブからワークアウトの取り込みができます。読み取りのみで、アプリからヘルスケアへの書き込みは行いません。</p>

      <h3 style={{ fontSize: 14.5, fontWeight: 700, marginTop: 18 }}>Q. データを消して退会したい。</h3>
      <p>「設定 → アカウントを削除」から、記録・写真・目標を含むすべてのデータをその場で完全に削除できます。</p>

      {/* ログインできない人の救済（2026-09-16 追加）。
          このページは未ログインでも読めるので、**ここに書いてあることが唯一の出口**になる。
          「アプリ内の設定 → サポート」はログイン後にしか無く、入れない人には届かない */}
      <h3 style={{ fontSize: 14.5, fontWeight: 700, marginTop: 18 }}>Q. パスワードを忘れてログインできない。</h3>
      <p>
        <a href="/reset-password">パスワードの再設定</a>から、登録したメールアドレス宛に再設定用のリンクをお送りします。
        アプリのログイン画面にある「パスワードをお忘れですか？」からも同じ手続きができます。
        メールが届かないときは迷惑メールフォルダもご確認ください。
      </p>

      <h3 style={{ fontSize: 14.5, fontWeight: 700, marginTop: 18 }}>Q. 登録したメールアドレスが分からない／再設定メールが届かない。</h3>
      <p>
        下記の連絡先までご連絡ください。ご本人の確認ができ次第、お調べします。
        Googleアカウント・Appleでサインインをお使いの場合は、ログイン画面のそれぞれのボタンからお入りください。
      </p>

      <h2 style={{ fontSize: 17, fontWeight: 700, marginTop: 28 }}>お問い合わせ</h2>
      <p>
        不具合のご報告・ご要望は、アプリ内「設定 → サポート」またはApp Storeのレビューからお寄せください。
        <b>ログインできずアプリに入れない場合</b>は、
        <a href="mailto:gotcha429@gmail.com?subject=BodyLog%20%E3%83%AD%E3%82%B0%E3%82%A4%E3%83%B3%E3%81%AB%E3%81%A4%E3%81%84%E3%81%A6">gotcha429@gmail.com</a>
        まで直接ご連絡ください。
      </p>

      <p style={{ marginTop: 28 }}>
        <a href="/privacy">プライバシーポリシー</a> ・ <a href="/terms">利用規約</a>
      </p>
    </main>
  );
}
