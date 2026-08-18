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

      <h2 style={{ fontSize: 17, fontWeight: 700, marginTop: 28 }}>お問い合わせ</h2>
      <p>不具合のご報告・ご要望は、アプリ内「設定 → サポート」またはApp Storeのレビューからお寄せください。</p>

      <p style={{ marginTop: 28 }}>
        <a href="/privacy">プライバシーポリシー</a> ・ <a href="/terms">利用規約</a>
      </p>
    </main>
  );
}
