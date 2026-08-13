'use client';
// 開発専用: フォント比較ラボ（役目終了）。
// フォントはAパターン（OSネイティブ: SF Pro＋ヒラギノ）に確定したため、
// Google Fontsのダウンロードを伴う旧比較ページは撤去した（ビルド時のネットワーク依存を排除）。
import { notFound } from 'next/navigation';

export default function FontsLabPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return (
    <div style={{ padding: 24 }}>
      <h1>フォント比較ラボ（終了）</h1>
      <p>採用: OSネイティブスタック（iOS = SF Pro ＋ ヒラギノ角ゴ / 数字は等幅tnum）。</p>
      <p className="num">1,234,567.89 kcal ／ P 82 F 41 C 210</p>
      <p>今日の記録 — 鶏むね肉510g、片栗粉 2分</p>
    </div>
  );
}
