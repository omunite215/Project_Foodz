import type { PartnerNoticeType } from '@/lib/realtime/events';
import { weekdayDate, longDate } from './text';
import type { IsoDate } from './rules';

/*
 * What partners and applicants are told (F6 design 11): in-app notices and emails. Notice
 * bodies never carry a reviewer's reason or message (design D23); emails carry it as its own
 * escaped paragraph.
 */

export interface NoticeText {
  type: PartnerNoticeType;
  title: string;
  body: string;
}

export const PARTNER_NOTICES = {
  received: {
    type: 'partner.application-received',
    title: 'Application sent',
    body: "We're checking your documents. This usually takes up to 2 working days.",
  },
  sentBack: {
    type: 'partner.sent-back',
    title: 'We need one thing from you',
    body: 'Fix your application so we can decide. Your place in line is kept.',
  },
  approved: {
    type: 'partner.approved',
    title: "You're approved",
    body: 'Open the partner app to go online.',
  },
  rejected: {
    type: 'partner.rejected',
    title: 'About your partner application',
    body: "We couldn't approve your application this time. See the details in the app.",
  },
  reopened: {
    type: 'partner.reopened',
    title: "We're taking another look at your application",
    body: "Your application is being checked again. You don't need to do anything.",
  },
  suspended: {
    type: 'partner.suspended',
    title: 'Your partner account is suspended',
    body: "You can't go online for now. Sign in to see the details.",
  },
  reinstated: {
    type: 'partner.reinstated',
    title: 'You can deliver again',
    body: "Your partner account is active. Go online when you're ready.",
  },
} as const satisfies Record<string, NoticeText>;

/** B8: the automatic offline notices (no email). `time` is "6:42 pm" in store time. */
export const offlineNoticeText = (
  reason: 'no-location' | 'kitchen-closed',
  time: string,
): NoticeText =>
  reason === 'no-location'
    ? {
        type: 'partner.offline-no-location',
        title: 'You went offline',
        body: `We took you offline at ${time} because we hadn't had your location for 10 minutes.`,
      }
    : {
        type: 'partner.offline-kitchen-closed',
        title: 'You went offline',
        body: `Foodz Kitchen closed at ${time}, so we took you offline.`,
      };

// ------------------------------------------------------------------ emails

export type PartnerEmailKind =
  | 'received'
  | 'sent-back'
  | 'approved'
  | 'rejected'
  | 'reopened'
  | 'suspended'
  | 'reinstated';

export interface PartnerEmailFacts {
  firstName: string;
  siteUrl: string;
  /** The reviewer's message or reason as typed, or null. */
  applicantText: string | null;
  reapplyFrom: IsoDate | null;
}

export interface PartnerEmail {
  subject: string;
  heading: string;
  paragraphs: (string | { quote: string })[];
  action: string;
  url: string;
  footer: string[];
}

const QUESTIONS = (site: string) => `Questions? Contact us: ${site}/contact`;
const LOCATION_LINE = "We see your location only while you're online.";

export function partnerEmail(kind: PartnerEmailKind, facts: PartnerEmailFacts): PartnerEmail {
  const { firstName, siteUrl } = facts;
  const app = `${siteUrl}/partner`;
  switch (kind) {
    case 'received':
      return {
        subject: 'We got your application',
        heading: 'We got your application',
        paragraphs: [
          `Thanks, ${firstName}. We're checking your documents, which usually takes up to 2 working days. We'll email you as soon as we've decided.`,
          'You can edit or withdraw your application until then.',
        ],
        action: 'See your application',
        url: app,
        footer: [QUESTIONS(siteUrl)],
      };
    case 'sent-back':
      return {
        subject: 'We need one more thing for your application',
        heading: 'We need one thing from you',
        paragraphs: [
          `Hi ${firstName}, we looked at your application and need one change before we can decide:`,
          { quote: facts.applicantText ?? '' },
          "Being sent back isn't a rejection. Nothing has been deleted, and you keep your place in line.",
        ],
        action: 'Fix it',
        url: app,
        footer: [QUESTIONS(siteUrl)],
      };
    case 'approved':
      return {
        subject: "You're approved to deliver with Foodz",
        heading: "You're approved",
        paragraphs: [
          `Welcome, ${firstName}. Sign in on your phone and open the partner app to go online.`,
          "For your security we've signed you out of Foodz, so you'll sign in once more.",
          'Tip: add it to your home screen.',
        ],
        action: 'Open the partner app',
        url: app,
        footer: [LOCATION_LINE],
      };
    case 'rejected': {
      const date = facts.reapplyFrom;
      return {
        subject: 'About your Foodz partner application',
        heading: "Your application wasn't approved",
        paragraphs: [
          `Hi ${firstName}, we've looked at your application and can't approve it this time.`,
          ...(facts.applicantText
            ? ['Reason:', { quote: facts.applicantText }]
            : ["We can't share more detail here. If you have questions, contact us."]),
          ...(date
            ? [
                `You can apply again from ${weekdayDate(date)}.`,
                `We'll delete your photos and ID details on ${longDate(date)}.`,
              ]
            : []),
        ],
        action: 'See your application',
        url: app,
        footer: [QUESTIONS(siteUrl)],
      };
    }
    case 'reopened':
      return {
        subject: "We're taking another look at your application",
        heading: "We're taking another look",
        paragraphs: [
          `Hi ${firstName}, we've reopened your Foodz partner application and are checking it again. The earlier decision no longer applies, and you don't need to do anything.`,
          "We usually decide within 2 working days, and we'll email you as soon as we have.",
        ],
        action: 'See your application',
        url: app,
        footer: [QUESTIONS(siteUrl)],
      };
    case 'suspended':
      return {
        subject: 'Your Foodz partner account is suspended',
        heading: 'Your partner account is suspended',
        paragraphs: [
          `Hi ${firstName}, we've suspended your Foodz partner account, so you can't go online for now. We've taken you offline and signed you out.`,
          ...(facts.applicantText ? ['Reason:', { quote: facts.applicantText }] : []),
          'If you think this is a mistake, contact us. You can still order food with your account.',
        ],
        action: 'Contact us',
        url: `${siteUrl}/contact`,
        footer: ['Foodz Kitchen, 88 Harbor Street, Boston, MA 02210'],
      };
    default:
      return {
        subject: 'You can deliver with Foodz again',
        heading: 'You can deliver again',
        paragraphs: [
          `Hi ${firstName}, your partner account is active again. You're offline until you choose to go online.`,
        ],
        action: 'Open the partner app',
        url: app,
        footer: [LOCATION_LINE],
      };
  }
}
