import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getLegalPage } from '@/server/modules/content/service';
import { ApplyForm } from '@/components/partner/apply/apply-form';
import { ApplyGate } from '@/components/partner/apply-gate';
import { STORE_TIME_ZONE } from '@/lib/order-text';
import { displayPhone } from '@/lib/phone';
import { phoneCountries } from '@/lib/phone-countries';
import { firstParam } from '@/lib/search-params';
import { loadSignedIn, readOrNull } from '@/lib/storefront-data';
import { loadPartnerState, partnerTitle, requirePartnerState } from '../state';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const accountPhone = (application: { phone: { e164: string; display: string } | null }) =>
  application.phone
    ? { ...application.phone, country: displayPhone(application.phone.e164).country }
    : null;

export async function generateMetadata(): Promise<Metadata> {
  const loaded = await loadPartnerState();
  const state = loaded?.state;
  if (state?.screen === 'gate' && state.gate === 'emailNotConfirmed') {
    return { title: partnerTitle('Confirm your email') };
  }
  return { title: partnerTitle('Apply to deliver') };
}

/**
 * `/partner/apply` (F6 design 3, 4): the gates, the form for a new application or a
 * reapplication from the reapply date, and the edit and fix modes of a waiting application.
 * Anyone else is sent to `/partner`, which shows their state (P1.7).
 */
export default async function ApplyPage({ searchParams }: { searchParams: SearchParams }) {
  const { state, userId } = await requirePartnerState('/partner/apply');
  const params = await searchParams;
  const mode = firstParam(params.mode);
  const withdrawn = firstParam(params.done) === 'withdrawn';

  if (state.screen === 'gate') return <ApplyGate state={state} />;

  const [terms, session] = await Promise.all([
    readOrNull('partner terms', () => getLegalPage('partner-terms')),
    loadSignedIn(),
  ]);
  const common = {
    userId,
    terms,
    countries: phoneCountries(),
    timeZone: STORE_TIME_ZONE,
  };

  if (state.screen === 'apply') {
    return (
      <ApplyForm
        {...common}
        mode={state.mode}
        name={state.name}
        accountPhone={state.phone}
        termsVersion={state.termsVersion}
        withdrawn={withdrawn}
      />
    );
  }

  if (state.screen === 'rejected' && state.canReapply) {
    // P7.6: an empty form; only the phone comes back from the account.
    const phone = session?.user.phone ?? null;
    const shown = phone ? displayPhone(phone) : null;
    return (
      <ApplyForm
        {...common}
        mode="reapply"
        name={session?.user.name ?? ''}
        accountPhone={
          shown ? { e164: phone ?? '', display: shown.display, country: shown.country } : null
        }
        termsVersion={terms?.version ?? 1}
      />
    );
  }

  if (state.screen === 'pending' && mode === 'edit') {
    return (
      <ApplyForm
        {...common}
        mode="edit"
        name={session?.user.name ?? ''}
        accountPhone={accountPhone(state.application)}
        termsVersion={state.application.terms.version}
        application={state.application}
      />
    );
  }

  if (state.screen === 'sentBack' && (mode === 'fix' || mode === 'edit')) {
    return (
      <ApplyForm
        {...common}
        mode="fix"
        name={session?.user.name ?? ''}
        accountPhone={accountPhone(state.application)}
        termsVersion={state.application.terms.version}
        application={state.application}
        sentBackMessage={state.sentBack.message}
      />
    );
  }

  return redirect('/partner');
}
