import type { PartnerStatus, VehicleType } from '@/server/db/enums';
import type {
  FlagKind,
  HistoryEntry,
  PartnerTab,
  ReviewActor,
  ReviewAction,
} from '@/server/modules/partners/review-schema';
import {
  addDays,
  type ChangedPart,
  changedPartsWords,
  type IdDocumentType,
} from '@/server/modules/partners/rules';
import {
  DOCUMENT_NOUN,
  DOCUMENT_WORDS,
  longDate,
  storeDate,
  weekdayDate,
} from '@/server/modules/partners/text';
import { boardClock } from '@/lib/board/text';

/*
 * The staff screens' words (F6 design 7 to 10, "Copy"), worked out in the browser from what
 * the server sent. Staff copy never says "he" or "she": the data has no gender (D2). US
 * spelling (lead decision).
 */

// ------------------------------------------------------------------ counts and tabs

export const TAB_LABELS: Record<PartnerTab, string> = {
  review: 'To review',
  waiting: 'Waiting for the applicant',
  approved: 'Approved',
  suspended: 'Suspended',
  rejected: 'Rejected',
  all: 'All',
};

/** "1 application", "2 applications". */
export const applicationsCount = (count: number) =>
  `${count} ${count === 1 ? 'application' : 'applications'}`;

/** A tab's accessible name: "To review, 2 applications". */
export const tabName = (tab: PartnerTab, count: number) =>
  `${TAB_LABELS[tab]}, ${applicationsCount(count)}`;

/** The phone's menu button: "Show: To review (2)". */
export const stateMenuText = (tab: PartnerTab, count: number) =>
  `Show: ${TAB_LABELS[tab]} (${count})`;

/** Its name: "Show: To review, 2 applications. Change state". */
export const stateMenuName = (tab: PartnerTab, count: number) =>
  `Show: ${tabName(tab, count)}. Change state`;

/** Read once after the results change: "2 applications", "No applications". */
export const resultCountText = (total: number) =>
  total === 0 ? 'No applications' : applicationsCount(total);

/** "Showing 1–25 of 62". */
export function showingText(page: number, pageSize: number, total: number): string {
  if (total === 0) return '';
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return `Showing ${from}–${to} of ${total}`;
}

export const pageText = (page: number, pageCount: number) => `Page ${page} of ${pageCount}`;

// ------------------------------------------------------------------ the sidebar badge (7.1)

export const badgeText = (count: number) => (count > 99 ? '99+' : String(count));

/** Added to the link's name: "Partners, 2 applications to review". */
export const badgeSrText = (count: number) => `, ${applicationsCount(count)} to review`;

export const badgeTooltip = (count: number) =>
  count > 0 ? `Partners · ${count} to review` : 'Partners';

// ------------------------------------------------------------------ dates

const UTC = { timeZone: 'UTC' } as const;

/** "Thu, Dec 17" for a calendar date. */
export const weekdayShort = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', {
    ...UTC,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

/** "Dec 17" for a calendar date. */
export const monthDay = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', {
    ...UTC,
    month: 'short',
    day: 'numeric',
  });

/** "Thu, Nov 19" for an instant, in the store's zone. */
export const dayOf = (iso: string, timeZone: string) =>
  new Date(iso).toLocaleDateString('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

/** "Nov 6, 2026" for an instant, in the store's zone. */
export const longDateOf = (iso: string, timeZone: string) => longDate(storeDate(iso, timeZone));

/** "Thu, Nov 19, 2026" for an instant, in the store's zone. */
export const weekdayDateOf = (iso: string, timeZone: string) =>
  weekdayDate(storeDate(iso, timeZone));

/** "6:00 pm", "9:15 am": staff times always show their minutes (F5 rule). */
export const clockOf = (iso: string, timeZone: string) => boardClock(iso, timeZone);

/** "Tue, Nov 17 · 9:15 am". */
export const dateTime = (iso: string, timeZone: string) =>
  `${dayOf(iso, timeZone)} · ${clockOf(iso, timeZone)}`;

// ------------------------------------------------------------------ table cells (7.5)

/** "Thu, Nov 19 by Morgan Diaz"; the day alone when the name is withheld. */
export const decidedCell = (at: string, byName: string | null, timeZone: string) =>
  byName ? `${dayOf(at, timeZone)} by ${byName}` : dayOf(at, timeZone);

/** "Waiting for Kwame 1 day" from the server's "Waiting 1 day". */
export const waitingForText = (firstName: string, words: string) =>
  words.startsWith('Waiting ')
    ? `Waiting for ${firstName} ${words.slice('Waiting '.length)}`
    : words;

export const reapplyCell = (rejected: { reapplyFrom: string; canReapplyNow: boolean }) =>
  rejected.canReapplyNow
    ? { text: 'Now', sr: 'Can apply again now' }
    : {
        text: `From ${weekdayShort(rejected.reapplyFrom)}`,
        sr: `Can apply again from ${weekdayShort(rejected.reapplyFrom)}`,
      };

export const documentsCell = (rejected: { reapplyFrom: string; filesDeletedOn: string | null }) =>
  rejected.filesDeletedOn
    ? {
        text: `Deleted ${monthDay(rejected.filesDeletedOn)}`,
        sr: `Documents deleted ${monthDay(rejected.filesDeletedOn)}`,
      }
    : {
        text: `Kept until ${monthDay(rejected.reapplyFrom)}`,
        sr: `Documents kept until ${monthDay(rejected.reapplyFrom)}`,
      };

export const FLAG_CHIP_LABELS: Record<FlagKind, string> = {
  samePlate: 'Plate also used',
  sameIdNumber: 'ID also used',
  expiresSoon: 'Expires soon',
  appliedBefore: 'Applied before',
};

export const flagsCount = (count: number) => `${count} ${count === 1 ? 'flag' : 'flags'}`;

/** "Plate also used" → "plate also used"; "ID also used" keeps its capitals. */
const lowerFirst = (text: string) =>
  /^[A-Z]{2}/.test(text) ? text : `${text.charAt(0).toLowerCase()}${text.slice(1)}`;

/** "3 flags: plate also used, ID also used, expires soon". */
export const flagsSrText = (kinds: readonly FlagKind[]) =>
  `${flagsCount(kinds.length)}: ${kinds.map((kind) => lowerFirst(FLAG_CHIP_LABELS[kind])).join(', ')}`;

export const VEHICLE_FILTER_LABELS: Record<VehicleType, string> = {
  BICYCLE: 'Bicycle or e-bike',
  SCOOTER: 'Scooter or moped',
  MOTORBIKE: 'Motorbike',
  CAR: 'Car',
};

/** The staff status chip's words (design 8.2), by tab. */
export const STATUS_WORDS: Record<Exclude<PartnerTab, 'all'>, string> = {
  review: 'To review',
  waiting: 'Waiting for the applicant',
  approved: 'Approved',
  suspended: 'Suspended',
  rejected: 'Rejected',
};

// ------------------------------------------------------------------ who did it (A31.1)

const ROLE_WORDS = { support: 'Support', admin: 'Admin' } as const;

/** "Morgan Diaz (Support)", "Applicant", "Foodz (automatic)". */
export function actorLabel(actor: ReviewActor): string {
  if (actor.kind === 'applicant') return 'Applicant';
  if (actor.kind === 'system') return 'Foodz (automatic)';
  return `${actor.name ?? 'A staff member'} (${ROLE_WORDS[actor.role]})`;
}

/** The person's name, or null when withheld from the demo admin. */
export const actorName = (actor: ReviewActor): string | null =>
  actor.kind === 'staff' ? actor.name : null;

// ------------------------------------------------------------------ the history (8.8)

export interface HistoryText {
  sentence: string;
  details: string | null;
  blocks: { label: string; text: string }[];
}

const partsSuffix = (parts: readonly ChangedPart[]) =>
  parts.length ? `: ${changedPartsWords(parts)}` : '';

/** One history entry in words. Values are never shown, only which parts changed. */
export function historyText(entry: HistoryEntry): HistoryText {
  const by = actorLabel(entry.actor);
  const blocks: HistoryText['blocks'] = [];
  let details: string | null = null;
  const reason = (label: string, none: string) => {
    if (entry.masked) details = 'Hidden for demo staff';
    else if (entry.applicantText) blocks.push({ label, text: entry.applicantText });
    else details = none;
  };
  let sentence: string;
  switch (entry.type) {
    case 'applied':
      sentence = 'Applied';
      details = 'Applicant';
      break;
    case 'updated':
      sentence = `Updated by the applicant${partsSuffix(entry.changedParts)}`;
      break;
    case 'fixed':
      sentence = `Fixed by the applicant${partsSuffix(entry.changedParts)}`;
      break;
    case 'sent-back':
      sentence = `Sent back by ${by}`;
      if (entry.masked) details = 'Hidden for demo staff';
      else if (entry.applicantText) {
        blocks.push({ label: 'Message to the applicant:', text: entry.applicantText });
      }
      break;
    case 'approved':
      sentence = `Approved by ${by}`;
      break;
    case 'rejected':
      sentence = `Rejected by ${by}`;
      reason('Reason given:', 'No reason given to the applicant');
      break;
    case 'reopened':
      sentence = `Reopened by ${by}`;
      break;
    case 'suspended':
      sentence = `Suspended by ${by}`;
      reason('Reason for the partner:', 'No reason given to the partner');
      break;
    case 'taken-offline':
      sentence = 'Taken offline by the suspension';
      details = 'Foodz (automatic)';
      break;
    case 'reinstated':
      sentence = `Reinstated by ${by}`;
      break;
    default:
      sentence = 'Photos and ID details deleted, 30 days after the decision';
      details = 'Foodz (automatic)';
      break;
  }
  if (entry.staffNote && !entry.masked)
    blocks.push({ label: 'Staff note:', text: entry.staffNote });
  return { sentence, details, blocks };
}

/** "Tue, Nov 17 · 9:15 am": minutes are enough for decisions days apart (D36). */
export const historyTime = (iso: string, timeZone: string) => dateTime(iso, timeZone);

// ------------------------------------------------------------------ the application page

/** "Profile photo of Sam Rivera". */
export const photoAlt = (name: string) => `Profile photo of ${name}`;

/** "driver's license", "state ID card", "passport". */
export const documentLower = (type: IdDocumentType) => lowerFirst(DOCUMENT_WORDS[type]);

/** "Front of Sam Rivera's driver's license" (never the number, A21.1). */
export const idAlt = (name: string, type: IdDocumentType) =>
  `Front of ${name}'s ${documentLower(type)}`;

/** "Front of driver's license · ending 5521". */
export const idCaption = (type: IdDocumentType, last4: string | null) =>
  `Front of ${documentLower(type)}${last4 ? ` · ending ${last4}` : ''}`;

/** "Call Sam Rivera, (617) 555-0188". */
export const callName = (name: string, display: string) => `Call ${name}, ${display}`;

/** "Customer since Nov 16, 2026 · no orders" (· 1 order, · 3 orders). */
export function customerLine(since: string, orderCount: number, timeZone: string): string {
  const orders =
    orderCount === 0 ? 'no orders' : `${orderCount} ${orderCount === 1 ? 'order' : 'orders'}`;
  return `Customer since ${longDateOf(since, timeZone)} · ${orders}`;
}

/** "Partner Terms version 1 · Tue, Nov 17 · 9:15 am". */
export const agreedLine = (version: number, at: string, timeZone: string) =>
  `Partner Terms version ${version} · ${dateTime(at, timeZone)}`;

/** "in 20 days" beside an expiry within 30 days. */
export const inDaysText = (days: number) => `in ${days} ${days === 1 ? 'day' : 'days'}`;

/** The six "What to check" lines (design 8.5); no license line for a bicycle (D32). */
export function whatToCheck(input: {
  name: string;
  last4: string | null;
  vehicle: VehicleType;
}): string[] {
  return [
    'The face in the profile photo matches the photo on the ID.',
    `The name on the ID matches ${input.name}.`,
    input.last4 ? `The ID ends in ${input.last4} and hasn't expired.` : "The ID hasn't expired.",
    'The date of birth makes them 18 or older.',
    ...(input.vehicle === 'BICYCLE'
      ? []
      : ["For a scooter, motorbike or car, the ID is a driver's license."]),
    'The picture is sharp and shows all four corners.',
  ];
}

/** "Sent back Thu, Nov 19 · 10:30 am by Morgan Diaz (Support)". */
export const sentBackLine = (at: string, by: ReviewActor, timeZone: string) =>
  `Sent back ${dateTime(at, timeZone)} by ${actorLabel(by)}`;

/** "Rejected Tue, Nov 17 · 11:00 am by Foodz Admin (Admin)". */
export function decidedLine(
  type: 'approved' | 'rejected' | 'suspended',
  at: string,
  by: ReviewActor,
  timeZone: string,
): string {
  const word = { approved: 'Approved', rejected: 'Rejected', suspended: 'Suspended' }[type];
  const when = type === 'approved' ? dayOf(at, timeZone) : dateTime(at, timeZone);
  return `${word} ${when} by ${actorLabel(by)}`;
}

/** "Kwame changed the application after it was sent back: new ID photo." */
export const fixedLine = (firstName: string, parts: readonly ChangedPart[]) =>
  `${firstName} changed the application after it was sent back${partsSuffix(parts)}.`;

export const CHANGED_PART_SECTIONS: Record<
  ChangedPart,
  'photo' | 'idPhoto' | 'vehicle' | 'id' | 'applicant'
> = {
  photo: 'photo',
  idPhoto: 'idPhoto',
  vehicle: 'vehicle',
  plate: 'vehicle',
  idType: 'id',
  idNumber: 'id',
  idExpiry: 'id',
  phone: 'applicant',
};

// ------------------------------------------------------------------ freshness and conflicts

/** The page's banner when the applicant edited (design 8.9). */
export const editedBanner = (
  name: string,
  at: string,
  parts: readonly ChangedPart[],
  timeZone: string,
) =>
  `${name} changed the application at ${clockOf(at, timeZone)}${partsSuffix(parts)}. The changes are marked below.`;

/** The dialog's alert when the applicant edited after it opened (design 10.9). */
export const editedConflict = (
  name: string,
  at: string,
  parts: readonly ChangedPart[],
  timeZone: string,
) =>
  `${name} changed the application at ${clockOf(at, timeZone)}, after you opened it${partsSuffix(parts)}. Check the changes before you decide.`;

export type DecidedHow =
  | 'approved'
  | 'rejected'
  | 'sent-back'
  | 'suspended'
  | 'reinstated'
  | 'reopened';

/** "Morgan Diaz approved this application at 6:04 pm." */
export const decidedConflict = (how: DecidedHow, by: ReviewActor, at: string, timeZone: string) =>
  `${actorName(by) ?? 'Someone'} ${how === 'sent-back' ? 'sent back' : how} this application at ${clockOf(at, timeZone)}.`;

export const goneText = (
  how: 'withdrawn' | 'account-deleted',
  name: string,
  at: string,
  timeZone: string,
) =>
  how === 'withdrawn'
    ? `${name} withdrew the application at ${clockOf(at, timeZone)}.`
    : `The applicant deleted their Foodz account at ${clockOf(at, timeZone)}.`;

// ------------------------------------------------------------------ decisions (design 10)

export const DIALOG_TITLES: Record<ReviewAction, (name: string) => string> = {
  approve: (name) => `Approve ${name}?`,
  sendBack: (name) => `Send ${name}'s application back?`,
  reject: (name) => `Reject ${name}'s application?`,
  suspend: (name) => `Suspend ${name}?`,
  reinstate: (name) => `Reinstate ${name}?`,
  reopen: (name) => `Reopen ${name}'s application?`,
};

export const ACTION_LABELS: Record<ReviewAction, string> = {
  approve: 'Approve',
  sendBack: 'Send back for changes',
  reject: 'Reject',
  suspend: 'Suspend',
  reinstate: 'Reinstate',
  reopen: 'Reopen application',
};

export const approveOutcome = (first: string) => [
  `${first} becomes a partner and can go online.`,
  `We'll email ${first} and sign them out of Foodz, so they sign in again to open the partner app.`,
  `${first} can still order food.`,
];

export const sendBackHint = (first: string) =>
  `${first} reads this exactly as you type it, by email and in the app.`;

export const sendBackOutcome = (first: string) =>
  `${first} keeps the same place in the queue. The application waits under Waiting for the applicant and comes back here when ${first} saves a fix.`;

export const rejectHint = (first: string) =>
  `${first} reads this exactly as you type it. Leave it empty to give no reason.`;

export const sendBackInsteadText = (first: string) =>
  `Could a new photo or a corrected detail fix this? Send it back instead, so ${first} doesn't wait 30 days.`;

/** The day a rejection made now lets them apply again: the store's today + 30. */
export const reapplyFromToday = (now: Date, timeZone: string) =>
  addDays(storeDate(now, timeZone), 30);

export const rejectOutcome = (first: string, reapplyFrom: string) => [
  `${first} can apply again from ${weekdayDate(reapplyFrom)}. ${first}'s photos and ID details are deleted that day. We'll email ${first}.`,
  'Only an admin can reopen it before then.',
];

export const suspendReasonLabel = (first: string) => `Reason for ${first} (optional)`;

export const suspendHint = (first: string) =>
  `${first} reads this on the suspension screen and in the email.`;

export const suspendOutcome = (first: string, online: boolean) => [
  online
    ? `${first} is online now and will be taken offline at once and signed out on every device.`
    : `${first} is offline.`,
  `They can't go online until an admin reinstates them. They can still order food. We'll email ${first}.`,
];

export const reinstateOutcome = (first: string) =>
  `${first} can go online again, and stays offline until choosing to go online. We'll email ${first}.`;

export const reopenOutcome = (first: string) =>
  `It goes back to To review at its original place. ${first} no longer sees the rejection, and we'll email ${first} that we're looking at it again.`;

export const STEP_UP_HINT =
  'We ask for a code before changing who can deliver, at most every 10 minutes.';
export const STEP_UP_PROMPT = 'Enter a code from your authenticator app to continue.';

export const SEND_BACK_STARTERS = [
  'The photo of your ID is blurry. Please take a new one in good light, with all four corners showing.',
  "Your profile photo doesn't show your face clearly. Please take a new one without sunglasses.",
  "The name on your ID doesn't match your account. Please check the name on your account.",
] as const;

export const REJECT_STARTERS = [
  "We couldn't verify your identity from the documents you sent.",
  "We couldn't match the face in your photo to your ID.",
  'You need to be 18 or older to deliver with Foodz.',
] as const;

/** A starter fills an empty field, or adds a line; typed text is never replaced (D28). */
export const withStarter = (value: string, starter: string) =>
  value.trim() ? `${value.replace(/\s+$/, '')}\n${starter}` : starter;

// ------------------------------------------------------------------ refusals

export const idExpiredRefusal = (first: string, type: IdDocumentType, expiredOn: string) =>
  `${first}'s ${DOCUMENT_NOUN[type]} expired on ${longDate(expiredOn)}. Send the application back to ask for a new one.`;

export const imageNotReadyRefusal = (
  first: string,
  image: 'photo' | 'idFront',
  kind: 'checking' | 'missing',
) =>
  kind === 'checking'
    ? `${first}'s new ${image === 'photo' ? 'photo' : 'ID photo'} is still being checked. Try again in a minute.`
    : `The ${image === 'photo' ? 'profile photo' : 'ID photo'} is missing from storage. Send the application back to ask for a new one.`;

export const alreadySentBackRefusal = (first: string) =>
  `This application was already sent back. It's waiting for ${first}.`;

export const filesDeletedRefusal = (first: string, deletedOn: string) =>
  `${first}'s photos and ID details were deleted on ${monthDay(deletedOn)}, so this can't be reopened. ${first} can apply again from the account.`;

export const BANNED_APPROVE = "This account is banned, so it can't be approved.";
export const BANNED_SUSPEND = 'This account is banned. Bans are managed on the account, not here.';
export const DEMO_PARTNER_REFUSAL = "The demo partner can't be suspended. It resets every night.";

// ------------------------------------------------------------------ result line (8.10)

export function resultText(
  action: ReviewAction,
  name: string,
  first: string,
  wasOnline: boolean | null,
): string {
  switch (action) {
    case 'approve':
      return `${name} is approved. We've emailed ${first}.`;
    case 'sendBack':
      return `Sent back to ${name}. We've emailed ${first}.`;
    case 'reject':
      return `${name}'s application is rejected. We've emailed ${first}.`;
    case 'suspend':
      return wasOnline
        ? `${name} is suspended and was taken offline. We've emailed ${first}.`
        : `${name} is suspended and offline. We've emailed ${first}.`;
    case 'reinstate':
      return `${name} is reinstated. We've emailed ${first}.`;
    default:
      return `${name}'s application is back in To review. We've emailed ${first}.`;
  }
}

/** Approve, send back and reject point to the oldest application left to review. */
export const showsNext = (action: ReviewAction) =>
  action === 'approve' || action === 'sendBack' || action === 'reject';

export const nextText = (name: string) => `Next to review: ${name}`;

// ------------------------------------------------------------------ status

export const statusTab = (status: PartnerStatus, waiting: boolean): Exclude<PartnerTab, 'all'> =>
  status === 'APPLIED'
    ? waiting
      ? 'waiting'
      : 'review'
    : status === 'APPROVED'
      ? 'approved'
      : status === 'SUSPENDED'
        ? 'suspended'
        : 'rejected';
