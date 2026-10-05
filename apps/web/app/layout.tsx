import type { Metadata, Viewport } from 'next'
import Link from 'next/link'
import { Public_Sans, Roboto_Mono } from 'next/font/google'
import { PRODUCT } from '@/lib/product'
import './globals.css'

/**
 * Type pairing: Public Sans with Roboto Mono.
 *
 * The generated pairing was Söhne + Söhne Mono. Söhne is commercially licensed and this
 * repository is MIT with no bundled font licence, so it cannot be shipped. Public Sans is the
 * free grotesque that keeps the same institutional character; Roboto Mono keeps the tabular
 * alignment the index readouts depend on. Recorded in docs/adr/0004.
 */
const sans = Public_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-public-sans',
})

const mono = Roboto_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-roboto-mono',
})

export const metadata: Metadata = {
  title: PRODUCT.name,
  description: PRODUCT.tagline,
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <body>
        <div className="shell">
          <header className="site-header">
            <div className="container">
              <Link href="/" className="brand">
                <span className="brand-mark">DIG</span>
                {PRODUCT.name}
              </Link>
              <nav className="site-nav" aria-label="Main">
                <Link href="/">Board</Link>
                <Link href="/policy">Policy</Link>
                <Link href="/surfaces">Surfaces</Link>
                <Link href="/health">Health</Link>
              </nav>
            </div>
          </header>

          <main>
            <div className="container">{children}</div>
          </main>

          <footer className="site-footer">
            <div className="container">
              <span>
                {PRODUCT.name} v{PRODUCT.version} — every verdict on this page was computed by the
                deterministic Python engine. Apache-2.0.
              </span>
            </div>
          </footer>
        </div>
      </body>
    </html>
  )
}
