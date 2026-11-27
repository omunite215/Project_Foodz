import { describe, expect, it } from 'vitest';
import type { OrderRatingView } from '@/server/modules/ratings/schema';
import {
  cardHeading,
  closedLine,
  commentAbout,
  commentCounter,
  commentLabel,
  courierHeading,
  courierPrivacy,
  dishName,
  draftChanged,
  draftFrom,
  editUntilLine,
  keepTags,
  rateGroupName,
  rateHref,
  rateOrderName,
  ratingRequest,
  sendRefusal,
  starsCount,
  starsLabel,
  starWord,
  summaryListName,
  tagChoices,
  tagPrompt,
  tagWords,
  thanksLine,
} from './rating-text';

const ORDER = '0b6c3c35-6b6f-4c39-9a3e-3d0d0e0f1a42';
const GIMBAP = '1b6c3c35-6b6f-4c39-9a3e-3d0d0e0f1a41';
const PAD_THAI = '2b6c3c35-6b6f-4c39-9a3e-3d0d0e0f1a40';

function view(overrides: Partial<OrderRatingView> = {}): OrderRatingView {
  return {
    state: 'open',
    editable: true,
    closesAt: '2026-11-28T00:46:00.000Z',
    closesOnWords: 'Fri, Nov 27',
    closedOnWords: 'Nov 27',
    demo: false,
    dishes: [
      {
        menuItemId: GIMBAP,
        title: 'Gimbap',
        quantity: 2,
        imageUrl: null,
        stars: null,
        tags: [],
        comment: null,
        editedAt: null,
      },
      {
        menuItemId: PAD_THAI,
        title: 'Pad Thai',
        quantity: 1,
        imageUrl: null,
        stars: null,
        tags: [],
        comment: null,
        editedAt: null,
      },
    ],
    courier: {
      firstName: 'Luis',
      hasPhoto: false,
      stars: null,
      tags: [],
      comment: null,
      editedAt: null,
    },
    ...overrides,
  };
}

describe('star words', () => {
  it('counts and names stars', () => {
    expect(starsCount(1)).toBe('1 star');
    expect(starsCount(3)).toBe('3 stars');
    expect(starsLabel(1)).toBe('1 star, Bad');
    expect(starsLabel(3)).toBe('3 stars, OK');
    expect(starsLabel(5)).toBe('5 stars, Great');
    expect(starsLabel(7)).toBe('7 stars');
    expect([1, 2, 3, 4, 5].map((stars) => starWord(stars as 1 | 2 | 3 | 4 | 5))).toEqual([
      'Bad',
      'Poor',
      'OK',
      'Good',
      'Great',
    ]);
  });
});

describe('row words', () => {
  const dish = { kind: 'dish', title: 'Pad Thai' } as const;
  const courier = { kind: 'courier', firstName: 'Luis' } as const;

  it('names dishes once with their quantity', () => {
    expect(dishName('Gimbap', 2)).toBe('Gimbap × 2');
    expect(dishName('Pad Thai', 1)).toBe('Pad Thai');
  });

  it('names the card, the courier part, the groups and the comments', () => {
    expect(cardHeading('1042')).toBe('How was order 1042?');
    expect(courierHeading('Luis')).toBe("How was Luis's delivery?");
    expect(rateGroupName(dish)).toBe('Rate Pad Thai');
    expect(rateGroupName(courier)).toBe("Rate Luis's delivery");
    expect(commentAbout(dish)).toBe('about Pad Thai');
    expect(commentLabel(dish)).toBe('Comment about Pad Thai (optional)');
    expect(commentLabel(courier)).toBe("Comment about Luis's delivery (optional)");
    expect(courierPrivacy('Luis')).toBe(
      'Luis sees only an overall average and the tags customers pick, never your name or your comment.',
    );
  });

  it('shows the counter from 400 characters', () => {
    expect(commentCounter(0)).toBeNull();
    expect(commentCounter(399)).toBeNull();
    expect(commentCounter(412)).toBe('412/500');
    expect(commentCounter(500)).toBe('500/500');
  });
});

describe('tags', () => {
  it('asks the right question at the 3 | 4 line', () => {
    expect(tagPrompt(3)).toBe('What could be better?');
    expect(tagPrompt(4)).toBe('What was good?');
  });

  it('offers each set in the design order with its words', () => {
    expect(tagChoices('dish', 5).map((choice) => choice.label)).toEqual([
      'Tasty',
      'Fresh',
      'Good portion',
      'Well packed',
      'Arrived hot',
    ]);
    expect(tagChoices('dish', 2).map((choice) => choice.label)).toEqual([
      'Cold',
      'Too salty',
      'Too spicy',
      'Small portion',
      'Not as described',
      'Badly packed',
    ]);
    expect(tagChoices('courier', 4).map((choice) => choice.label)).toEqual([
      'Friendly',
      'On time',
      'Careful with the food',
      'Followed my instructions',
    ]);
    expect(tagChoices('courier', 1).map((choice) => choice.label)).toEqual([
      'Late',
      'Food spilled or damaged',
      "Didn't follow my instructions",
      'Unfriendly',
    ]);
  });

  it('clears presses from the other set when the stars cross the line', () => {
    expect(keepTags('dish', 2, ['tasty', 'cold'])).toEqual(['cold']);
    expect(keepTags('dish', 4, ['fresh', 'tasty', 'cold'])).toEqual(['tasty', 'fresh']);
    expect(keepTags('courier', 5, ['late'])).toEqual([]);
    expect(tagWords(['on-time', 'late'])).toEqual(['On time', 'Late']);
  });
});

describe('after sending', () => {
  it('thanks the customer, naming the courier when there was one', () => {
    expect(thanksLine('Priya', 'Luis')).toBe(
      'Thanks, Priya. Every rating helps the kitchen and Luis.',
    );
    expect(thanksLine('Priya', null)).toBe('Thanks, Priya. Every rating helps the kitchen.');
    expect(thanksLine(null, null)).toBe('Thanks. Every rating helps the kitchen.');
  });

  it('says how long ratings can change and when they closed', () => {
    expect(editUntilLine('Fri, Nov 27')).toBe('You can change these until Fri, Nov 27.');
    expect(closedLine('Nov 27')).toBe('Ratings for this order closed on Nov 27.');
    expect(summaryListName('1042')).toBe('Your ratings for order 1042');
    expect(rateOrderName('1042')).toBe('Rate order 1042');
  });

  it('links to the card on the order page', () => {
    expect(rateHref(ORDER)).toBe(`/orders/${ORDER}#rate`);
  });
});

describe('the request', () => {
  it('is null when nothing is picked', () => {
    expect(ratingRequest(ORDER, view(), draftFrom(view()))).toBeNull();
  });

  it('sends only rows with stars, tags kept to their band', () => {
    const draft = draftFrom(view());
    draft.dishes[GIMBAP] = { stars: 3, tags: ['tasty', 'cold'], comment: '', commentOpen: false };
    draft.courier = { stars: 5, tags: ['friendly', 'late'], comment: '  ', commentOpen: true };
    expect(ratingRequest(ORDER, view(), draft)).toEqual({
      orderId: ORDER,
      dishes: [{ menuItemId: GIMBAP, stars: 3, tags: ['cold'], comment: null }],
      courier: { stars: 5, tags: ['friendly'], comment: null },
    });
  });

  it('keeps comments as typed and sends none in the demo', () => {
    const draft = draftFrom(view());
    draft.dishes[PAD_THAI] = {
      stars: 5,
      tags: [],
      comment: 'Lovely.\nThanks',
      commentOpen: true,
    };
    expect(ratingRequest(ORDER, view(), draft)?.dishes).toEqual([
      { menuItemId: PAD_THAI, stars: 5, tags: [], comment: 'Lovely.\nThanks' },
    ]);
    expect(ratingRequest(ORDER, view({ demo: true }), draft)?.dishes).toEqual([
      { menuItemId: PAD_THAI, stars: 5, tags: [] },
    ]);
  });

  it('leaves the courier out when the order had none', () => {
    const draft = draftFrom(view());
    draft.courier = { stars: 4, tags: [], comment: '', commentOpen: false };
    draft.dishes[GIMBAP] = { stars: 4, tags: [], comment: '', commentOpen: false };
    expect(ratingRequest(ORDER, view({ courier: null }), draft)).toEqual({
      orderId: ORDER,
      dishes: [{ menuItemId: GIMBAP, stars: 4, tags: [], comment: null }],
    });
  });
});

describe('editing', () => {
  const rated = view({
    state: 'rated',
    dishes: [
      { ...view().dishes[0]!, stars: 3, tags: ['cold'], comment: 'A bit cold.' },
      { ...view().dishes[1]!, stars: null },
    ],
    courier: { ...view().courier!, stars: 5, tags: ['friendly'] },
  });

  it('opens on what was saved, with a saved comment showing', () => {
    const draft = draftFrom(rated);
    expect(draft.dishes[GIMBAP]).toEqual({
      stars: 3,
      tags: ['cold'],
      comment: 'A bit cold.',
      commentOpen: true,
    });
    expect(draft.courier?.commentOpen).toBe(false);
  });

  it('knows when nothing changed', () => {
    expect(draftChanged(rated, draftFrom(rated))).toBe(false);
  });

  it('sees new stars, tags, comments and a newly rated dish', () => {
    const stars = draftFrom(rated);
    stars.dishes[GIMBAP] = { ...stars.dishes[GIMBAP]!, stars: 2 };
    expect(draftChanged(rated, stars)).toBe(true);

    const tags = draftFrom(rated);
    tags.courier = { ...tags.courier!, tags: ['friendly', 'on-time'] };
    expect(draftChanged(rated, tags)).toBe(true);

    const comment = draftFrom(rated);
    comment.dishes[GIMBAP] = { ...comment.dishes[GIMBAP]!, comment: '' };
    expect(draftChanged(rated, comment)).toBe(true);

    const newRow = draftFrom(rated);
    newRow.dishes[PAD_THAI] = { stars: 5, tags: [], comment: '', commentOpen: false };
    expect(draftChanged(rated, newRow)).toBe(true);
  });
});

describe('refusals', () => {
  it('maps the connection, the limit, a closed window and anything else', () => {
    expect(sendRefusal({ code: 'OFFLINE', message: '' })).toEqual({
      kind: 'error',
      words: "Couldn't send your ratings. Check your connection and try again.",
      assertive: true,
    });
    expect(sendRefusal({ code: 'TIMEOUT', message: '' }).words).toBe(
      "Couldn't send your ratings. Check your connection and try again.",
    );
    expect(
      sendRefusal({
        code: 'RATE_LIMITED',
        message: "You've sent a lot of ratings. Try again in 20 minutes.",
      }).words,
    ).toBe("You've sent a lot of ratings. Try again in 20 minutes.");
    expect(
      sendRefusal({
        code: 'RATING_NOT_OPEN',
        message: '',
        details: { why: 'closed', closedOnWords: 'Nov 27' },
      }),
    ).toEqual({ kind: 'closed', words: 'Ratings for this order closed on Nov 27.' });
    expect(
      sendRefusal(
        { code: 'RATING_NOT_OPEN', message: '', details: { why: 'closed', closedOnWords: null } },
        'Nov 28',
      ).words,
    ).toBe('Ratings for this order closed on Nov 28.');
    expect(sendRefusal({ code: 'INTERNAL', message: 'Boom' }).words).toBe(
      "Couldn't send your ratings. Try again.",
    );
  });
});
