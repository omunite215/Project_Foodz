import 'server-only';
import { formatPrice } from '@/lib/format';
import { actionEmail, type Email, receiptEmail } from '@/server/notifications/email';
import type { CancellationNotice } from './progress-schema';
import type { OrderView } from './schema';
import {
  cancellationOpener,
  clockAt,
  codeReleasedSentence,
  customerCancelSentence,
  REFUND_TAKES_DAYS,
  refundingSentence,
  SAMPLE_NO_REFUND,
} from './text';

/*
 * The F4 emails (S11.5, S12.5, S9.5, S10.1, S10.4; design 6): the receipt, the cancellation,
 * refunds in full or in part, and the two automatic refunds. Each is plain HTML in the account
 * email layout plus a text part, built from the order as stored.
 */

export const ORDER_EMAIL_KINDS = [
  'receipt',
  'receipt-late',
  'cancelled',
  'refunded',
  'late-refund',
  'mismatch-refund',
] as const;
export type OrderEmailKind = (typeof ORDER_EMAIL_KINDS)[number];

export interface OrderEmailOptions {
  to: string;
  /** The site's address, e.g. http://localhost:3456. */
  siteUrl: string;
  /** For refund emails: this refund and when it was made. */
  refund?: { amountCents: number; at: string };
}

const REFUND_DELAY = 'It can take 5 to 10 business days to appear.';

const firstName = (name: string) => name.trim().split(/\s+/)[0] || 'there';

/** "7:35–7:45 pm", or "11:55 am–12:05 pm" across noon. */
export function arrivalText(from: string, to: string, timeZone: string): string {
  const start = clockAt(from, timeZone);
  const end = clockAt(to, timeZone);
  const [startTime, startHalf] = start.split(' ');
  const endHalf = end.split(' ')[1];
  return startHalf === endHalf ? `${startTime}–${end}` : `${start}–${end}`;
}

/** "November 20", in the store's time zone. */
const dayOf = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat('en-US', { timeZone, month: 'long', day: 'numeric' }).format(
    new Date(iso),
  );

/** 700 → "7%", 625 → "6.25%". */
const ratePercent = (bps: number) => `${Number((bps / 100).toFixed(2))}%`;

const cardOf = (order: OrderView) => order.payment.card?.label ?? 'your card';

function receipt(order: OrderView, options: OrderEmailOptions, late: boolean): Email {
  const { breakdown, store } = order;
  const window =
    order.arrival?.from && order.arrival.to
      ? arrivalText(order.arrival.from, order.arrival.to, store.timeZone)
      : null;
  const arriving = window ? ` is arriving about ${window}` : ' is placed';
  const intro = late
    ? [
        `Your payment arrived just after the deadline, and we've placed order ${order.number}.`,
        ...(window ? [`It's arriving about ${window}.`] : []),
      ]
    : [`Thanks, ${firstName(order.contact.name)}. Order ${order.number}${arriving}.`];

  const rows: { label: string; value: string; credit?: boolean }[] = [
    { label: 'Subtotal', value: formatPrice(breakdown.subtotalCents) },
  ];
  if (breakdown.promo && breakdown.promo.foodDiscountCents > 0) {
    rows.push({
      label: `Promo ${breakdown.promo.code}`,
      value: `−${formatPrice(breakdown.promo.foodDiscountCents)}`,
      credit: true,
    });
  }
  rows.push({
    label: 'Delivery',
    value:
      breakdown.deliveryDiscountCents > 0 &&
      breakdown.deliveryDiscountCents >= breakdown.deliveryFeeCents
        ? `Free (was ${formatPrice(breakdown.deliveryFeeCents)})`
        : formatPrice(breakdown.deliveryFeeCents - breakdown.deliveryDiscountCents),
  });
  rows.push({
    label: breakdown.tax.rateBps === null ? 'Tax' : `Tax (${ratePercent(breakdown.tax.rateBps)})`,
    value: formatPrice(breakdown.tax.cents),
  });
  rows.push({ label: 'Tip for your courier', value: formatPrice(breakdown.tipCents) });

  const total = formatPrice(breakdown.totalCents);
  const payment =
    order.payment.method === 'card'
      ? `Paid with ${cardOf(order)}`
      : `Pay ${total} in cash when it arrives. Please have the exact amount ready if you can.`;

  const { delivery } = order;
  const address = [delivery.line1, delivery.line2, delivery.city].filter(Boolean).join(', ');
  const url = new URL(`/orders/${order.id}`, options.siteUrl).toString();

  return {
    to: options.to,
    subject: `Your Foodz order ${order.number}`,
    ...receiptEmail({
      heading: 'Order placed',
      intro,
      linesHeading: 'Your order',
      lines: order.lines.map((line) => ({
        label: `${line.quantity} × ${line.title}`,
        details: [
          ...(line.flavors.length > 0 ? [`Extra: ${line.flavors.join(', ')}`] : []),
          ...(line.note ? [`Note: ${line.note}`] : []),
        ],
        amount: formatPrice(line.lineTotalCents),
      })),
      afterLines: order.kitchenNote ? [`Note for the kitchen: ${order.kitchenNote}`] : [],
      rows,
      total: { label: 'Total', value: total },
      payment,
      deliveryHeading: 'Delivering to',
      delivery: {
        line: delivery.label ? `${delivery.label} · ${address}` : address,
        notes: [
          ...(delivery.instructions ? [`Instructions: ${delivery.instructions}`] : []),
          `Your courier will call ${order.contact.phoneDisplay} if needed.`,
        ],
      },
      action: 'View your order',
      url,
      footer: [`Need help? Call ${store.phone}.`],
    }),
  };
}

function notice(
  order: OrderView,
  options: OrderEmailOptions,
  subject: string,
  message: string,
): Email {
  return {
    to: options.to,
    subject,
    ...actionEmail({
      heading: subject,
      message,
      action: 'View your order',
      url: new URL(`/orders/${order.id}`, options.siteUrl).toString(),
      footer: [`Need help? Call ${order.store.phone}.`],
    }),
  };
}

/**
 * A cancellation by the store (F5 S5.5): the reason's customer line, the money line and the
 * code given back, in the words of the order page. Never a staff name, role, note or the
 * reason staff picked.
 */
export function storeCancellationLines(
  order: OrderView,
  cancellation: CancellationNotice,
): { reason: string; money: string; code: string | null } {
  const phone = order.store.phone;
  const reason = customerCancelSentence(
    cancellation.reasonLine ?? 'other',
    cancellation.dishes,
    phone,
  );
  const amount = formatPrice(cancellation.amountCents ?? order.breakdown.totalCents);
  let money: string;
  switch (cancellation.moneyLine) {
    case 'refunding':
      money = refundingSentence(amount, cancellation.cardLabel, cancellation.tipIncluded);
      break;
    case 'refunded': {
      const day = cancellation.refundedAt
        ? ` on ${dayOf(cancellation.refundedAt, order.store.timeZone)}`
        : '';
      money = `Refunded ${amount} to ${cancellation.cardLabel ?? 'your card'}${day}. ${REFUND_TAKES_DAYS}`;
      break;
    }
    case 'sample':
      money = SAMPLE_NO_REFUND;
      break;
    case 'nothing':
    default:
      money = 'Nothing was charged.';
  }
  return {
    reason,
    money,
    code: cancellation.codeReleased ? codeReleasedSentence(cancellation.codeReleased) : null,
  };
}

function storeCancellationEmail(
  order: OrderView,
  cancellation: CancellationNotice,
  options: OrderEmailOptions,
): Email {
  const subject = `Order ${order.number} is cancelled`;
  const { reason, money, code } = storeCancellationLines(order, cancellation);
  const message = [
    cancellationOpener(cancellation.opener ?? 'sorry', order.number),
    reason,
    money,
    ...(code ? [code] : []),
  ].join(' ');
  return {
    to: options.to,
    subject,
    ...actionEmail({
      heading: subject,
      message,
      action: 'Browse the menu',
      url: new URL('/menu', options.siteUrl).toString(),
      footer: [
        `View your order: ${new URL(`/orders/${order.id}`, options.siteUrl).toString()}`,
        `Need help? Call ${order.store.phone}.`,
      ],
    }),
  };
}

/** The finished email for an order and what happened to it. */
export function renderOrderEmail(
  kind: OrderEmailKind,
  order: OrderView,
  options: OrderEmailOptions,
): Email {
  const total = formatPrice(order.breakdown.totalCents);
  const refunded = formatPrice(options.refund?.amountCents ?? order.refunds.refundedCents);
  switch (kind) {
    case 'receipt':
      return receipt(order, options, false);
    case 'receipt-late':
      return receipt(order, options, true);
    case 'cancelled': {
      const cancellation = order.progress.cancellation;
      if (cancellation?.by === 'store') {
        return storeCancellationEmail(order, cancellation, options);
      }
      // D45: her own cancellation of a paid card order sends this email only, with the refund.
      // A refund is promised only when the server decided one (security S13): the amount left
      // after anything refunded before.
      const byCard = order.payment.method === 'card' && order.payment.status !== 'UNPAID';
      const done = `You cancelled order ${order.number}.`;
      let line = `${done} Nothing was charged.`;
      if (options.refund) {
        line = `${done} We're refunding ${formatPrice(options.refund.amountCents)} to ${cardOf(order)}. ${REFUND_DELAY}`;
      } else if (byCard && order.payment.status === 'REFUNDED') {
        line = `${done} Your payment of ${formatPrice(order.refunds.refundedCents || order.breakdown.totalCents)} was already refunded to ${cardOf(order)}.`;
      } else if (byCard) {
        line = done;
      }
      return notice(order, options, `Order ${order.number} is cancelled`, line);
    }
    case 'refunded': {
      const at = options.refund?.at ?? new Date().toISOString();
      const day = dayOf(at, order.store.timeZone);
      const partial = (options.refund?.amountCents ?? 0) < order.breakdown.totalCents;
      return notice(
        order,
        options,
        `We've refunded ${refunded} for order ${order.number}`,
        partial
          ? `We've refunded ${refunded} of ${total} to ${cardOf(order)} on ${day}. ${REFUND_DELAY}`
          : `We've refunded ${refunded} to ${cardOf(order)} on ${day}. ${REFUND_DELAY}`,
      );
    }
    case 'late-refund':
      return notice(
        order,
        options,
        `We've refunded ${refunded} for order ${order.number}`,
        `Your payment arrived after this order had expired, so we refunded ${refunded} to ${cardOf(order)}. Refunds take 5 to 10 business days to appear.`,
      );
    case 'mismatch-refund':
    default:
      return notice(
        order,
        options,
        `We've refunded ${refunded} for order ${order.number}`,
        `Something went wrong with this payment, so we refunded ${refunded} in full. Please place your order again.`,
      );
  }
}

/** The in-app notification beside each email (F17 shows them). */
export function orderNotice(kind: OrderEmailKind, order: OrderView, refundCents?: number) {
  const amount = formatPrice(refundCents ?? order.refunds.refundedCents);
  switch (kind) {
    case 'receipt':
    case 'receipt-late':
      return {
        title: `Order ${order.number} is placed`,
        body: "We'll let you know when the kitchen starts cooking.",
      };
    case 'cancelled': {
      const cancellation = order.progress.cancellation;
      if (cancellation?.by === 'store') {
        const { reason, money } = storeCancellationLines(order, cancellation);
        return { title: `Order ${order.number} is cancelled`, body: `${reason} ${money}` };
      }
      return { title: `Order ${order.number} is cancelled`, body: 'You cancelled this order.' };
    }
    default:
      return {
        title: `We've refunded ${amount} for order ${order.number}`,
        body: 'Refunds take 5 to 10 business days to appear.',
      };
  }
}
