import type { Route } from 'next';
import {
  isStars,
  type OrderRatingView,
  RATING_RULES,
  type RateOrderInput,
  STAR_WORDS,
  type Stars,
  TAG_WORDS,
  tagsFor,
} from '@/server/modules/ratings/schema';
import { isSitePath } from '@/lib/navigation';
import { orderHref } from '@/lib/order-text';

/*
 * F9's rating words for the order page, the Orders list and staff screens (design 2, 3.10,
 * 3.16), and the card's draft rules: pure functions, so the server render, the browser and the
 * tests read the same text and build the same request.
 */

export const STAR_VALUES = [1, 2, 3, 4, 5] as const;

/** "1 star" / "3 stars". */
export const starsCount = (stars: number) => `${stars} ${stars === 1 ? 'star' : 'stars'}`;

/** "1 star, Bad" … "5 stars, Great": a star radio's name and a summary's spoken text. */
export function starsLabel(stars: number): string {
  return isStars(stars) ? `${starsCount(stars)}, ${STAR_WORDS[stars]}` : starsCount(stars);
}

/** The word beside the stars: "Bad" … "Great". */
export const starWord = (stars: Stars) => STAR_WORDS[stars];

/** What a row rates: a dish by its title, or the courier by first name. */
export type RatingSubject =
  | { kind: 'dish'; title: string }
  | { kind: 'courier'; firstName: string };

/** "Gimbap × 2" (each dish once, with its quantity); "Pad Thai". */
export const dishName = (title: string, quantity: number) =>
  quantity > 1 ? `${title} × ${quantity}` : title;

const delivery = (firstName: string) => `${firstName}'s delivery`;

/** "How was order 1042?" */
export const cardHeading = (orderNumber: string) => `How was order ${orderNumber}?`;

/** "How was Luis's delivery?" */
export const courierHeading = (firstName: string) => `How was ${delivery(firstName)}?`;

/** The radio group's name: "Rate Gimbap" / "Rate Luis's delivery". */
export const rateGroupName = (subject: RatingSubject) =>
  `Rate ${subject.kind === 'dish' ? subject.title : delivery(subject.firstName)}`;

/** "about Pad Thai" / "about Luis's delivery": the rest of "Add a comment"'s name. */
export const commentAbout = (subject: RatingSubject) =>
  `about ${subject.kind === 'dish' ? subject.title : delivery(subject.firstName)}`;

/** "Comment about Pad Thai (optional)". */
export const commentLabel = (subject: RatingSubject) =>
  `Comment ${commentAbout(subject)} (optional)`;

/** 4–5 stars ask what was good; 1–3 what could be better (S2.1). */
export const tagPrompt = (stars: Stars) =>
  stars >= 4 ? 'What was good?' : 'What could be better?';

/** The tags offered for a row at these stars, with their words, in the design's order. */
export function tagChoices(
  kind: RatingSubject['kind'],
  stars: Stars,
): { tag: string; label: string }[] {
  return tagsFor(kind, stars).map((tag) => ({
    tag,
    label: (TAG_WORDS as Record<string, string>)[tag] ?? tag,
  }));
}

/**
 * The presses that survive a change of stars: crossing the 3 | 4 line swaps the set and clears
 * the other set's presses (design 2.5), in the set's own order.
 */
export function keepTags(
  kind: RatingSubject['kind'],
  stars: Stars,
  pressed: readonly string[],
): string[] {
  return tagsFor(kind, stars).filter((tag) => pressed.includes(tag));
}

/** The words of saved tags, for the summary and staff screens. */
export const tagWords = (tags: readonly string[]) =>
  tags.map((tag) => (TAG_WORDS as Record<string, string>)[tag] ?? tag);

/** The counter shows from 400 characters: "412/500" (design 2.6). */
export const COMMENT_COUNTER_FROM = 400;
export function commentCounter(length: number): string | null {
  return length >= COMMENT_COUNTER_FROM ? `${length}/${RATING_RULES.commentMax}` : null;
}

export const RATING_COPY = {
  whoReads:
    "Your stars count toward each dish's rating on the menu. Comments go to the Foodz team and aren't published.",
  nothingPicked: 'Pick at least one star rating first.',
  send: 'Send ratings',
  sending: 'Sending…',
  skip: 'Skip',
  saveChanges: 'Save changes',
  saving: 'Saving…',
  cancel: 'Cancel',
  addComment: 'Add a comment',
  commentHint: 'Up to 500 characters.',
  demoComments: 'Comments are turned off in the demo.',
  yourRatings: 'Your ratings',
  notRated: 'Not rated',
  editRatings: 'Edit ratings',
  rateThisOrder: 'Rate this order',
  skipped: "Skipped. We won't remind you about this order.",
  changesSaved: 'Changes saved.',
  offline: "You're offline.",
  connection: "Couldn't send your ratings. Check your connection and try again.",
  generic: "Couldn't send your ratings. Try again.",
  rate: 'Rate',
  rated: 'Rated',
} as const;

/** "Luis sees only their average…": what the courier can and can't see (S2.3). */
export const courierPrivacy = (firstName: string) =>
  `${firstName} sees only their average and the tags customers pick, never your name or your comment.`;

/** "Thanks, Priya. Every rating helps the kitchen and Luis." (S1.4) */
export function thanksLine(customerFirst: string | null, courierFirst: string | null): string {
  const thanks = customerFirst ? `Thanks, ${customerFirst}.` : 'Thanks.';
  const who = courierFirst ? `the kitchen and ${courierFirst}` : 'the kitchen';
  return `${thanks} Every rating helps ${who}.`;
}

/** "You can change these until Fri, Nov 27." */
export const editUntilLine = (closesOnWords: string) =>
  `You can change these until ${closesOnWords}.`;

/** "Ratings for this order closed on Nov 27." */
export const closedLine = (closedOnWords: string | null) =>
  `Ratings for this order closed on ${closedOnWords ?? 'its last day'}.`;

/** The summary list's name: "Your ratings for order 1042". */
export const summaryListName = (orderNumber: string) => `Your ratings for order ${orderNumber}`;

/** "Rate order 1042": the Orders list's and the reminder's "Rate". */
export const rateOrderName = (orderNumber: string) => `Rate order ${orderNumber}`;

/** `/orders/<id>#rate`: the reminder's and the Orders list's link to the card. */
export function rateHref(orderId: string): Route {
  const href = `${orderHref(orderId)}#rate`;
  return isSitePath(href) ? href : orderHref(orderId);
}

// ------------------------------------------------------------------ the card's draft

export interface RowDraft {
  stars: Stars | null;
  tags: string[];
  /** The comment as typed; "" for none. */
  comment: string;
  /** "Add a comment" was pressed, or a saved comment opens with its field showing. */
  commentOpen: boolean;
}

export interface RatingDraft {
  dishes: Record<string, RowDraft>;
  courier: RowDraft | null;
}

const rowFrom = (row: {
  stars: Stars | null;
  tags: readonly string[];
  comment: string | null;
}) => ({
  stars: row.stars,
  tags: [...row.tags],
  comment: row.comment ?? '',
  commentOpen: Boolean(row.comment),
});

/** The card opened on what she saved (or nothing yet). */
export function draftFrom(view: OrderRatingView): RatingDraft {
  return {
    dishes: Object.fromEntries(view.dishes.map((dish) => [dish.menuItemId, rowFrom(dish)])),
    courier: view.courier ? rowFrom(view.courier) : null,
  };
}

const commentOf = (row: RowDraft, demo: boolean) => {
  if (demo) return undefined;
  const text = row.comment.trim();
  return text === '' ? null : row.comment;
};

/**
 * The request for "Send ratings" / "Save changes": every row with stars, its tags kept to its
 * band, its comment (none in the demo; an emptied one clears it). Null when nothing is picked.
 */
export function ratingRequest(
  orderId: string,
  view: OrderRatingView,
  draft: RatingDraft,
): RateOrderInput | null {
  const dishes = view.dishes.flatMap((dish) => {
    const row = draft.dishes[dish.menuItemId];
    if (!row?.stars) return [];
    const comment = commentOf(row, view.demo);
    return [
      {
        menuItemId: dish.menuItemId,
        stars: row.stars,
        tags: keepTags('dish', row.stars, row.tags),
        ...(comment !== undefined && { comment }),
      },
    ];
  });
  const courierRow = view.courier ? draft.courier : null;
  let courier: RateOrderInput['courier'];
  if (courierRow?.stars) {
    const comment = commentOf(courierRow, view.demo);
    courier = {
      stars: courierRow.stars,
      tags: keepTags('courier', courierRow.stars, courierRow.tags),
      ...(comment !== undefined && { comment }),
    };
  }
  if (dishes.length === 0 && !courier) return null;
  return { orderId, dishes, ...(courier && { courier }) };
}

function sameRow(
  kind: RatingSubject['kind'],
  saved: { stars: Stars | null; tags: readonly string[]; comment: string | null },
  row: RowDraft | null | undefined,
): boolean {
  // A row left without stars sends nothing, so it never counts as a change.
  if (!row?.stars) return true;
  const tags = keepTags(kind, row.stars, row.tags);
  return (
    row.stars === saved.stars &&
    tags.length === saved.tags.length &&
    tags.every((tag) => saved.tags.includes(tag)) &&
    row.comment.trim() === (saved.comment ?? '').trim()
  );
}

/** False when "Save changes" would send nothing new: it then closes without a request. */
export function draftChanged(view: OrderRatingView, draft: RatingDraft): boolean {
  const dishes = view.dishes.some((dish) => !sameRow('dish', dish, draft.dishes[dish.menuItemId]));
  const courier = view.courier ? !sameRow('courier', view.courier, draft.courier) : false;
  return dishes || courier;
}

/** What a refused send shows (design 2.7). */
export type SendRefusal =
  | { kind: 'closed'; words: string }
  | { kind: 'error'; words: string; assertive: true };

export function sendRefusal(
  failure: { code: string; message: string; details?: Record<string, unknown> },
  /** The card's own "Nov 27", for a refusal that doesn't carry the day. */
  closedOnWords: string | null = null,
): SendRefusal {
  switch (failure.code) {
    case 'OFFLINE':
    case 'TIMEOUT':
      return { kind: 'error', words: RATING_COPY.connection, assertive: true };
    case 'RATE_LIMITED':
      return { kind: 'error', words: failure.message, assertive: true };
    case 'RATING_NOT_OPEN':
      if (failure.details?.why === 'closed') {
        const on = failure.details.closedOnWords;
        return { kind: 'closed', words: closedLine(typeof on === 'string' ? on : closedOnWords) };
      }
      return { kind: 'error', words: RATING_COPY.generic, assertive: true };
    default:
      return { kind: 'error', words: RATING_COPY.generic, assertive: true };
  }
}
