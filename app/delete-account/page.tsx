// アカウント削除の案内ページ（Google Play必須要件: アプリ外からの削除手段のURL）。
// 実際の削除はアプリ内（設定→アカウントを完全に削除）で完結する。
// アプリを消してしまった人向けにメール窓口も用意する。
export const metadata = { title: 'BodyLoger — アカウントの削除' };

export default function DeleteAccountPage() {
  return (
    <main style={{
      minHeight: '100vh', background: '#fbfbfa', color: '#0e1116',
      fontFamily: "'Hiragino Sans','Yu Gothic',sans-serif", padding: '48px 24px',
    }}>
      <div style={{ maxWidth: 560, margin: '0 auto', lineHeight: 1.9 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 16 }}>アカウントとデータの削除</h1>

        <h2 style={{ fontSize: 16, fontWeight: 800, margin: '24px 0 8px' }}>アプリから削除する（推奨・即時）</h2>
        <ol style={{ paddingLeft: 20, fontSize: 14.5, color: '#3a4150' }}>
          <li>BodyLogerアプリを開く</li>
          <li>右上の⚙（設定）→ いちばん下の「アカウントを完全に削除する」</li>
          <li>確認のため「削除」と入力して実行</li>
        </ol>
        <p style={{ fontSize: 13.5, color: '#6a7280' }}>
          アカウントと、食事・体重・運動・写真・目標・マイ食品を含む
          <b>すべてのデータが即時に完全削除</b>されます。この操作は取り消せません。
        </p>

        <h2 style={{ fontSize: 16, fontWeight: 800, margin: '24px 0 8px' }}>アプリを使えない場合（メールで申請）</h2>
        <p style={{ fontSize: 14.5, color: '#3a4150' }}>
          アプリを削除済みなどの理由で上の手順が使えない場合は、
          <b>登録済みのメールアドレスから</b>件名「アカウント削除希望」で
          下記までご連絡ください。本人確認のうえ、7日以内に削除します。
        </p>
        <p style={{ fontSize: 15, fontWeight: 700 }}>
          連絡先: <a href="/support" style={{ color: '#059669' }}>サポートページ</a> をご覧ください
        </p>

        <h2 style={{ fontSize: 16, fontWeight: 800, margin: '24px 0 8px' }}>削除される・されないもの</h2>
        <ul style={{ paddingLeft: 20, fontSize: 13.5, color: '#6a7280' }}>
          <li>削除される: アカウント・記録（食事/体重/運動/気分）・写真・目標・マイ食品・AI相談履歴</li>
          <li>保持されない: 削除後にサーバーへ残るユーザーデータはありません（バックアップも順次消去されます）</li>
        </ul>

        <p style={{ fontSize: 12, color: '#9aa1ab', marginTop: 32 }}>
          <a href="/privacy" style={{ color: '#9aa1ab' }}>プライバシーポリシー</a>
          {' ・ '}
          <a href="/terms" style={{ color: '#9aa1ab' }}>利用規約</a>
        </p>
      </div>
    </main>
  );
}
