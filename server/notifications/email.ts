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

/** A plain transactional layout: heading, message, one button. */
export function actionEmail(options: {
  heading: string;
  message: string;
  action: string;
  url: string;
}) {
  const { heading, message, action, url } = options;
  return {
    text: `${heading}\n\n${message}\n\n${action}: ${url}`,
    html: `<!doctype html><html><body style="font-family:Poppins,Arial,sans-serif;background:#fcfcfd;padding:32px;color:#23262f">
<table role="presentation" width="100%" style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;padding:32px">
<tr><td><h1 style="font-family:Alice,Georgia,serif;font-weight:400;font-size:28px;margin:0 0 16px">${escape(heading)}</h1>
<p style="font-size:16px;line-height:1.5;color:#353945;margin:0 0 24px">${escape(message)}</p>
<a href="${escape(url)}" style="display:inline-block;background:#04b90b;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:500">${escape(action)}</a>
</td></tr></table></body></html>`,
  };
}
