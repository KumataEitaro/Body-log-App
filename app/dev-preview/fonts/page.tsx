// フォント比較ページ（C案タイポグラフィ選定用・実機確認のため本番でも表示）
// next/font でビルドに同梱＝外部リクエストなし・オフラインOK
import { Inter_Tight, Space_Grotesk, Archivo, Noto_Sans_JP, Zen_Kaku_Gothic_New, IBM_Plex_Sans_JP } from 'next/font/google';

const interTight = Inter_Tight({ subsets: ['latin'], weight: ['500', '700'], preload: false });
const spaceGrotesk = Space_Grotesk({ subsets: ['latin'], weight: ['500', '700'], preload: false });
const archivo = Archivo({ subsets: ['latin'], weight: ['500', '700'], preload: false });
const noto = Noto_Sans_JP({ subsets: ['latin'], weight: ['400', '500', '700'], preload: false });
const zen = Zen_Kaku_Gothic_New({ subsets: ['latin'], weight: ['400', '500', '700'], preload: false });
const plexJP = IBM_Plex_Sans_JP({ subsets: ['latin'], weight: ['400', '500', '700'], preload: false });

const SYSTEM = `-apple-system, BlinkMacSystemFont, "Hiragino Kaku Gothic ProN", "Yu Gothic UI", sans-serif`;

export default function FontComparePage() {
  const combos = [
    { key: 'A', name: 'A. 現状 — SF Pro × ヒラギノ', ff: SYSTEM, note: 'iOS標準。無難・端末ネイティブ。個性は出ない' },
    { key: 'B', name: 'B. Inter Tight × Noto Sans JP', ff: `${interTight.style.fontFamily}, ${noto.style.fontFamily}, ${SYSTEM}`, note: 'Helvetica系の現代版×定番ゴシック。整っていてクセがない' },
    { key: 'C', name: 'C. Space Grotesk × Zen Kaku Gothic New', ff: `${spaceGrotesk.style.fontFamily}, ${zen.style.fontFamily}, ${SYSTEM}`, note: '数字に個性・日本語はすっきり細身。一番「エディトリアル」' },
    { key: 'D', name: 'D. Archivo × IBM Plex Sans JP', ff: `${archivo.style.fontFamily}, ${plexJP.style.fontFamily}, ${SYSTEM}`, note: '新聞見出し系×硬派なゴシック。骨太' },
  ];

  return (
    <div style={{ minHeight: '100dvh', background: '#fbfbfa', color: '#0e1116', padding: '20px 18px 60px' }}>
      <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: '0.04em', marginBottom: 4 }}>BodyLog フォント比較</div>
      <div style={{ fontSize: 12, color: '#6a7280', marginBottom: 18 }}>気に入った組み合わせの記号（A〜D）を教えてください。数字（大見出し）と日本語（本文）の両方をチェック。</div>

      {combos.map((c) => (
        <div key={c.key} style={{ fontFamily: c.ff, background: '#fff', border: '1px solid #e9eae7', borderRadius: 12, padding: '18px 16px', marginBottom: 14 }}>
          <div style={{ fontFamily: SYSTEM, fontSize: 11, fontWeight: 800, letterSpacing: '0.1em', color: '#059669', marginBottom: 10 }}>{c.name}</div>

          {/* 大数字（ヒーロー） */}
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.16em', color: '#9aa1ab' }}>あと食べられる（計画）</div>
          <div style={{ fontSize: 64, fontWeight: 700, letterSpacing: '-0.04em', lineHeight: 1.05, fontVariantNumeric: 'tabular-nums' }}>
            427<span style={{ fontSize: 15, fontWeight: 500, color: '#9aa1ab', letterSpacing: 0 }}> kcal</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 600, color: '#6a7280', margin: '8px 0 12px', fontVariantNumeric: 'tabular-nums' }}>
            <span>摂取 1,373</span><span>目標 1,800</span>
          </div>

          {/* 日本語本文 */}
          <div style={{ fontSize: 15, fontWeight: 500, lineHeight: 1.7 }}>
            牛丼並盛とサラダを記録しました。
          </div>
          <div style={{ fontSize: 13, color: '#6a7280', lineHeight: 1.7, marginTop: 2 }}>
            減量は続けられるペースがいちばん大事です。目標日を1週間延ばすと毎日の目標カロリーが約180kcal緩みます。
          </div>

          {/* 数字＋日本語の混植（フィード行） */}
          <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #e9eae7', marginTop: 12, paddingTop: 10, fontSize: 14.5, fontVariantNumeric: 'tabular-nums' }}>
            <span><span style={{ color: '#9aa1ab', fontSize: 11, fontWeight: 700 }}>08:12</span>　プロテイン、ゆで卵</span>
            <b>320<span style={{ fontSize: 10, color: '#9aa1ab' }}> KCAL</span></b>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14.5, marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>
            <span><span style={{ color: '#9aa1ab', fontSize: 11, fontWeight: 700 }}>体重</span>　73.5kg ／ ウエスト 79.0cm</span>
            <b style={{ color: '#059669' }}>−0.8kg</b>
          </div>
        </div>
      ))}
      <div style={{ fontSize: 11, color: '#9aa1ab' }}>※どれも端末に同梱配信（オフラインOK）。日本語太字はB/C/Dが専用ウェイト、Aは端末合成。</div>
    </div>
  );
}
