import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'AlexD - Township Marketplace',
  description: 'Everything you need. Right in your community.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
