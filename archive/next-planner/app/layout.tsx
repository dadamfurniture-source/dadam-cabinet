import type { Metadata } from 'next';
import { Playfair_Display, Noto_Serif_KR } from 'next/font/google';
import './globals.css';

const playfairDisplay = Playfair_Display({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-playfair',
  display: 'swap',
});

const notoSerifKR = Noto_Serif_KR({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-noto-serif',
  display: 'swap',
});

export const metadata: Metadata = {
  title: '다담가구 - AI가 설계하는 프리미엄 맞춤 가구',
  description: '30년 장인정신과 AI 기술의 만남. 완벽한 공간을 위한 최선의 선택, 다담가구.',
  keywords: ['다담가구', '맞춤가구', 'AI설계', '프리미엄가구', '주방가구', '붙박이장'],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={`${playfairDisplay.variable} ${notoSerifKR.variable}`}>
      <body className="font-sans antialiased bg-dadam-white text-dadam-charcoal">{children}</body>
    </html>
  );
}
