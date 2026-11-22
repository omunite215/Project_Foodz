'use client';

import Image from 'next/image';
import { useState } from 'react';
import { ForgotPasswordForm } from './forgot-password-form';
import { ResetPasswordForm } from './reset-password-form';

/**
 * "This link no longer works", with the form for a new link in place and its email field
 * focused (S3.10, design 3.6). Never "invalid", never an error trace.
 */
export function DeadResetLink({ callbackUrl }: { callbackUrl: string }) {
  return (
    <ForgotPasswordForm callbackUrl={callbackUrl} submitLabel="Send a new link" focusEmail>
      <div className="text-center">
        <Image
          src="/illustrations/warning.svg"
          alt=""
          width={200}
          height={207}
          unoptimized
          className="mx-auto h-auto w-40 md:w-50"
        />
        <h1 tabIndex={-1} className="mt-6 font-heading text-h4 text-neutral-2 md:text-h3">
          This link no longer works
        </h1>
        <p className="mt-3 text-body-4 text-neutral-3">
          This link has expired or has already been used. We can send you a new one.
        </p>
      </div>
    </ForgotPasswordForm>
  );
}

/** The new-password form, which gives way to the dead-link state if the link is used up meanwhile. */
export function ResetPasswordPage({ token, callbackUrl }: { token: string; callbackUrl: string }) {
  const [dead, setDead] = useState(false);
  return dead ? (
    <DeadResetLink callbackUrl={callbackUrl} />
  ) : (
    <ResetPasswordForm token={token} callbackUrl={callbackUrl} onLinkDead={() => setDead(true)} />
  );
}
