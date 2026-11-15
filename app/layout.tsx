import './globals.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Alice, Poppins } from 'next/font/google';
import { connection } from 'next/server';
import { Footer, Navbar } from '@/components/common';

const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-poppins-src',
  display: 'swap',
});

const alice = Alice({
  subsets: ['latin'],
  weight: ['400'],
  variable: '--font-alice-src',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Foodz',
  description: 'Korean, Thai and Vietnamese food, delivered hot.',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Every page renders per request so its scripts can carry the CSP nonce.
  await connection();

  return (
    <html lang="en" className={`${poppins.variable} ${alice.variable}`}>
      <body className="bg-neutral-8 font-poppins text-neutral-2 antialiased">
        <main className="w-full overflow-hidden">
          <header className="flexStart px-6 xs:px-12 sm:px-[4.5rem]">
            <nav className="w-full xl:max-w-[1440px]">
              <Navbar />
            </nav>
          </header>
          <section className="flexStart">
            <section className="z-0 w-full xl:max-w-[1440px]">
              {children}
              <Footer />
            </section>
          </section>
        </main>
      </body>
    </html>
  );
}
