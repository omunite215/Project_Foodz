import {
  Bike,
  CakeSlice,
  Camera,
  IdCard,
  Lock,
  type LucideIcon,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { PageContainer } from '@/components/layout/page-container';
import { Button } from '@/components/ui/button';
import { authPageHref } from '@/lib/auth-links';
import { cn } from '@/lib/utils';
import { Doodle } from './doodle';

/*
 * The partner landing (F6 design 1.2, 1.3) in the storefront's frame and tokens: what it takes,
 * how it works, the privacy promise and one call to action that fits the visitor.
 */

export type DeliverVisitor =
  | 'guest'
  | 'unconfirmed'
  | 'customer'
  | 'applicant'
  | 'partner'
  | 'staff'
  | 'demoCustomer';

const NEEDS: { icon: LucideIcon; text: string }[] = [
  { icon: CakeSlice, text: '18 or older' },
  { icon: Bike, text: 'A bicycle, scooter, motorbike or car' },
  { icon: IdCard, text: "For a scooter, motorbike or car: a valid driver's license and a plate" },
  { icon: Smartphone, text: 'A phone with GPS and mobile data' },
  { icon: Camera, text: 'A clear photo of your face' },
];

const STEPS = [
  'Apply in about 5 minutes',
  'We check your documents, usually within 2 working days',
  'Go online and deliver',
];

type Cta = { label: string; href: Route; outline?: boolean; line?: string } | { locked: string };

const CTA: Record<DeliverVisitor, Cta> = {
  guest: {
    label: 'Apply now',
    href: authPageHref('/sign-in', '/partner/apply'),
    line: "You'll sign in or create a Foodz account first.",
  },
  unconfirmed: { label: 'Apply now', href: '/partner/apply' },
  customer: {
    label: 'Start your application',
    href: '/partner/apply',
    line: 'It takes about 5 minutes.',
  },
  applicant: { label: 'See your application', href: '/partner', outline: true },
  partner: { label: 'Open the partner app', href: '/partner' },
  staff: {
    locked: "Staff accounts can't apply to deliver. Apply with a personal account instead.",
  },
  demoCustomer: {
    locked: "The demo account can't apply. Sign in as the demo partner to see the partner app.",
  },
};

function CallToAction({
  visitor,
  centred = false,
}: {
  visitor: DeliverVisitor;
  centred?: boolean;
}) {
  const cta = CTA[visitor];
  if ('locked' in cta) {
    return (
      <p className={cn('flex gap-2 text-body-4 text-neutral-3', centred && 'justify-center')}>
        <Lock className="mt-1 size-4 shrink-0" aria-hidden />
        {cta.locked}
      </p>
    );
  }
  return (
    <div className={cn(centred && 'flex flex-col items-center')}>
      <Button
        asChild
        size="touch"
        variant={cta.outline ? 'outline' : 'default'}
        className="w-full uppercase md:w-auto md:min-w-56"
      >
        <Link href={cta.href}>{cta.label}</Link>
      </Button>
      {cta.line ? <p className="mt-3 text-body-5 text-neutral-3">{cta.line}</p> : null}
    </div>
  );
}

export function DeliverLanding({ visitor }: { visitor: DeliverVisitor }) {
  return (
    <PageContainer>
      <section className="grid gap-8 pt-8 md:grid-cols-12 md:items-center md:pt-16 xl:pt-20">
        <div className="md:order-2 md:col-span-5">
          <Doodle name="sprinting" className="w-[200px] md:w-[320px] xl:w-[400px]" />
        </div>
        <div className="md:col-span-7">
          <h1 className="font-heading text-h4 text-neutral-2 md:text-h2 xl:text-h1">
            Deliver with Foodz
          </h1>
          <p className="mt-4 max-w-[36rem] text-body-4 text-neutral-3 md:text-body-2">
            Go online when it suits you, from our kitchen at 88 Harbor Street, Boston.
          </p>
          <div className="mt-8">
            <CallToAction visitor={visitor} />
          </div>
        </div>
      </section>

      <section aria-labelledby="deliver-needs" className="mt-16 md:mt-24">
        <h2 id="deliver-needs" className="font-heading text-h4 text-neutral-2 md:text-h3">
          What you need
        </h2>
        <ul className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {NEEDS.map((need) => {
            const Icon = need.icon;
            return (
              <li
                key={need.text}
                className="flex gap-4 rounded-2xl border border-neutral-6 bg-white p-5 xl:flex-col"
              >
                <span
                  aria-hidden
                  className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-brand-soft"
                >
                  <Icon className="size-6 text-brand-strong" />
                </span>
                <span className="text-body-4 text-neutral-2">{need.text}</span>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="deliver-how" className="mt-16 md:mt-24">
        <h2 id="deliver-how" className="font-heading text-h4 text-neutral-2 md:text-h3">
          How it works
        </h2>
        <ol className="mt-6 grid gap-6 md:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step} className="flex items-start gap-4">
              <span
                aria-hidden
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-neutral-2 text-body-4 font-semibold text-white"
              >
                {index + 1}
              </span>
              <span className="text-body-3 font-medium text-neutral-1">{step}</span>
            </li>
          ))}
        </ol>
      </section>

      <p className="mt-12 flex items-start gap-3 rounded-2xl bg-brand-soft p-5 text-body-4 text-neutral-1">
        <ShieldCheck className="size-6 shrink-0 text-brand-strong" aria-hidden />
        We only see your location while you&apos;re online.
      </p>

      <div className="mt-12 mb-16 text-center md:mb-24">
        <CallToAction visitor={visitor} centred />
      </div>
    </PageContainer>
  );
}
