import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '다담가구 - AI가 설계하는 프리미엄 맞춤 가구',
  description: '30년 장인정신과 AI 기술의 만남. 완벽한 공간을 위한 최선의 선택, 다담가구.',
  keywords: ['다담가구', '맞춤가구', 'AI설계', '프리미엄가구', '주방가구', '붙박이장'],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600&family=Noto+Serif+KR:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-sans antialiased bg-dadam-white text-dadam-charcoal">{children}</body>
    </html>
  );
}
