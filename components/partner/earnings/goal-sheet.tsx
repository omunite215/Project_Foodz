'use client';

import { revalidateLogic, useForm, useStore } from '@tanstack/react-form';
import { Info, WifiOff } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { z } from 'zod';
import { FormAlert } from '@/components/forms/form-alert';
import { Button } from '@/components/ui/button';
import { announce } from '@/lib/announce';
import {
  GOAL_CHOICES,
  GOAL_ERROR,
  type GoalChoice,
  goalChoiceOf,
  goalFromChoice,
  parseGoalDollars,
  wholeDollars,
} from '@/lib/partner/earnings-text';
import { useOnline } from '@/lib/use-online';
import { cn } from '@/lib/utils';
import { DockButton, PartnerNotice } from '../shell';
import { PartnerSheet } from './partner-sheet';

/*
 * "Your daily goal" (F9 design 1.5, P53): four amounts, Custom whole dollars from $10 to $1,000,
 * or no goal. Foodz never suggests one: a partner without a goal opens the sheet with nothing
 * checked (U7). The demo partner's goal lasts for this browser session only.
 */

const CHOICES: { value: GoalChoice; label: string }[] = [
  ...GOAL_CHOICES.map((cents) => ({ value: cents, label: wholeDollars(cents) })),
  { value: 'custom', label: 'Custom' },
  { value: 'none', label: 'No goal' },
];

const fields = z.object({ choice: z.string(), custom: z.string() }).superRefine((value, ctx) => {
  if (value.choice === 'custom' && parseGoalDollars(value.custom) === null) {
    ctx.addIssue({ code: 'custom', path: ['custom'], message: GOAL_ERROR });
  }
});

const choiceKey = (choice: GoalChoice | null) => (choice === null ? '' : String(choice));
function choiceFrom(key: string): GoalChoice | null {
  if (key === 'custom' || key === 'none') return key;
  return GOAL_CHOICES.find((cents) => String(cents) === key) ?? null;
}

export type SaveGoal = (cents: number | null) => Promise<'saved' | 'failed' | 'offline'>;

export function GoalSheet({
  open,
  onOpenChange,
  goalCents,
  practice,
  onSave,
  returnFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  goalCents: number | null;
  practice: boolean;
  onSave: SaveGoal;
  returnFocus: () => void;
}) {
  return (
    <PartnerSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Your daily goal"
      returnFocus={returnFocus}
    >
      {open ? (
        <GoalForm
          goalCents={goalCents}
          practice={practice}
          onSave={onSave}
          onDone={() => onOpenChange(false)}
        />
      ) : null}
    </PartnerSheet>
  );
}

function GoalForm({
  goalCents,
  practice,
  onSave,
  onDone,
}: {
  goalCents: number | null;
  practice: boolean;
  onSave: SaveGoal;
  onDone: () => void;
}) {
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const customRef = useRef<HTMLInputElement>(null);
  const online = useOnline();
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const start = goalChoiceOf(goalCents);

  const form = useForm({
    defaultValues: {
      choice: choiceKey(start),
      custom: start === 'custom' && goalCents !== null ? String(goalCents / 100) : '',
    },
    validationLogic: revalidateLogic({ mode: 'blur', modeAfterSubmission: 'change' }),
    validators: { onDynamic: fields },
    onSubmitInvalid: () => customRef.current?.focus(),
    onSubmit: async ({ value }) => {
      const choice = choiceFrom(value.choice);
      // Nothing picked (no goal before, none now): nothing to save.
      if (!choice) {
        onDone();
        return;
      }
      const cents = goalFromChoice(choice, value.custom);
      if (cents === undefined) return;
      setSaving(true);
      setFailed(false);
      const outcome = await onSave(cents);
      setSaving(false);
      if (outcome === 'saved') {
        onDone();
        return;
      }
      if (outcome === 'failed') {
        setFailed(true);
        announce("Couldn't save your goal. Try again.");
      } else announce("You're offline.");
    },
  });
  const choice = useStore(form.store, (state) => state.values.choice);
  const blockedReason = online ? null : "You're offline.";

  return (
    <form
      ref={formRef}
      noValidate
      inert={saving ? true : undefined}
      onSubmit={(event) => {
        event.preventDefault();
        if (!online || saving) return;
        void form.handleSubmit();
      }}
    >
      <p className="mt-2 text-body-4 text-foreground">
        Pick an amount to aim for each day. You can change it any time.
      </p>
      {failed ? (
        <FormAlert variant="error" tone="partner" className="mt-4">
          Couldn&apos;t save your goal. Try again.
        </FormAlert>
      ) : null}
      <form.Field name="choice">
        {(field) => (
          <fieldset className="mt-5 min-w-0">
            <legend className="sr-only">Daily goal</legend>
            <div className="grid grid-cols-3 gap-2">
              {CHOICES.map((option) => (
                <label
                  key={String(option.value)}
                  className="relative flex h-12 cursor-pointer items-center justify-center rounded-lg border border-input bg-card px-2 text-body-4 text-strong tabular-nums has-[:checked]:border-2 has-[:checked]:border-primary has-[:checked]:bg-success-soft has-[:checked]:font-semibold has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring has-[:focus-visible]:outline-solid"
                >
                  <input
                    type="radio"
                    name={field.name}
                    value={String(option.value)}
                    checked={field.state.value === String(option.value)}
                    onChange={() => {
                      field.handleChange(String(option.value));
                      if (option.value === 'custom')
                        requestAnimationFrame(() => customRef.current?.focus());
                    }}
                    className="sr-only"
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </fieldset>
        )}
      </form.Field>
      {choice === 'custom' ? (
        <form.Field name="custom">
          {(field) => {
            const error = field.state.meta.errors.length ? GOAL_ERROR : null;
            return (
              <div className="mt-4">
                <label htmlFor={`${id}-custom`} className="text-body-5 font-medium text-strong">
                  Goal in dollars
                </label>
                <div className="relative mt-2">
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-body-3 text-muted-foreground"
                  >
                    $
                  </span>
                  <input
                    ref={customRef}
                    id={`${id}-custom`}
                    name={field.name}
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                    onBlur={field.handleBlur}
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={5}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? `${id}-error ${id}-hint` : `${id}-hint`}
                    className={cn(
                      'h-12 w-full rounded-lg border bg-card pr-3 pl-8 text-body-3 text-strong tabular-nums outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid',
                      error ? 'border-2 border-destructive' : 'border-input',
                    )}
                  />
                </div>
                <p id={`${id}-hint`} className="mt-1.5 text-body-5 text-muted-foreground">
                  Whole dollars, from $10 to $1,000.
                </p>
                {error ? (
                  <p id={`${id}-error`} className="mt-1 text-body-5 font-medium text-danger-mark">
                    {error}
                  </p>
                ) : null}
              </div>
            );
          }}
        </form.Field>
      ) : null}
      {practice ? (
        <div className="mt-4">
          <PartnerNotice tone="muted" icon={Info}>
            Goals aren&apos;t saved in the demo.
          </PartnerNotice>
        </div>
      ) : null}
      <div className="mt-6">
        {blockedReason ? (
          <p
            id={`${id}-offline`}
            className="mb-2 flex items-start gap-2 text-body-5 text-foreground"
          >
            <WifiOff className="mt-0.5 size-4 shrink-0" aria-hidden />
            {blockedReason}
          </p>
        ) : null}
        <DockButton
          type="submit"
          pending={saving}
          pendingLabel="Saving…"
          blocked={!online}
          blockedReason={blockedReason}
          reasonId={blockedReason ? `${id}-offline` : undefined}
        >
          Save
        </DockButton>
        <Button
          type="button"
          variant="ghost"
          size="kitchen"
          className="mt-2 w-full text-strong"
          onClick={onDone}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
