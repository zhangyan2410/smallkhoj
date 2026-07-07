import type { Metadata } from "next"
import { Inter } from "next/font/google"
import Script from "next/script"
import { NextIntlClientProvider } from "next-intl"
import { getLocale, getMessages } from "next-intl/server"
import "./globals.css"

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
})

export const metadata: Metadata = {
  title: "SmallKhoj",
  description: "A lightweight AI chat framework",
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const locale = await getLocale()
  const messages = await getMessages()
  return (
    <html lang={locale} className={inter.variable} suppressHydrationWarning>
      <head>
        {/* DESIGN.md: light is the default; dark is opt-in via theme=localStorage. */}
        <Script
          id="smallkhoj-theme"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var theme = localStorage.getItem('theme');
                  /* 三主题：'dark' | 'shuimo' | null(=water，默认，不加任何 class)。
                     只加一个 class，避免 .dark/.shuimo 叠加。 */
                  if (theme === 'dark') {
                    document.documentElement.classList.add('dark');
                  } else if (theme === 'shuimo') {
                    document.documentElement.classList.add('shuimo');
                  }
                } catch(e) {
                  /* default to water (no class) */
                }
              })();
            `,
          }}
        />
      </head>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
