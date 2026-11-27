import { describe, expect, it } from 'vitest';
import { listQueryFromSearch, sendBackInput, type HistoryEntry } from './review-schema';
import {
  type ActionFacts,
  changedSinceLastDecision,
  decidedBySentence,
  flagSentence,
  listCaption,
  reviewActions,
  tabOf,
  waitingOf,
  workingMs,
} from './review-state';

const TZ = 'America/New_York';
const T = new Date('2026-11-20T23:00:00.000Z'); // Fri, Nov 20, 6:00 pm

describe('tabs (A19.1)', () => {
  it('puts sent-back applications under Waiting until they are fixed', () => {
    const base = { status: 'APPLIED' as const, changesRequestedAt: null, fixedAt: null };
    expect(tabOf(base)).toBe('review');
    const sentBack = { ...base, changesRequestedAt: '2026-11-19T15:30:00Z' };
    expect(tabOf(sentBack)).toBe('waiting');
    expect(tabOf({ ...sentBack, fixedAt: '2026-11-20T23:05:00Z' })).toBe('review');
    expect(tabOf({ ...base, status: 'SUSPENDED' })).toBe('suspended');
  });

  it('reads the list state from the address, falling back on nonsense', () => {
    expect(listQueryFromSearch({ tab: 'review', q: '6vh', vehicle: 'car', flags: '1' })).toEqual({
      tab: 'review',
      q: '6vh',
      vehicle: 'CAR',
      flags: true,
      owes: false,
      sort: 'sent',
      dir: 'asc',
      page: 1,
    });
    expect(listQueryFromSearch({ tab: 'nope', q: 'x', page: '-3', sort: 'decided' })).toMatchObject(
      { tab: 'review', q: '', page: 1, sort: 'sent' },
    );
    expect(listQueryFromSearch({ tab: 'approved' })).toMatchObject({
      sort: 'decided',
      dir: 'desc',
    });
    // F9 A57: the money sorts and the "Owes cash" chip live in the address too.
    expect(listQueryFromSearch({ tab: 'approved', sort: 'cash', owes: '1' })).toMatchObject({
      sort: 'cash',
      owes: true,
    });
    expect(listQueryFromSearch({ tab: 'review', sort: 'cash' }).sort).toBe('sent');
  });

  it('captions the table for screen readers (A32.5)', () => {
    expect(listCaption('review', 'sent', 'asc', 2)).toBe(
      'Applications to review, oldest first, 2 results',
    );
    expect(listCaption('all', 'name', 'asc', 1)).toBe('All applications, name A to Z, 1 result');
  });
});

describe('waiting (A19.4, U33)', () => {
  it('turns Sam red and Ana amber with fresh fixtures', () => {
    expect(waitingOf('2026-11-17T14:15:00Z', T, TZ)).toEqual({
      tone: 'red',
      words: 'Over 2 working days',
      detail: 'waiting 3 days',
    });
    expect(waitingOf('2026-11-19T22:40:00Z', T, TZ)).toEqual({
      tone: 'amber',
      words: 'Waiting 1 day',
      detail: null,
    });
  });

  it('counts hours and minutes under a day', () => {
    expect(waitingOf('2026-11-20T14:00:00Z', T, TZ)).toMatchObject({
      tone: 'normal',
      words: 'Waiting 9 h',
    });
    expect(waitingOf('2026-11-20T22:35:00Z', T, TZ).words).toBe('Waiting 25 min');
  });

  it("doesn't count the weekend toward the tone", () => {
    const monday9am = new Date('2026-11-23T14:00:00Z');
    // Fri 5 pm to Mon 9 am: 7 h on Friday and 9 h on Monday.
    expect(workingMs('2026-11-20T22:00:00Z', monday9am, TZ)).toBe(16 * 3600 * 1000);
    expect(waitingOf('2026-11-20T22:00:00Z', monday9am, TZ)).toMatchObject({
      tone: 'normal',
      words: 'Waiting 2 days',
    });
  });

  it('copes with the clocks changing (Nov 1, 2026)', () => {
    // Fri 8 am EDT to Tue 7 am EST: 16 h + Monday's 24 h + 7 h; the 25-hour Sunday is skipped.
    const tuesday = new Date('2026-11-03T12:00:00Z');
    expect(workingMs('2026-10-30T12:00:00Z', tuesday, TZ)).toBe(47 * 3600 * 1000);
  });
});

const names = (states: ReturnType<typeof reviewActions>) =>
  states.map((state) => `${state.action}:${state.display}${state.enabled ? '' : ':off'}`);

describe('decisions per role (design 8.2, A24.5, A25.4, A25.5, A28.3)', () => {
  const ana: ActionFacts = {
    status: 'APPLIED',
    waitingForApplicant: false,
    sentBackOn: null,
    firstName: 'Ana',
    banned: false,
    isDemoPartner: false,
    filesDeletedOn: null,
  };
  const support = { role: 'support' as const, readOnly: false, stepUpFresh: false };
  const admin = { role: 'admin' as const, readOnly: false, stepUpFresh: true };
  const demo = { role: 'admin' as const, readOnly: true, stepUpFresh: false };

  it('offers approve, send back and reject in that order, with a code for approve', () => {
    const actions = reviewActions(ana, support);
    expect(names(actions)).toEqual(['approve:button', 'sendBack:button', 'reject:button']);
    expect(actions[0]?.stepUp).toBe(true);
    expect(reviewActions(ana, admin)[0]?.stepUp).toBe(false);
  });

  it('replaces Send back with a line while waiting for Kwame', () => {
    const kwame = {
      ...ana,
      firstName: 'Kwame',
      waitingForApplicant: true,
      sentBackOn: 'Thu, Nov 19',
    };
    const actions = reviewActions(kwame, support);
    expect(names(actions)).toEqual(['approve:button', 'reject:button', 'sendBack:line:off']);
    expect(actions[2]?.reason).toBe('Sent back Thu, Nov 19. Waiting for Kwame.');
  });

  it('lets SUPPORT suspend but only ADMIN reinstate', () => {
    expect(names(reviewActions({ ...ana, status: 'APPROVED' }, support))).toEqual([
      'suspend:button',
    ]);
    const victor = { ...ana, status: 'SUSPENDED' as const, firstName: 'Victor' };
    expect(reviewActions(victor, support)).toEqual([
      expect.objectContaining({
        display: 'line',
        reason: 'Only an admin can reinstate a partner.',
      }),
    ]);
    expect(names(reviewActions(victor, admin))).toEqual(['reinstate:button']);
  });

  it('never offers to suspend Nora (banned) or Riley (demo partner)', () => {
    const approved = { ...ana, status: 'APPROVED' as const };
    expect(reviewActions({ ...approved, banned: true }, admin)[0]?.reason).toBe(
      'Bans are managed on the account, not here.',
    );
    expect(reviewActions({ ...approved, isDemoPartner: true }, admin)[0]?.reason).toBe(
      "The demo partner can't be suspended. It resets every night.",
    );
  });

  it('lets only ADMIN reopen, and nobody once the files are gone', () => {
    const jonas = { ...ana, status: 'REJECTED' as const, firstName: 'Jonas' };
    expect(reviewActions(jonas, support)).toEqual([]);
    expect(names(reviewActions(jonas, admin))).toEqual(['reopen:button']);
    const mei = { ...jonas, firstName: 'Mei', filesDeletedOn: 'Nov 19' };
    expect(reviewActions(mei, admin)[0]?.reason).toBe(
      "Mei's photos and ID details were deleted on Nov 19, so this can't be reopened. Mei can apply again from the account.",
    );
  });

  it("shows the demo admin ADMIN's buttons, all disabled", () => {
    const actions = reviewActions(ana, demo);
    expect(names(actions)).toEqual([
      'approve:button:off',
      'sendBack:button:off',
      'reject:button:off',
    ]);
    expect(actions.every((state) => state.reason === 'Read-only in the demo')).toBe(true);
    expect(names(reviewActions({ ...ana, status: 'SUSPENDED' }, demo))).toEqual([
      'reinstate:button:off',
    ]);
  });
});

describe('flags (A22, design 8.4)', () => {
  const victor = {
    partnerId: '00000000-0000-7000-8000-000000000001',
    name: 'Victor Hale',
    status: 'SUSPENDED' as const,
    banned: false,
    decidedAt: '2026-11-19T21:00:00Z',
  };
  const nora = {
    partnerId: '00000000-0000-7000-8000-000000000002',
    name: 'Nora Quinn',
    status: 'APPROVED' as const,
    banned: true,
    decidedAt: '2026-09-14T14:00:00Z',
  };

  it("words Sam's three flags", () => {
    expect(flagSentence({ kind: 'samePlate', plate: '6VH 450', others: [victor] }, TZ)).toBe(
      "Plate 6VH 450 is also on Victor Hale's application (Suspended Thu, Nov 19, 2026)",
    );
    expect(flagSentence({ kind: 'sameIdNumber', others: [nora] }, TZ)).toBe(
      "The same ID number is on Nora Quinn's application (Approved · account banned)",
    );
    expect(
      flagSentence(
        {
          kind: 'expiresSoon',
          documentType: 'DRIVER_LICENSE',
          expiresOn: '2026-12-10',
          inDays: 20,
        },
        TZ,
      ),
    ).toBe("License expires Dec 10, 2026, in 20 days. They'll need to send a new one before then.");
  });

  it('counts several other applications', () => {
    expect(
      flagSentence({ kind: 'samePlate', plate: '6VH 450', others: [victor, { ...nora }] }, TZ),
    ).toBe('Plate 6VH 450 is also on 2 other applications');
  });

  it('names nobody for the demo admin when a real person is involved (A22.8)', () => {
    const hidden = { ...victor, partnerId: null, name: null };
    expect(flagSentence({ kind: 'samePlate', plate: null, others: [hidden] }, TZ)).toBe(
      'Plate is also on 1 other application.',
    );
  });

  it("words Mei's earlier rejection", () => {
    expect(
      flagSentence(
        { kind: 'appliedBefore', rejectedAt: '2026-10-20T15:00:00Z', reasonGiven: false },
        TZ,
      ),
    ).toBe('Applied before: rejected Tue, Oct 20, 2026 · no reason given');
  });
});

const entry = (type: HistoryEntry['type'], parts: HistoryEntry['changedParts'] = []) =>
  ({
    id: type,
    type,
    at: '2026-11-19T00:00:00Z',
    actor: { kind: 'applicant' },
    applicantText: null,
    staffNote: null,
    changedParts: parts,
    masked: false,
  }) satisfies HistoryEntry;

describe('changes since the last decision (A20.10, A24.4)', () => {
  it("marks Kwame's new ID photo after the send back, and nothing before it", () => {
    const history = [
      entry('applied'),
      entry('updated', ['plate']),
      entry('sent-back'),
      entry('fixed', ['idPhoto']),
    ];
    expect(changedSinceLastDecision(history)).toEqual(['idPhoto']);
  });

  it('says who decided first (A26.3)', () => {
    expect(decidedBySentence('approved', 'Morgan Diaz', '2026-11-20T23:04:00Z', TZ)).toBe(
      'Morgan Diaz approved this application at 6:04 pm.',
    );
  });
});

describe('reviewer text (A24.2, A20.9)', () => {
  const base = { partnerId: '00000000-0000-7000-8000-000000000003', expectedVersion: 4 };

  it('keeps line breaks and markup characters exactly, as plain text', () => {
    const parsed = sendBackInput.parse({ ...base, message: '  <b>blurry</b>\r\nTry again​ ' });
    expect(parsed.message).toBe('<b>blurry</b>\nTry again');
  });

  it('needs a message and keeps it under 500 characters', () => {
    expect(sendBackInput.safeParse({ ...base, message: '   ' }).success).toBe(false);
    expect(sendBackInput.safeParse({ ...base, message: 'x'.repeat(501) }).success).toBe(false);
    expect(sendBackInput.safeParse({ ...base, message: 'x'.repeat(500) }).success).toBe(true);
  });

  it('refuses extra fields', () => {
    expect(
      sendBackInput.safeParse({ ...base, message: 'Fix it', status: 'APPROVED' }).success,
    ).toBe(false);
  });
});
