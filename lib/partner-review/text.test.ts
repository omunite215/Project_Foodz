import { describe, expect, it } from 'vitest';
import type { HistoryEntry } from '@/server/modules/partners/review-schema';
import {
  actorLabel,
  badgeSrText,
  badgeText,
  badgeTooltip,
  decidedCell,
  decidedLine,
  documentsCell,
  editedBanner,
  editedConflict,
  filesDeletedRefusal,
  flagsSrText,
  goneText,
  historyText,
  idAlt,
  idCaption,
  idExpiredRefusal,
  imageNotReadyRefusal,
  reapplyCell,
  reapplyFromToday,
  rejectOutcome,
  resultCountText,
  resultText,
  sentBackLine,
  showingText,
  stateMenuName,
  stateMenuText,
  suspendOutcome,
  tabName,
  waitingForText,
  whatToCheck,
  withStarter,
} from './text';

const TZ = 'America/New_York';
const morgan = { kind: 'staff', name: 'Morgan Diaz', role: 'support' } as const;
const admin = { kind: 'staff', name: 'Foodz Admin', role: 'admin' } as const;

const entry = (patch: Partial<HistoryEntry>): HistoryEntry => ({
  id: 'e1',
  type: 'applied',
  at: '2026-11-17T14:15:00Z',
  actor: { kind: 'applicant' },
  applicantText: null,
  staffNote: null,
  changedParts: [],
  masked: false,
  ...patch,
});

describe('list words', () => {
  it('names tabs and the phone menu with their counts', () => {
    expect(tabName('review', 2)).toBe('To review, 2 applications');
    expect(tabName('waiting', 1)).toBe('Waiting for the applicant, 1 application');
    expect(stateMenuText('review', 2)).toBe('Show: To review (2)');
    expect(stateMenuName('review', 2)).toBe('Show: To review, 2 applications. Change state');
  });

  it('counts results and pages', () => {
    expect(resultCountText(0)).toBe('No applications');
    expect(resultCountText(1)).toBe('1 application');
    expect(showingText(1, 25, 62)).toBe('Showing 1–25 of 62');
    expect(showingText(3, 25, 62)).toBe('Showing 51–62 of 62');
    expect(showingText(1, 25, 2)).toBe('Showing 1–2 of 2');
    expect(showingText(1, 25, 0)).toBe('');
  });

  it('words the sidebar badge', () => {
    expect(badgeText(2)).toBe('2');
    expect(badgeText(120)).toBe('99+');
    expect(badgeSrText(2)).toBe(', 2 applications to review');
    expect(badgeSrText(1)).toBe(', 1 application to review');
    expect(badgeTooltip(2)).toBe('Partners · 2 to review');
  });

  it('words the decided, waiting, reapply and documents cells', () => {
    expect(decidedCell('2026-11-19T21:00:00Z', 'Morgan Diaz', TZ)).toBe(
      'Thu, Nov 19 by Morgan Diaz',
    );
    expect(decidedCell('2026-11-19T21:00:00Z', null, TZ)).toBe('Thu, Nov 19');
    expect(waitingForText('Kwame', 'Waiting 1 day')).toBe('Waiting for Kwame 1 day');
    expect(reapplyCell({ reapplyFrom: '2026-12-17', canReapplyNow: false })).toEqual({
      text: 'From Thu, Dec 17',
      sr: 'Can apply again from Thu, Dec 17',
    });
    expect(reapplyCell({ reapplyFrom: '2026-11-19', canReapplyNow: true }).text).toBe('Now');
    expect(documentsCell({ reapplyFrom: '2026-12-17', filesDeletedOn: null }).text).toBe(
      'Kept until Dec 17',
    );
    expect(documentsCell({ reapplyFrom: '2026-11-19', filesDeletedOn: '2026-11-19' })).toEqual({
      text: 'Deleted Nov 19',
      sr: 'Documents deleted Nov 19',
    });
  });

  it('reads the narrow flags chip in full', () => {
    expect(flagsSrText(['samePlate', 'sameIdNumber', 'expiresSoon'])).toBe(
      '3 flags: plate also used, ID also used, expires soon',
    );
  });
});

describe('history', () => {
  it('names who did it, without he or she', () => {
    expect(actorLabel(morgan)).toBe('Morgan Diaz (Support)');
    expect(actorLabel({ kind: 'applicant' })).toBe('Applicant');
    expect(actorLabel({ kind: 'system' })).toBe('Foodz (automatic)');
  });

  it('words each entry, with parts but never values', () => {
    expect(historyText(entry({})).sentence).toBe('Applied');
    expect(
      historyText(entry({ type: 'updated', changedParts: ['idPhoto', 'plate'] })).sentence,
    ).toBe('Updated by the applicant: new ID photo, plate');
    const sentBack = historyText(
      entry({ type: 'sent-back', actor: morgan, applicantText: 'Blurry ID.', staffNote: 'Hm' }),
    );
    expect(sentBack.sentence).toBe('Sent back by Morgan Diaz (Support)');
    expect(sentBack.blocks).toEqual([
      { label: 'Message to the applicant:', text: 'Blurry ID.' },
      { label: 'Staff note:', text: 'Hm' },
    ]);
    expect(historyText(entry({ type: 'rejected', actor: admin })).details).toBe(
      'No reason given to the applicant',
    );
    expect(historyText(entry({ type: 'suspended', actor: admin })).details).toBe(
      'No reason given to the partner',
    );
    expect(historyText(entry({ type: 'taken-offline', actor: { kind: 'system' } })).sentence).toBe(
      'Taken offline by the suspension',
    );
    expect(historyText(entry({ type: 'files-deleted', actor: { kind: 'system' } })).sentence).toBe(
      'Photos and ID details deleted, 30 days after the decision',
    );
  });

  it('withholds texts and notes from the demo admin', () => {
    const masked = historyText(
      entry({
        type: 'rejected',
        actor: { kind: 'staff', name: null, role: 'admin' },
        staffNote: 'secret',
        masked: true,
      }),
    );
    expect(masked.sentence).toBe('Rejected by A staff member (Admin)');
    expect(masked.details).toBe('Hidden for demo staff');
    expect(masked.blocks).toEqual([]);
  });
});

describe('the application page', () => {
  it('describes images without the number', () => {
    expect(idAlt('Sam Rivera', 'DRIVER_LICENSE')).toBe("Front of Sam Rivera's driver's license");
    expect(idCaption('STATE_ID', '9133')).toBe('Front of state ID card · ending 9133');
  });

  it('leaves the license line out for bicycles', () => {
    const bike = whatToCheck({ name: 'Kwame Mensah', last4: '9133', vehicle: 'BICYCLE' });
    const car = whatToCheck({ name: 'Sam Rivera', last4: '5521', vehicle: 'CAR' });
    expect(bike).toHaveLength(5);
    expect(car).toContain("For a scooter, motorbike or car, the ID is a driver's license.");
    expect(car).toContain("The ID ends in 5521 and hasn't expired.");
  });

  it('words decisions in the status block', () => {
    expect(sentBackLine('2026-11-19T15:30:00Z', morgan, TZ)).toBe(
      'Sent back Thu, Nov 19 · 10:30 am by Morgan Diaz (Support)',
    );
    expect(decidedLine('rejected', '2026-11-17T16:00:00Z', admin, TZ)).toBe(
      'Rejected Tue, Nov 17 · 11:00 am by Foodz Admin (Admin)',
    );
    expect(decidedLine('approved', '2026-11-06T16:00:00Z', morgan, TZ)).toBe(
      'Approved Fri, Nov 6 by Morgan Diaz (Support)',
    );
  });

  it('words changes, conflicts and withdrawals', () => {
    expect(editedBanner('Ana Souza', '2026-11-20T23:05:00Z', ['idPhoto'], TZ)).toBe(
      'Ana Souza changed the application at 6:05 pm: new ID photo. The changes are marked below.',
    );
    expect(editedConflict('Ana Souza', '2026-11-20T23:05:00Z', ['idPhoto'], TZ)).toBe(
      'Ana Souza changed the application at 6:05 pm, after you opened it: new ID photo. Check the changes before you decide.',
    );
    expect(goneText('withdrawn', 'Ana Souza', '2026-11-20T23:03:00Z', TZ)).toBe(
      'Ana Souza withdrew the application at 6:03 pm.',
    );
    expect(goneText('account-deleted', 'Ana Souza', '2026-11-20T23:03:00Z', TZ)).toBe(
      'The applicant deleted their Foodz account at 6:03 pm.',
    );
  });
});

describe('decisions', () => {
  it('fills an empty field or adds a line, never replacing what was typed', () => {
    expect(withStarter('', 'A.')).toBe('A.');
    expect(withStarter('  ', 'A.')).toBe('A.');
    expect(withStarter('Hello ', 'A.')).toBe('Hello\nA.');
    expect(withStarter('Hello\nA.', 'A.')).toBe('Hello\nA.');
  });

  it('says when a rejected applicant can apply again', () => {
    const from = reapplyFromToday(new Date('2026-11-20T23:00:00Z'), TZ);
    expect(from).toBe('2026-12-20');
    expect(rejectOutcome('Ana', from)[0]).toBe(
      "Ana can apply again from Sun, Dec 20, 2026. Ana's photos and ID details are deleted that day. We'll email Ana.",
    );
  });

  it('words the suspension by the online state', () => {
    expect(suspendOutcome('Diego', true)[0]).toBe(
      'Diego is online now and will be taken offline at once and signed out on every device.',
    );
    expect(suspendOutcome('Diego', false)[0]).toBe('Diego is offline.');
  });

  it('words refusals', () => {
    expect(idExpiredRefusal('Sam', 'DRIVER_LICENSE', '2026-12-10')).toBe(
      "Sam's license expired on Dec 10, 2026. Send the application back to ask for a new one.",
    );
    expect(imageNotReadyRefusal('Ana', 'idFront', 'checking')).toBe(
      "Ana's new ID photo is still being checked. Try again in a minute.",
    );
    expect(imageNotReadyRefusal('Ana', 'idFront', 'missing')).toBe(
      'The ID photo is missing from storage. Send the application back to ask for a new one.',
    );
    expect(filesDeletedRefusal('Mei', '2026-11-19')).toBe(
      "Mei's photos and ID details were deleted on Nov 19, so this can't be reopened. Mei can apply again from the account.",
    );
  });

  it('words the result line', () => {
    expect(resultText('approve', 'Ana Souza', 'Ana', null)).toBe(
      "Ana Souza is approved. We've emailed Ana.",
    );
    expect(resultText('suspend', 'Diego Alvarez', 'Diego', false)).toBe(
      "Diego Alvarez is suspended and offline. We've emailed Diego.",
    );
    expect(resultText('reopen', 'Jonas Weber', 'Jonas', null)).toBe(
      "Jonas Weber's application is back in To review. We've emailed Jonas.",
    );
  });
});
