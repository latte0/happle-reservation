import type { Metadata } from 'next'
import { Noto_Sans_JP, Zen_Maru_Gothic } from 'next/font/google'
import { GoogleTagManager } from '@next/third-parties/google'
import './globals.css'

const notoSans = Noto_Sans_JP({
  subsets: ['latin'],
  variable: '--font-noto-sans',
  display: 'swap',
})

const zenMaru = Zen_Maru_Gothic({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-zen-maru',
  display: 'swap',
})

export const metadata: Metadata = {
  title: '黄土韓方よもぎ蒸し Happle - ご予約',
  description: '黄土韓方よもぎ蒸し Happleのオンライン予約システムです。お好きな日時を選んで簡単にご予約いただけます。',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ja" className={`${notoSans.variable} ${zenMaru.variable}`}>
      {/* Google Tag Manager - GTM IDは環境変数で後から一括変更可能 */}
      {process.env.NEXT_PUBLIC_GTM_ID && (
        <GoogleTagManager gtmId={process.env.NEXT_PUBLIC_GTM_ID} />
      )}
      <body className="font-sans min-h-screen">
        <div className="min-h-screen flex flex-col">
          {/* Header */}
          <header className="bg-white/80 backdrop-blur-md border-b border-accent-100 sticky top-0 z-50">
            <div className="max-w-4xl mx-auto px-4 py-4">
              <a href="/" className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-br from-primary-400 to-primary-600 rounded-xl flex items-center justify-center">
                  <span className="text-white text-lg">🌿</span>
                </div>
                <div>
                  <h1 className="font-display font-bold text-lg text-accent-900">Happle</h1>
                  <p className="text-xs text-accent-500">黄土韓方よもぎ蒸し</p>
                </div>
              </a>
            </div>
          </header>
          
          {/* Main Content */}
          <main className="flex-1">
            {children}
          </main>
          
          {/* Footer */}
          <footer className="bg-accent-900 text-accent-300 py-8">
            <div className="max-w-4xl mx-auto px-4 text-center">
              <p className="text-sm">© 2024 黄土韓方よもぎ蒸し Happle. All rights reserved.</p>
            </div>
          </footer>
        </div>
      </body>
    </html>
  )
}



