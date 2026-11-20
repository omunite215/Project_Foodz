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
