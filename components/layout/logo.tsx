import Image from 'next/image';
import Link from 'next/link';
import { cn } from '@/lib/utils';

/** The Foodz wordmark, linking home. The link is at least 44 px tall whatever the logo size. */
export function LogoLink({ imageClassName }: { imageClassName?: string }) {
  return (
    <Link href="/" aria-label="Foodz home" className="inline-flex min-h-11 shrink-0 items-center">
      <Image
        src="/Logo/logo.svg"
        alt=""
        width={140}
        height={40}
        unoptimized
        className={cn('w-auto', imageClassName)}
      />
    </Link>
  );
}
