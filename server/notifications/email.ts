import 'server-only';
import { createTransport, type Transporter } from 'nodemailer';
import { logger } from '@/server/logger';

declare global {
  var foodzMailer: Transporter | undefined;
}

const transporter =
  globalThis.foodzMailer ?? createTransport(process.env.SMTP_URL ?? 'smtp://127.0.0.1:1025');
if (process.env.NODE_ENV !== 'production') globalThis.foodzMailer = transporter;

export interface Email {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export async function sendEmail(email: Email) {
  await transporter.sendMail({ from: process.env.EMAIL_FROM, ...email });
  logger.info({ subject: email.subject }, 'email sent');
}

const escape = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const PAGE_STYLE =
  'margin:0;font-family:Poppins,Arial,sans-serif;background:#fcfcfd;padding:16px;color:#23262f';
const CARD_STYLE =
  'width:100%;max-width:520px;margin:0 auto;background:#fff;border-radius:16px;padding:24px';
const HEADING_STYLE =
  'font-family:Alice,Georgia,serif;font-weight:400;font-size:28px;line-height:1.2;margin:0 0 16px';
const TEXT_STYLE = 'font-size:16px;line-height:1.5;color:#353945;margin:0 0 24px';
const SMALL_STYLE = 'font-size:14px;line-height:1.5;color:#6b7183;margin:0 0 12px';
// 12 + 20 + 12 = a 44 px tall target.
const BUTTON_STYLE =
  'display:inline-block;background:#03850a;color:#fff;text-decoration:none;padding:12px 24px;line-height:20px;font-size:16px;border-radius:8px;font-weight:500';

function layout(heading: string, body: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(heading)}</title></head><body style="${PAGE_STYLE}">
<table role="presentation" style="${CARD_STYLE}"><tr><td>
<h1 style="${HEADING_STYLE}">${escape(heading)}</h1>
${body}
</td></tr></table></body></html>`;
}

/**
 * A plain transactional layout: heading, message, one button, and the same link as text for
 * mail apps that hide buttons. `footer` lines go under the link.
 */
export function actionEmail(options: {
  heading: string;
  message: string;
  action: string;
  url: string;
  footer?: string[];
}) {
  const { heading, message, action, url, footer = [] } = options;
  return {
    text: [heading, message, `${action}: ${url}`, ...footer].join('\n\n'),
    html: layout(
      heading,
      `<p style="${TEXT_STYLE}">${escape(message)}</p>
<p style="margin:0 0 24px"><a href="${escape(url)}" style="${BUTTON_STYLE}">${escape(action)}</a></p>
<p style="${SMALL_STYLE}">If the button doesn't work, copy this link into your browser:</p>
<p style="${SMALL_STYLE};word-break:break-all"><a href="${escape(url)}" style="color:#03850a">${escape(url)}</a></p>
${footer.map((line) => `<p style="${SMALL_STYLE}">${escape(line)}</p>`).join('\n')}`,
    ),
  };
}

const QUOTE_STYLE =
  'font-size:16px;line-height:1.5;color:#353945;margin:0 0 24px;border-left:3px solid #e6e8ec;padding-left:12px;white-space:pre-wrap';

/**
 * Several paragraphs and one button (F6 design 11). A `quote` paragraph is someone else's text,
 * escaped into its own block with a left border; links in it are never made clickable.
 */
export function letterEmail(options: {
  heading: string;
  paragraphs: (string | { quote: string })[];
  action: string;
  url: string;
  footer?: string[];
}) {
  const { heading, paragraphs, action, url, footer = [] } = options;
  const plain = paragraphs.map((p) => (typeof p === 'string' ? p : p.quote));
  return {
    text: [heading, ...plain, `${action}: ${url}`, ...footer].join('\n\n'),
    html: layout(
      heading,
      `${paragraphs
        .map((p) =>
          typeof p === 'string'
            ? `<p style="${TEXT_STYLE}">${escape(p)}</p>`
            : `<p style="${QUOTE_STYLE}">${escape(p.quote)}</p>`,
        )
        .join('\n')}
<p style="margin:0 0 24px"><a href="${escape(url)}" style="${BUTTON_STYLE}">${escape(action)}</a></p>
<p style="${SMALL_STYLE}">Or paste this link into your browser:</p>
<p style="${SMALL_STYLE};word-break:break-all">${escape(url)}</p>
${footer.map((line) => `<p style="${SMALL_STYLE}">${escape(line)}</p>`).join('\n')}`,
    ),
  };
}

/** A message with no button. */
export function noticeEmail(options: { heading: string; message: string; footer?: string[] }) {
  const { heading, message, footer = [] } = options;
  return {
    text: [heading, message, ...footer].join('\n\n'),
    html: layout(
      heading,
      `<p style="${TEXT_STYLE}">${escape(message)}</p>
${footer.map((line) => `<p style="${SMALL_STYLE}">${escape(line)}</p>`).join('\n')}`,
    ),
  };
}

export interface ReceiptContent {
  heading: string;
  /** The first paragraphs, e.g. "Thanks, Priya. Order 1042 is arriving about 7:35–7:45 pm." */
  intro: string[];
  linesHeading: string;
  /** "2 × Gimbap", its extras and note, and "$25.98". */
  lines: { label: string; details: string[]; amount: string }[];
  /** Under the lines, e.g. "Note for the kitchen: More spicy". */
  afterLines: string[];
  /** Subtotal, promo, delivery, tax, tip. `credit` rows (discounts) are green. */
  rows: { label: string; value: string; credit?: boolean }[];
  total: { label: string; value: string };
  /** "Paid with Visa •••• 4242" or the cash sentence. */
  payment: string;
  deliveryHeading: string;
  /** The address line, then smaller lines (instructions, courier call). */
  delivery: { line: string; notes: string[] };
  action: string;
  url: string;
  footer?: string[];
}

const SUBHEADING_STYLE = 'font-size:16px;font-weight:600;color:#141416;margin:24px 0 8px';
const CELL_STYLE = 'font-size:16px;line-height:1.5;color:#23262f;padding:12px 0;vertical-align:top';
const ROW_STYLE = 'border-top:1px dashed #e6e8ec';
const DETAIL_STYLE = 'font-size:14px;line-height:1.5;color:#6b7183';
const BREAKDOWN_LABEL = 'font-size:14px;line-height:1.5;color:#6b7183;padding:6px 0';
const BREAKDOWN_VALUE =
  'font-size:14px;line-height:1.5;color:#23262f;padding:6px 0;text-align:right;white-space:nowrap';
const TOTAL_TABLE = 'width:100%;background:#f4f5f6;border-radius:8px;margin:12px 0 24px';

/**
 * An order receipt (F4 S11.5, design 6.1): the order's lines and breakdown as tables, the
 * payment, the delivery address, one button and the link as text. Names wrap; amounts don't.
 */
export function receiptEmail(content: ReceiptContent) {
  const lines = content.lines
    .map(
      (line) =>
        `<tr style="${ROW_STYLE}"><td style="${CELL_STYLE};overflow-wrap:anywhere">${escape(line.label)}${line.details
          .map((detail) => `<div style="${DETAIL_STYLE}">${escape(detail)}</div>`)
          .join(
            '',
          )}</td><td style="${CELL_STYLE};text-align:right;white-space:nowrap;padding-left:16px">${escape(line.amount)}</td></tr>`,
    )
    .join('\n');
  const rows = content.rows
    .map(
      (row) =>
        `<tr><td style="${BREAKDOWN_LABEL}">${escape(row.label)}</td><td style="${BREAKDOWN_VALUE}${row.credit ? ';color:#03850a' : ''}">${escape(row.value)}</td></tr>`,
    )
    .join('\n');
  const html = layout(
    content.heading,
    `${content.intro.map((p) => `<p style="${TEXT_STYLE}">${escape(p)}</p>`).join('\n')}
<h2 style="${SUBHEADING_STYLE}">${escape(content.linesHeading)}</h2>
<table role="presentation" style="width:100%;border-collapse:collapse">${lines}</table>
${content.afterLines.map((p) => `<p style="${SMALL_STYLE}">${escape(p)}</p>`).join('\n')}
<table role="presentation" style="width:100%;border-collapse:collapse;margin-top:12px">${rows}</table>
<table role="presentation" style="${TOTAL_TABLE}"><tr><td style="font-size:16px;font-weight:500;padding:8px 12px">${escape(content.total.label)}</td><td style="font-size:20px;font-weight:600;padding:8px 12px;text-align:right;white-space:nowrap">${escape(content.total.value)}</td></tr></table>
<p style="${TEXT_STYLE}">${escape(content.payment)}</p>
<h2 style="${SUBHEADING_STYLE}">${escape(content.deliveryHeading)}</h2>
<p style="${TEXT_STYLE};margin-bottom:8px">${escape(content.delivery.line)}</p>
${content.delivery.notes.map((p) => `<p style="${SMALL_STYLE}">${escape(p)}</p>`).join('\n')}
<p style="margin:24px 0"><a href="${escape(content.url)}" style="${BUTTON_STYLE}">${escape(content.action)}</a></p>
<p style="${SMALL_STYLE}">If the button doesn't work, copy this link into your browser:</p>
<p style="${SMALL_STYLE};word-break:break-all"><a href="${escape(content.url)}" style="color:#03850a">${escape(content.url)}</a></p>
${(content.footer ?? []).map((p) => `<p style="${SMALL_STYLE}">${escape(p)}</p>`).join('\n')}`,
  );

  const text = [
    content.heading,
    content.intro.join('\n\n'),
    [
      content.linesHeading,
      ...content.lines.flatMap((line) => [
        `${line.label} — ${line.amount}`,
        ...line.details.map((detail) => `   ${detail}`),
      ]),
      ...content.afterLines,
    ].join('\n'),
    [
      ...content.rows.map((row) => `${row.label}: ${row.value}`),
      `${content.total.label}: ${content.total.value}`,
    ].join('\n'),
    content.payment,
    [content.deliveryHeading, content.delivery.line, ...content.delivery.notes].join('\n'),
    `${content.action}: ${content.url}`,
    ...(content.footer ?? []),
  ].join('\n\n');
  return { text, html };
}
