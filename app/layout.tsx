import type { Metadata, Viewport } from 'next';
import './globals.css';
import DomTranslator from '@/components/DomTranslator';

export const metadata: Metadata = {
  title: 'BodyLog — 減量トラッカー',
  description: '自然文で食事を記録、AIがkcal/PFCを解析。カロリー収支と判定を毎日追跡。',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body><DomTranslator />{children}</body>
    </html>
  );
}
