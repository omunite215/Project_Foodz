import { Archive, type LucideIcon, ShoppingBag, Trash2, TriangleAlert } from 'lucide-react';
import type { Metadata } from 'next';
import { getActor, getSession } from '@/server/auth/session';
import { FRESH_SESSION_MS } from '@/server/modules/account/service';
import { BackLink } from '@/components/account/back-link';
import { DeleteAccountForm } from '@/components/account/delete-account-form';

export const metadata: Metadata = { title: 'Delete your account' };

const FACTS: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: Trash2,
    title: 'What we delete',
    text: 'Your name, email, phone, saved addresses, signed-in devices and two-factor settings.',
  },
  {
    icon: Archive,
    title: 'What we keep',
    text: 'Past orders, without your name or contact details, for our accounting records.',
  },
  { icon: ShoppingBag, title: 'On this device', text: 'Your cart is emptied.' },
];

/** What deleting means, in plain words, then the final button (S6.4, design 4.5). */
export default async function DeleteAccountPage() {
  const [actor, session] = await Promise.all([getActor(), getSession()]);
  if (actor.kind !== 'user' || !session) return null;
  // Decided per request on the server; the action checks again.
  const ageMs = Date.now() - new Date(session.session.createdAt).getTime();

  return (
    <>
      <BackLink href="/account/privacy">Back to privacy and data</BackLink>
      <h1
        tabIndex={-1}
        className="mt-6 font-heading text-h4 leading-tight text-neutral-2 focus:outline-none md:text-h3"
      >
        Delete your account
      </h1>
      <div className="mt-8 rounded-2xl border border-neutral-6 bg-white p-5 md:p-6">
        <ul className="space-y-5">
          {FACTS.map(({ icon: Icon, title, text }) => (
            <li key={title} className="flex gap-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-neutral-7">
                <Icon className="size-5 text-neutral-2" aria-hidden />
              </span>
              <div>
                <h2 className="text-body-3 font-semibold text-neutral-1">{title}</h2>
                <p className="text-body-4 text-neutral-3">{text}</p>
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-6 flex items-center gap-2 text-body-4 font-semibold text-neutral-1">
          <TriangleAlert className="size-5 text-destructive" aria-hidden />
          It can&apos;t be undone.
        </p>
      </div>
      <DeleteAccountForm needsConfirm={ageMs > FRESH_SESSION_MS} />
    </>
  );
}
