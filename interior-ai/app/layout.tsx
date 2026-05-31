import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'INTERIA — AI 인테리어 시뮬레이터',
  description: '방 사진을 올리면 AI가 원하는 스타일로 인테리어를 바꿔드립니다',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
