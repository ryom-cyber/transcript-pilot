import './globals.css';

export const metadata = {
  title: 'Transcript-Pilot | 一休営業特化 架電録音解析システム',
  description: '架電録音を自動文字起こし・Salesforceサマリー生成',
};

export default function RootLayout({ children }) {
  return (
    <html lang="ja">
      <body className="bg-gray-50 min-h-screen">{children}</body>
    </html>
  );
}
