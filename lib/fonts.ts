import { Alice, Poppins } from 'next/font/google';
import { cn } from '@/lib/utils';

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

/** Goes on <html>: the theme in globals.css reads these variables at the root. */
export const fontVariables = cn(poppins.variable, alice.variable);
