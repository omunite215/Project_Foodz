'use client';

import { Download, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useState } from 'react';
import { exportMyDataAction } from '@/server/modules/account/actions';
import { FormAlert } from '@/components/forms/form-alert';
import { StatusLine } from '@/components/forms/status-line';
import { SubmitButton } from '@/components/forms/submit-button';
import { Button } from '@/components/ui/button';
import { callAction } from '@/lib/action-result';
import { clockTimeAfter } from '@/lib/account-text';
import { announce } from '@/lib/announce';
import { useAccount } from './account-context';
import { LockedLine, SettingsCard } from './settings-card';

const PREPARE_FAILED = "We couldn't prepare your file. Try again in a minute.";

/** Saves a file in the browser: iPhone Safari opens or saves it to Files; Android Chrome to Downloads. */
function saveFile(fileName: string, data: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Download my data (S6.1 to S6.3). Five downloads an hour; the limit names the time it lifts. */
export function DownloadDataCard() {
  const alertId = useId();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ text: string; until: number | null } | null>(null);
  const blocked = problem?.until !== null && problem?.until !== undefined;

  useEffect(() => {
    if (!problem?.until) return undefined;
    const timer = setTimeout(() => setProblem(null), Math.max(0, problem.until - Date.now()));
    return () => clearTimeout(timer);
  }, [problem]);

  return (
    <SettingsCard
      id="download"
      title="Download your data"
      description={
        <span className="text-body-4 text-neutral-3">
          A copy of what Foodz holds about you: your profile, addresses and signed-in devices.
          It&apos;s a JSON file you can open in any text editor.
        </span>
      }
    >
      {problem ? (
        <FormAlert id={alertId} variant="error" className="mb-4">
          {problem.text}
        </FormAlert>
      ) : null}
      <SubmitButton
        type="button"
        variant="outline"
        pending={busy}
        pendingLabel="Preparing…"
        blocked={blocked}
        aria-describedby={blocked ? alertId : undefined}
        className="border-brand-strong bg-white text-brand-strong hover:bg-brand-soft hover:text-brand-strong"
        onClick={() => {
          void (async () => {
            setBusy(true);
            setDone(null);
            setProblem(null);
            const outcome = await callAction(() => exportMyDataAction());
            setBusy(false);
            if (outcome.ok) {
              saveFile(outcome.data.fileName, outcome.data.data);
              const text = `Downloaded ${outcome.data.fileName}`;
              setDone(text);
              announce(text);
              return;
            }
            const error = outcome.error;
            const next =
              error.code === 'RATE_LIMITED' && error.retryAfterSeconds
                ? {
                    text: `You can download your data again at ${clockTimeAfter(error.retryAfterSeconds)}.`,
                    until: Date.now() + error.retryAfterSeconds * 1000,
                  }
                : {
                    text:
                      error.code === 'OFFLINE' || error.code === 'TIMEOUT'
                        ? error.message
                        : PREPARE_FAILED,
                    until: null,
                  };
            setProblem(next);
            announce(next.text);
          })();
        }}
      >
        <Download className="size-4" aria-hidden />
        Download my data
      </SubmitButton>
      <StatusLine tone={done ? 'success' : null}>{done}</StatusLine>
    </SettingsCard>
  );
}

/** Words for an account that can't delete itself here (S5.13, staff note). */
export function deleteBlockedText(reason: 'demo' | 'staff') {
  return reason === 'demo'
    ? "The demo account can't be deleted. Create your own account to try this."
    : 'Staff accounts are removed by an admin.';
}

/** The way to the delete page (S6.4). */
export function DeleteAccountCard() {
  const account = useAccount();
  const blocked = account.deleteBlockedReason ?? (account.canDelete ? null : 'staff');
  return (
    <SettingsCard
      id="delete"
      title="Delete your account"
      description="Permanently delete your account and personal details."
    >
      {blocked ? (
        <LockedLine>{deleteBlockedText(blocked)}</LockedLine>
      ) : (
        <Button
          asChild
          variant="outline"
          size="touch"
          className="border-destructive bg-white text-destructive hover:bg-neutral-7 hover:text-destructive"
        >
          <Link href="/account/privacy/delete">
            <Trash2 className="size-4" aria-hidden />
            Delete my account
          </Link>
        </Button>
      )}
    </SettingsCard>
  );
}
