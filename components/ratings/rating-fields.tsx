'use client';

import { Check, MessageSquarePlus, Star } from 'lucide-react';
import { type ReactNode, useRef, useState } from 'react';
import { RATING_RULES, type Stars } from '@/server/modules/ratings/schema';
import { Textarea } from '@/components/ui/textarea';
import { useMotion } from '@/lib/motion';
import {
  commentAbout,
  commentCounter,
  commentLabel,
  RATING_COPY,
  rateGroupName,
  type RatingSubject,
  STAR_VALUES,
  starsLabel,
  starWord,
  tagChoices,
  tagPrompt,
} from '@/lib/rating-text';
import { cn } from '@/lib/utils';

/*
 * The parts of a rating row on the order page (F9 design 2.4 to 2.6): five stars as native
 * radios with the star's word beside them, the tags that appear once a row has stars, and the
 * optional private comment. Customer side: the raw palette, light only, 44 px targets.
 */

// ------------------------------------------------------------------ stars (2.4)

/**
 * Five 44 px stars, one radio group named after the row ("Rate Gimbap"). Arrow keys move and
 * select; each radio is named "3 stars, OK". The filled star keeps a dark amber edge so its
 * state reads at 3:1, and the word says it too.
 */
export function StarInput({
  name,
  subject,
  value,
  onChange,
  describedBy,
}: {
  /** The radios' shared name: "rate-<menuItemId>" or "rate-courier". */
  name: string;
  subject: RatingSubject;
  value: Stars | null;
  onChange: (stars: Stars) => void;
  /** "rate-error" after an empty send (2.7). */
  describedBy?: string;
}) {
  const ref = useRef<HTMLFieldSetElement>(null);
  // Counts her own picks, so a star loaded from what she saved never bounces.
  const [pick, setPick] = useState({ count: 0, stars: value });
  useMotion(
    (motion) => {
      if (pick.count === 0 || !pick.stars || !ref.current) return;
      const star = ref.current.querySelector(`[data-star="${pick.stars}"]`);
      // S10.2: the picked star bounces once; under reduced motion the fill alone changes.
      motion.fromTo(
        star,
        { scale: 1 },
        { scale: 1.2, duration: 0.075, ease: 'power2.out', yoyo: true, repeat: 1 },
      );
    },
    { scope: ref, dependencies: [pick.count] },
  );

  return (
    <fieldset ref={ref} className="min-w-0" aria-describedby={describedBy}>
      <legend className="sr-only">{rateGroupName(subject)}</legend>
      <div className="flex gap-2 max-[359px]:gap-1">
        {STAR_VALUES.map((stars) => {
          const filled = value !== null && stars <= value;
          return (
            <label
              key={stars}
              className="relative flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg hover:bg-neutral-7 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring has-[:focus-visible]:outline-solid"
            >
              <input
                type="radio"
                name={name}
                value={stars}
                checked={value === stars}
                aria-label={starsLabel(stars)}
                onChange={() => {
                  setPick((current) => ({ count: current.count + 1, stars }));
                  onChange(stars);
                }}
                className="sr-only"
              />
              <Star
                data-star={stars}
                aria-hidden
                strokeWidth={1.75}
                className={cn(
                  'size-8 transition-colors duration-100',
                  filled ? 'fill-tag-6 text-warning-strong' : 'fill-transparent text-neutral-4',
                )}
              />
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** The star's word, kept the same width so nothing moves when it appears. */
export function StarWord({ stars, className }: { stars: Stars | null; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('min-w-[3.5rem] text-body-5 font-medium text-neutral-1', className)}
    >
      {stars ? starWord(stars) : ''}
    </span>
  );
}

// ------------------------------------------------------------------ tags (2.5)

export function TagToggles({
  id,
  kind,
  stars,
  pressed,
  onToggle,
  animateIn,
}: {
  id: string;
  kind: RatingSubject['kind'];
  stars: Stars;
  pressed: readonly string[];
  onToggle: (tag: string) => void;
  /** They rise in when her pick makes them appear; a reopened card shows them at once. */
  animateIn: boolean;
}) {
  const ref = useRef<HTMLFieldSetElement>(null);
  const labelId = `tags-${id}`;
  // Only when they appear: crossing the 3 | 4 line swaps the set in place, silently.
  useMotion(
    (motion) => {
      if (!animateIn || !ref.current) return;
      motion.from(ref.current, { y: 4, opacity: 0, duration: motion.reduced ? 0 : 0.2 });
    },
    { scope: ref },
  );
  return (
    <fieldset ref={ref} className="col-span-full mt-1 min-w-0">
      <legend id={labelId} className="text-body-5 font-medium text-neutral-2">
        {tagPrompt(stars)}
      </legend>
      <ul className="mt-2 flex flex-wrap gap-2">
        {tagChoices(kind, stars).map((choice) => {
          const on = pressed.includes(choice.tag);
          return (
            <li key={choice.tag}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => onToggle(choice.tag)}
                className={cn(
                  'inline-flex min-h-11 items-center gap-1.5 rounded-full text-left text-body-5 font-medium text-neutral-1',
                  on
                    ? 'border-2 border-brand-strong bg-brand-soft px-[15px]'
                    : 'border border-neutral-4 bg-white px-4 hover:bg-neutral-7',
                )}
              >
                {on ? <Check className="size-3.5 shrink-0 text-brand-strong" aria-hidden /> : null}
                {choice.label}
              </button>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

// ------------------------------------------------------------------ comment (2.6)

export function CommentField({
  id,
  subject,
  open,
  value,
  onOpen,
  onChange,
}: {
  id: string;
  subject: RatingSubject;
  open: boolean;
  value: string;
  onOpen: () => void;
  onChange: (text: string) => void;
}) {
  const fieldId = `comment-${id}`;
  const hintId = `${fieldId}-hint`;
  const counter = commentCounter(value.length);
  if (!open) {
    return (
      <button
        type="button"
        aria-expanded={false}
        aria-controls={fieldId}
        onClick={onOpen}
        className="col-span-full inline-flex min-h-11 items-center gap-1.5 self-start justify-self-start text-button-2 font-medium text-neutral-1 underline underline-offset-4"
      >
        <MessageSquarePlus className="size-4" aria-hidden />
        {RATING_COPY.addComment}
        <span className="sr-only"> {commentAbout(subject)}</span>
      </button>
    );
  }
  return (
    <div className="col-span-full">
      <label htmlFor={fieldId} className="text-body-5 font-medium text-neutral-2">
        {commentLabel(subject)}
      </label>
      <Textarea
        id={fieldId}
        rows={3}
        maxLength={RATING_RULES.commentMax}
        autoComplete="off"
        aria-describedby={hintId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 max-h-[calc(6lh+1.25rem)] min-h-[calc(3lh+1.25rem)] rounded-xl bg-white px-4 py-2.5 text-body-4 text-neutral-1 md:text-body-4"
      />
      <span id={hintId} className="sr-only">
        {RATING_COPY.commentHint}
      </span>
      {counter ? (
        <p aria-hidden className="mt-1 text-right text-caption text-neutral-3 tabular-nums">
          {counter}
        </p>
      ) : null}
    </div>
  );
}

/** A row's grid (2.4): media, name and word on the first line, the stars under them at base. */
export function RatingRowFrame({
  as: Tag = 'li',
  media,
  name,
  word,
  stars,
  children,
}: {
  as?: 'li' | 'div';
  media: ReactNode;
  name: ReactNode;
  word: ReactNode;
  stars: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Tag className="grid grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 py-4 first:pt-0 md:grid-cols-[3rem_minmax(0,1fr)_auto_4.5rem]">
      <span className="col-start-1 row-start-1">{media}</span>
      <span className="col-start-2 row-start-1 text-body-4 font-medium text-neutral-1 [overflow-wrap:anywhere]">
        {name}
      </span>
      <span className="col-start-3 row-start-1 text-right md:col-start-4 md:text-left">{word}</span>
      <div className="col-span-3 row-start-2 md:col-span-1 md:col-start-3 md:row-start-1">
        {stars}
      </div>
      {children}
    </Tag>
  );
}
