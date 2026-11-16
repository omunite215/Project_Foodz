import { Bike, CookingPot, ReceiptText } from 'lucide-react';
import { PageContainer } from '@/components/layout/page-container';
import { cn } from '@/lib/utils';
import { Reveal } from './reveal';

const STEPS = [
  {
    icon: ReceiptText,
    title: 'We get your order',
    text: 'Your order reaches the kitchen the moment you place it.',
  },
  {
    icon: CookingPot,
    title: 'We cook it fresh',
    text: 'Each dish is made to order, never reheated.',
  },
  {
    icon: Bike,
    title: 'We bring it to you',
    text: 'A courier brings it to your door in about 45 minutes.',
  },
] as const;

export function HowWeWork() {
  return (
    <section aria-labelledby="how-title">
      <PageContainer className="py-10 md:py-20 xl:py-15">
        <Reveal>
          <h2
            id="how-title"
            className="mx-auto max-w-[441px] text-center font-heading text-h4 leading-tight text-balance text-neutral-2 md:text-h2"
          >
            How we keep your meal delicious
          </h2>
          <ol className="mt-10 flex flex-col gap-8 md:mt-27 md:grid md:grid-cols-3 md:gap-6 xl:items-center xl:gap-x-[77px] xl:px-14">
            {STEPS.map(({ icon: Icon, title, text }, index) => (
              <li
                key={title}
                data-reveal="item"
                className={cn(
                  'flex flex-col items-center gap-6 rounded-xl bg-white px-6 py-7 text-center shadow-raised',
                  index === 1 ? 'xl:px-9 xl:py-10' : 'xl:bg-transparent xl:shadow-none',
                )}
              >
                <span
                  data-reveal="pop"
                  aria-hidden
                  className="flex size-20 items-center justify-center rounded-full bg-white shadow-raised xl:size-30"
                >
                  <Icon className="size-12 text-neutral-3" />
                </span>
                <h3 className="font-heading text-body-2 leading-tight text-neutral-2 xl:text-title-1">
                  {title}
                </h3>
                <p className="text-body-5 text-neutral-3 xl:text-body-4">{text}</p>
              </li>
            ))}
          </ol>
        </Reveal>
      </PageContainer>
    </section>
  );
}
