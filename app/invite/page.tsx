// 招待ランディング（2026-09-02・feat/invite）。
//
// 「共有ステッカーを見た友人がアプリに辿り着けない＝バイラル装置の空振り」への対応。
// アプリの「友だちを誘う」から共有されるリンクの着地点で、未ログインで見える必要がある
// （proxy.ts の素通しリストに /invite を追加済み）。
//
// 作りは /sunset と同じ「静的・軽量・インラインスタイルのみ」。
// クライアントJSも画像リクエストも最小にする（初対面の人が最初に見る1画面なので、
// 遅い回線でも一瞬で出ることが説得力より優先される）。
import { sanitizeInviteFrom } from '@/lib/invite';

export const metadata = {
  title: 'BodyLoger — つぶやくだけの食事記録',
  description: '「親子丼たべた」と書くだけでカロリーが出る食事記録アプリ。',
};

// 色は /sunset と同じ直書き（Web側に残っているのはこの数ページだけなので、
// トークン基盤を新設せず既存の流儀に合わせる）
const INK = '#0e1116';
const SUB = '#6a7280';
const FAINT = '#9aa1ab';
const TEAL = '#059669';
const TEAL_SOFT = '#e6f7f2';

// App Storeの数値IDがまだ手元にないため、検索URLで着地させる。
// IDが確定したら https://apps.apple.com/jp/app/id<数値> に差し替える
const APP_STORE_URL = 'https://apps.apple.com/search?term=BodyLoger';

// 価値3点（オンボーディングのintro 3枚と同じ順・同じ言い方に揃える）
const POINTS: { emoji: string; title: string; body: string }[] = [
  {
    emoji: '💬',
    title: 'つぶやくだけの記録',
    body: '「親子丼たべた」と書くだけ。カロリーとPFCをAIが出します。重さを量る必要も、食品を検索する必要もありません。',
  },
  {
    emoji: '📈',
    title: 'あなたの法則',
    body: '記録がたまると「あなたはこうすると増える／減る」をアプリが見つけて教えてくれます。一般論ではなく、あなたのデータから。',
  },
  {
    emoji: '🕊',
    title: '失敗の日に優しい',
    body: '1日抜けても週1回まで「お守り」が連続記録をつなぎます。食べすぎた日を責めません。続くことのほうが大事だからです。',
  },
];

export default async function InvitePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  // ?from= は誰でも書き換えられる外部入力。表示以外には一切使わない
  // （リンク先の決定・保存・APIへの送信をしない）。中身の安全化は lib/invite.ts 参照
  const from = sanitizeInviteFrom(sp?.from);

  return (
    <main style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#fbfbfa', color: INK, fontFamily: "'Hiragino Sans','Yu Gothic',sans-serif",
      padding: 24,
    }}>
      <div style={{ maxWidth: 480, width: '100%', textAlign: 'center' }}>
        {from && (
          <p style={{
            fontSize: 13, fontWeight: 700, color: TEAL, background: TEAL_SOFT,
            borderRadius: 999, padding: '7px 16px', display: 'inline-block', margin: '0 0 18px',
          }}>
            {from}さんからの招待です
          </p>
        )}

        {/* アプリアイコン（public/icons/ に置く。proxy.ts の matcher が icons/ を素通しするため、
            未ログインでも画像が /sunset へリダイレクトされない） */}
        <img
          src="/icons/app-icon.png" alt="BodyLoger" width={84} height={84}
          style={{ borderRadius: 20, display: 'block', margin: '0 auto 14px' }}
        />

        <h1 style={{ fontSize: 25, fontWeight: 800, margin: '0 0 8px', lineHeight: 1.4 }}>
          つぶやくだけの、<br />食事記録アプリ
        </h1>
        <p style={{ fontSize: 14, lineHeight: 1.8, color: SUB, margin: '0 0 26px' }}>
          BodyLoger（ボディロガー）
        </p>

        <div style={{ textAlign: 'left' }}>
          {POINTS.map((p) => (
            <div key={p.title} style={{
              background: '#fff', borderRadius: 16, padding: '16px 18px', marginBottom: 10,
              border: '1px solid rgba(14,17,22,0.07)',
            }}>
              <p style={{ fontSize: 15, fontWeight: 800, margin: '0 0 6px' }}>
                <span style={{ marginRight: 8 }}>{p.emoji}</span>{p.title}
              </p>
              <p style={{ fontSize: 13.5, lineHeight: 1.8, color: SUB, margin: 0 }}>{p.body}</p>
            </div>
          ))}
        </div>

        <a
          href={APP_STORE_URL} target="_blank" rel="noopener noreferrer"
          style={{
            display: 'block', marginTop: 22, background: TEAL, color: '#fff',
            fontSize: 16, fontWeight: 800, textDecoration: 'none',
            borderRadius: 14, padding: '15px 20px',
          }}
        >
          App Storeで手に入れる
        </a>
        <p style={{ fontSize: 12.5, color: FAINT, margin: '10px 0 0' }}>
          App Storeで「BodyLoger」と検索しても見つかります。
        </p>
        <p style={{ fontSize: 12.5, color: FAINT, margin: '6px 0 0' }}>
          Android版は準備中です。
        </p>

        <p style={{ fontSize: 12, color: FAINT, marginTop: 26 }}>
          <a href="/terms" style={{ color: FAINT }}>利用規約</a>
          {' ・ '}
          <a href="/privacy" style={{ color: FAINT }}>プライバシーポリシー</a>
          {' ・ '}
          <a href="/support" style={{ color: FAINT }}>お問い合わせ</a>
        </p>
      </div>
    </main>
  );
}
