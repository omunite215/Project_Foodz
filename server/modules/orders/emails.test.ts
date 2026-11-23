import { describe, expect, it } from 'vitest';
import { arrivalText, orderNotice, renderOrderEmail } from './emails';
import type { CancellationNotice } from './progress-schema';
import type { OrderView } from './schema';

const SITE = 'http://localhost:3456';
const ID = '0196a1b2-0000-7000-8000-0000000000aa';

/** Priya's T6 order: cart A, KBBQ5, 15 % tip, paid by card. */
function order(extra: Partial<OrderView> = {}): OrderView {
  return {
    id: ID,
    number: '1042',
    createdAt: '2026-11-20T00:02:00.000Z',
    placedAt: '2026-11-20T00:02:00.000Z',
    status: 'PLACED',
    cancelReason: null,
    cancellable: true,
    payable: false,
    expiresAt: null,
    payment: {
      method: 'card',
      status: 'PAID',
      card: {
        brand: 'visa',
        last4: '4242',
        label: 'Visa •••• 4242',
        spoken: 'Visa ending in 4242',
      },
      decline: null,
    },
    lines: [
      {
        title: 'Gimbap',
        flavors: ['Gochujang'],
        note: 'No cucumber please',
        quantity: 2,
        unitPriceCents: 1299,
        lineTotalCents: 2598,
      },
      {
        title: 'Pad Thai',
        flavors: [],
        note: null,
        quantity: 1,
        unitPriceCents: 2199,
        lineTotalCents: 2199,
      },
    ],
    kitchenNote: 'More spicy',
    breakdown: {
      subtotalCents: 4797,
      promo: { code: 'KBBQ5', foodDiscountCents: 500, freeDelivery: false },
      deliveryFeeCents: 264,
      deliveryDiscountCents: 0,
      tax: { rateBps: 700, cents: 301 },
      tipCents: 720,
      tipChoice: '15',
      totalCents: 5582,
    },
    refunds: { refundedCents: 0, entries: [] },
    dispute: { status: 'NONE', openedAt: null, closedAt: null },
    delivery: {
      label: 'Work',
      line1: '1 Faneuil Hall Square',
      line2: 'Apt 4',
      city: 'Boston, MA 02109',
      instructions: 'Buzzer 3, leave at the door',
      distanceKm: 1.3,
    },
    contact: { name: 'Priya Shah', firstName: 'Priya', phoneDisplay: '(617) 555-0123' },
    arrival: {
      fromMinutes: 33,
      toMinutes: 43,
      from: '2026-11-20T00:35:00.000Z',
      to: '2026-11-20T00:45:00.000Z',
    },
    timeline: [],
    flags: { revivedAfterLatePayment: false, lateRefund: false, mismatchRefund: false },
    store: { phone: '(617) 555-0142', timeZone: 'America/New_York' },
    progress: {
      asOf: '2026-11-20T00:02:00.000Z',
      version: 1,
      steps: null,
      arrival: null,
      placedWaiting: 'none',
      deliveredAt: null,
      cashCollected: false,
      cancellation: null,
      live: true,
      refreshAt: null,
    },
    ...extra,
  };
}

/** A cancellation by the store, as the progress builder words it (F5 S5). */
function cancelledByStore(notice: Partial<CancellationNotice>): Partial<OrderView> {
  const base = order();
  return {
    status: 'CANCELLED',
    cancelReason: 'store',
    progress: {
      ...base.progress,
      live: false,
      cancellation: {
        by: 'store',
        opener: 'sorry',
        reasonLine: 'ranOut',
        dishes: ['Pad Thai'],
        moneyLine: 'refunding',
        amountCents: 5582,
        cardLabel: 'Visa •••• 4242',
        refundedAt: null,
        tipIncluded: true,
        codeReleased: null,
        refundSlow: false,
        at: '2026-11-20T00:10:00.000Z',
        ...notice,
      },
    },
  };
}

const options = { to: 'second.customer@foodz.example', siteUrl: SITE };

describe('the receipt (S11.5, design 6.1)', () => {
  const email = renderOrderEmail('receipt', order(), options);

  it('is addressed and titled with the order number', () => {
    expect(email.to).toBe('second.customer@foodz.example');
    expect(email.subject).toBe('Your Foodz order 1042');
  });

  it('has the number, arrival window, lines, breakdown and total in its text part', () => {
    expect(email.text).toContain('Thanks, Priya. Order 1042 is arriving about 7:35–7:45 pm.');
    expect(email.text).toContain('2 × Gimbap — $25.98');
    expect(email.text).toContain('   Extra: Gochujang');
    expect(email.text).toContain('   Note: No cucumber please');
    expect(email.text).toContain('1 × Pad Thai — $21.99');
    expect(email.text).toContain('Note for the kitchen: More spicy');
    expect(email.text).toContain(
      [
        'Subtotal: $47.97',
        'Promo KBBQ5: −$5.00',
        'Delivery: $2.64',
        'Tax (7%): $3.01',
        'Tip for your courier: $7.20',
        'Total: $55.82',
      ].join('\n'),
    );
  });

  it('says how it was paid, where it goes, and links to the order page', () => {
    expect(email.text).toContain('Paid with Visa •••• 4242');
    expect(email.text).toContain('Work · 1 Faneuil Hall Square, Apt 4, Boston, MA 02109');
    expect(email.text).toContain('Instructions: Buzzer 3, leave at the door');
    expect(email.text).toContain('Your courier will call (617) 555-0123 if needed.');
    expect(email.text).toContain(`View your order: ${SITE}/orders/${ID}`);
    expect(email.text).toContain('Need help? Call (617) 555-0142.');
    expect(email.html).toContain(`href="${SITE}/orders/${ID}"`);
    expect(email.html).toContain('View your order');
    // A 44 px button: 12 + 20 + 12.
    expect(email.html).toMatch(/padding:12px 24px;line-height:20px/);
  });

  it('asks for cash on a cash order, and shows free delivery as free', () => {
    const cash = renderOrderEmail(
      'receipt',
      order({
        payment: { method: 'cash', status: 'UNPAID', card: null, decline: null },
        breakdown: {
          ...order().breakdown,
          promo: { code: 'FREEDELIVERY', foodDiscountCents: 0, freeDelivery: true },
          deliveryDiscountCents: 264,
          tax: { rateBps: 700, cents: 336 },
          tipCents: 0,
          tipChoice: 'none',
          totalCents: 5133,
        },
      }),
      options,
    );
    expect(cash.text).toContain(
      'Pay $51.33 in cash when it arrives. Please have the exact amount ready if you can.',
    );
    expect(cash.text).toContain('Delivery: Free (was $2.64)');
    expect(cash.text).not.toContain('Promo FREEDELIVERY');
  });

  it('opens with the late-payment sentence when it was placed after the deadline (S9.5)', () => {
    const late = renderOrderEmail('receipt-late', order(), options);
    expect(late.text).toContain(
      "Your payment arrived just after the deadline, and we've placed order 1042.",
    );
  });

  it('keeps what customers typed as text in the HTML', () => {
    const tricky = renderOrderEmail(
      'receipt',
      order({ kitchenNote: '<img src=x onerror=alert(1)>' }),
      options,
    );
    expect(tricky.html).not.toContain('<img src=x');
    expect(tricky.html).toContain('&#60;img src=x onerror=alert(1)&#62;');
  });
});

describe('the other order emails (design 6.2)', () => {
  it('cancelled: names the refund for a paid card order, and nothing charged otherwise (D45)', () => {
    const paid = renderOrderEmail('cancelled', order({ status: 'CANCELLED' }), options);
    expect(paid.subject).toBe('Order 1042 is cancelled');
    expect(paid.text).toContain(
      "You cancelled order 1042. We're refunding $55.82 to Visa •••• 4242. It can take 5 to 10 business days to appear.",
    );
    const cash = renderOrderEmail(
      'cancelled',
      order({
        status: 'CANCELLED',
        payment: { method: 'cash', status: 'UNPAID', card: null, decline: null },
      }),
      options,
    );
    expect(cash.text).toContain('You cancelled order 1042. Nothing was charged.');
  });

  it('cancelled: names what is still to come back when part was refunded before (security S2)', () => {
    const partly = renderOrderEmail(
      'cancelled',
      order({
        status: 'CANCELLED',
        payment: { ...order().payment, status: 'PARTIALLY_REFUNDED' },
      }),
      { ...options, refund: { amountCents: 5082, at: '2026-11-20T15:00:00Z' } },
    );
    expect(partly.text).toContain(
      "You cancelled order 1042. We're refunding $50.82 to Visa •••• 4242. It can take 5 to 10 business days to appear.",
    );
  });

  it('refunded in full and in part, with the date in the store’s zone', () => {
    const full = renderOrderEmail('refunded', order(), {
      ...options,
      refund: { amountCents: 5582, at: '2026-11-20T15:00:00Z' },
    });
    expect(full.subject).toBe("We've refunded $55.82 for order 1042");
    expect(full.text).toContain(
      "We've refunded $55.82 to Visa •••• 4242 on November 20. It can take 5 to 10 business days to appear.",
    );
    const part = renderOrderEmail('refunded', order(), {
      ...options,
      refund: { amountCents: 500, at: '2026-11-21T03:30:00Z' },
    });
    expect(part.subject).toBe("We've refunded $5.00 for order 1042");
    expect(part.text).toContain("We've refunded $5.00 of $55.82 to Visa •••• 4242 on November 20.");
  });

  it('late-payment and mismatch refunds say why', () => {
    const late = renderOrderEmail('late-refund', order({ status: 'CANCELLED' }), {
      ...options,
      refund: { amountCents: 5582, at: '2026-11-20T15:00:00Z' },
    });
    expect(late.text).toContain(
      'Your payment arrived after this order had expired, so we refunded $55.82 to Visa •••• 4242. Refunds take 5 to 10 business days to appear.',
    );
    const mismatch = renderOrderEmail('mismatch-refund', order({ status: 'FAILED' }), {
      ...options,
      refund: { amountCents: 9999, at: '2026-11-20T15:00:00Z' },
    });
    expect(mismatch.subject).toBe("We've refunded $99.99 for order 1042");
    expect(mismatch.text).toContain(
      'Something went wrong with this payment, so we refunded $99.99 in full. Please place your order again.',
    );
  });

  it('each has a plain-text part and the order link', () => {
    for (const kind of ['cancelled', 'refunded', 'late-refund', 'mismatch-refund'] as const) {
      const email = renderOrderEmail(kind, order(), options);
      expect(email.text).toContain(`${SITE}/orders/${ID}`);
      expect(email.html).toContain('<!doctype html>');
    }
  });

  it('writes a short in-app notice too', () => {
    expect(orderNotice('receipt', order()).title).toBe('Order 1042 is placed');
    expect(orderNotice('refunded', order(), 500).title).toBe("We've refunded $5.00 for order 1042");
  });
});

describe('the arrival window as clock times', () => {
  it('drops the repeated am/pm, and keeps both across noon', () => {
    expect(arrivalText('2026-11-20T00:35:00Z', '2026-11-20T00:45:00Z', 'America/New_York')).toBe(
      '7:35–7:45 pm',
    );
    expect(arrivalText('2026-11-20T16:55:00Z', '2026-11-20T17:05:00Z', 'America/New_York')).toBe(
      '11:55 am–12:05 pm',
    );
  });
});

describe('a cancellation by the store (F5 S5.5, S5.7, B24)', () => {
  it('opens with the apology, gives the reason line, the refund and the code', () => {
    const email = renderOrderEmail(
      'cancelled',
      order(cancelledByStore({ codeReleased: 'KBBQ5' })),
      options,
    );
    expect(email.subject).toBe('Order 1042 is cancelled');
    expect(email.text).toContain('Sorry, we had to cancel order 1042.');
    expect(email.text).toContain(
      "The kitchen ran out of Pad Thai, so we couldn't make your order.",
    );
    expect(email.text).toContain(
      "We're refunding $55.82 to Visa •••• 4242, tip included. It can take 5 to 10 business days to appear.",
    );
    expect(email.text).toContain('Your code KBBQ5 is free to use again.');
    expect(email.text).toContain(`Browse the menu: ${SITE}/menu`);
    expect(email.text).toContain(`View your order: ${SITE}/orders/${ID}`);
    expect(email.text).not.toMatch(/You cancelled|refused|staff|kitchen-refused/i);
  });

  it('says it plainly for her own request, and nothing charged for cash', () => {
    const email = renderOrderEmail(
      'cancelled',
      order(
        cancelledByStore({
          opener: 'plain',
          reasonLine: 'atYourRequest',
          dishes: [],
          moneyLine: 'nothing',
          amountCents: null,
          tipIncluded: false,
        }),
      ),
      options,
    );
    expect(email.text).toContain(
      'Order 1042 is cancelled. Cancelled at your request. Nothing was charged.',
    );
    expect(email.text).not.toContain('Sorry');
  });

  it('never says refunding for a sample order', () => {
    const email = renderOrderEmail(
      'cancelled',
      order(cancelledByStore({ moneyLine: 'sample', amountCents: null, reasonLine: 'tooBusy' })),
      options,
    );
    expect(email.text).toContain(
      "This sample order had no real card payment, so there's nothing to refund.",
    );
    expect(email.text).not.toContain('refunding');
  });

  it('joins several dishes in words, and gives the phone for the lines that need it', () => {
    const several = renderOrderEmail(
      'cancelled',
      order(cancelledByStore({ dishes: ['Gimbap', 'Pad Thai', 'Bulgogi'] })),
      options,
    );
    expect(several.text).toContain('The kitchen ran out of Gimbap, Pad Thai and Bulgogi');
    const fraud = renderOrderEmail(
      'cancelled',
      order(cancelledByStore({ reasonLine: 'couldNotAccept', dishes: [] })),
      options,
    );
    expect(fraud.text).toContain(
      "We couldn't accept this order. Call us on (617) 555-0142 if you think this is a mistake.",
    );
  });

  it('writes the in-app notice with the reason and money lines, never "You cancelled"', () => {
    const notice = orderNotice('cancelled', order(cancelledByStore({ reasonLine: 'tooBusy' })));
    expect(notice).toEqual({
      title: 'Order 1042 is cancelled',
      body: "Our kitchen is too busy to make your order in good time. We're refunding $55.82 to Visa •••• 4242, tip included. It can take 5 to 10 business days to appear.",
    });
  });
});
