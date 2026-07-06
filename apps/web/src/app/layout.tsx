import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './providers';
import { Nav } from '@/components/nav';

export const metadata: Metadata = {
  title: 'Football IQ Challenge',
  description: 'Prove your football IQ. Predict, compete, win.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-zinc-50 text-zinc-900 antialiased dark:bg-zinc-950 dark:text-zinc-100">
        <Providers>
          <Nav />
          <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
