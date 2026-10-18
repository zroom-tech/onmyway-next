import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Pretendard (SIL OFL 1.1) — 라이선스: ./fonts/Pretendard-OFL.txt
const pretendard = localFont({
  src: "./fonts/PretendardVariable.woff2",
  variable: "--font-pretendard",
  weight: "45 920",
  display: "swap",
});

export const metadata: Metadata = {
  title: "onmyway",
  description: "출근길 신호를 함께 확인하는 서비스",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className={`${pretendard.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
