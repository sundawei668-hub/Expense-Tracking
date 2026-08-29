import './globals.css';

const siteUrl = new URL('https://sundawei668-hub.github.io/Expense-Tracking/');
const socialImageUrl = new URL('/og.png', siteUrl).toString();

export const metadata = {
  metadataBase: siteUrl,
  title: '一本账｜我的离线记账本',
  description: '无广告、无会员、数据只属于你的个人离线记账工具。',
  manifest: '/manifest.webmanifest',
  applicationName: '一本账',
  icons: {
    icon: '/icon-192.png',
    apple: '/icon-192.png',
  },
  appleWebApp: {
    capable: true,
    title: '一本账',
    statusBarStyle: 'default',
  },
  openGraph: {
    title: '一本账｜我的离线记账本',
    description: '每一笔，都掌握在自己手里。',
    type: 'website',
    url: siteUrl,
    images: [
      {
        url: socialImageUrl,
        width: 1731,
        height: 909,
        alt: '一本账——每一笔，都掌握在自己手里',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: '一本账｜我的离线记账本',
    description: '每一笔，都掌握在自己手里。',
    images: [socialImageUrl],
  },
};

export const viewport = {
  themeColor: '#1e6748',
  colorScheme: 'light',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
