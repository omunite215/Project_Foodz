import { ArrowRight } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { PageContainer } from '@/components/layout/page-container';
import { Reveal } from './reveal';

/** Who cooks the food: the kitchen team, not a named chef. */
export function KitchenSection() {
  return (
    <section aria-labelledby="kitchen-title">
      <PageContainer className="py-10 md:py-20 xl:py-15">
        <Reveal>
          <h2
            id="kitchen-title"
            className="text-center font-heading text-h4 leading-tight text-neutral-2 md:text-h2"
          >
            Meet our kitchen
          </h2>
          <div className="mt-8 md:mt-20 md:grid md:grid-cols-[351fr_468fr] md:items-center md:gap-x-8 lg:gap-x-[61px] xl:grid-cols-[501fr_614fr] xl:gap-x-24 min-[90rem]:gap-x-[181px]">
            <div data-reveal="slide" className="hidden md:block">
              <Image
                src="/illustrations/cooking.svg"
                alt=""
                width={714}
                height={614}
                unoptimized
                className="h-auto w-full max-w-[351px] xl:max-w-[501px]"
              />
            </div>
            <div>
              <div className="lg:flex lg:items-center lg:justify-between lg:gap-6">
                <h3 className="font-heading text-title-3 text-brand-strong md:text-title-2 md:text-neutral-1">
                  Cooked to order in Boston
                </h3>
                <Link
                  href="/blog"
                  className="mt-6 hidden h-11 shrink-0 items-center gap-3 text-button-2 font-medium whitespace-nowrap text-brand-strong underline-offset-4 hover:underline lg:mt-0 lg:inline-flex"
                >
                  Read our kitchen blog
                  <ArrowRight className="size-[18px]" aria-hidden />
                </Link>
              </div>
              <p className="mt-3 text-body-5 text-neutral-3 md:text-body-4 xl:text-body-3">
                Our cooks make every dish when you order it, in our own kitchen. We make our kimchi
                and sauces ourselves, and we pack your food as soon as it leaves the pan.
              </p>
              <Link
                href="/blog"
                className="mt-6 inline-flex h-11 items-center gap-3 text-button-2 font-medium text-brand-strong underline-offset-4 hover:underline lg:hidden"
              >
                Read our kitchen blog
                <ArrowRight className="size-[18px]" aria-hidden />
              </Link>
            </div>
          </div>
        </Reveal>
      </PageContainer>
    </section>
  );
}
