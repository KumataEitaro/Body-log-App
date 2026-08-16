'use client';
import Link from 'next/link';

// 大きくタップしやすい戻るボタン（サブ画面の最上部に置く）
export default function BackBar({ label, href, onClick }: { label: string; href?: string; onClick?: () => void }) {
  const inner = (
    <>
      <span className="backbar-ch">‹</span>
      <span>{label}</span>
    </>
  );
  if (href) return <Link href={href} className="backbar">{inner}</Link>;
  return <button className="backbar" onClick={onClick}>{inner}</button>;
}
