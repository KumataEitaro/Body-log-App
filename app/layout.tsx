import type { Metadata, Viewport } from 'next';
import { Inter_Tight, Noto_Sans_JP } from 'next/font/google';
import './globals.css';
import DomTranslator from '@/components/DomTranslator';
import SWRegister from '@/components/SWRegister';

// 採用フォント（B案）: 欧文・数字 = Inter Tight / 日本語 = Noto Sans JP。
// next/fontで同梱配信（外部リクエストなし）。CSS変数でglobals.cssから参照する。
const interTight = Inter_Tight({ subsets: ['latin'], variable: '--font-latin' });
const notoJP = Noto_Sans_JP({ subsets: ['latin'], variable: '--font-jp', preload: false });

export const metadata: Metadata = {
  title: 'BodyLog — 減量トラッカー',
  description: '自然文で食事を記録、AIがkcal/PFCを解析。カロリー収支と判定を毎日追跡。',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover', // iOSノッチ領域まで描画してセーフエリア(env())を有効化
  themeColor: '#f8fafc',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" className={`${interTight.variable} ${notoJP.variable}`}>
      <body><SWRegister /><DomTranslator />{children}</body>
    </html>
  );
}
