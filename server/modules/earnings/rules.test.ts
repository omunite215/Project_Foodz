import { describe, expect, it } from 'vitest';
import { centsToDecimal, count, money, textCell, toCsv } from './csv';
import {
  addDays,
  balanceState,
  cashBreakdown,
  cashState,
  defaultCashAmount,
  type DeliveryEnding,
  expectedEntries,
  goalPercent,
  goalReachedAt,
  isMonday,
  type LedgerFact,
  mondayOf,
  onlineSecondsWithin,
  owedAmber,
  partnerRows,
  type PartnerEntry,
  practiceDays,
  practiceRows,
  presetRange,
  reportFigures,
  splitBalances,
  weekDates,
} from './rules';
import {
  adjustEarningsInput,
  earningsReportInput,
  goalInput,
  parseAmountText,
  recordCashInput,
  recordPayoutInput,
} from './schema';
import {
  boardNotice,
  customerShort,
  deletedPartnerName,
  entryWords,
  ledgerChangedWords,
  partnerNotice,
  recordedByRole,
  recordedByWords,
  signedPrice,
  utcInstant,
} from './text';

const TZ = 'America/New_York';
const ids = {
  a: '0195b2a0-0000-7000-8000-000000000001',
  b: '0195b2a0-0000-7000-8000-000000000002',
};

const range = (from: string, to: string) => earningsReportInput.safeParse({ from, to });

const ending = (overrides: Partial<DeliveryEnding>): DeliveryEnding => ({
  status: 'DELIVERED',
  endedPartnerId: ids.a,
  pickedUpAt: '2026-11-20T23:42:00Z',
  partnerFeeCents: 764,
  tipCents: 500,
  pool: 'REAL',
  paymentMethod: 'CASH',
  totalCents: 5_897,
  ...overrides,
});

const fact = (
  kind: LedgerFact['kind'],
  amountCents: number,
  balanceAfterCents = 0,
): LedgerFact => ({
  id: `${kind}-${amountCents}`,
  kind,
  amountCents,
  reason: null,
  at: '2026-11-16T15:05:00Z',
  balanceAfterCents,
});

const at = (hhmm: string) => new Date(`2026-11-20T${hhmm}:00Z`);

const entry = (overrides: Partial<PartnerEntry>): PartnerEntry => ({
  id: overrides.id ?? `${overrides.kind}-${overrides.at}`,
  kind: 'DELIVERY_FEE',
  reason: null,
  amountCents: 0,
  at: '2026-11-21T00:46:00Z',
  date: '2026-11-20',
  deliveryId: null,
  message: null,
  method: null,
  reference: null,
  ...overrides,
});

describe('typed amounts (A67.3)', () => {
  it('parses dollars as text into exact cents', () => {
    expect(parseAmountText('$1,234.50')).toBe(123_450);
    expect(parseAmountText('1234.5')).toBe(123_450);
    expect(parseAmountText('0.29')).toBe(29);
    expect(parseAmountText(' 142.70 ')).toBe(14_270);
    expect(parseAmountText('$ 7')).toBe(700);
  });

  it('refuses more than two decimals, signs, exponents, bad grouping and nonsense', () => {
    for (const bad of [
      '1.234',
      '-5',
      '+5',
      '1e3',
      '12,34',
      '1,2345.00',
      '',
      '$',
      'abc',
      '12.',
      '.5',
      '12345678',
    ]) {
      expect(parseAmountText(bad)).toBeNull();
    }
  });

  it('turns field errors into the words the dialogs show', () => {
    const base = { partnerId: ids.a, expectedVersion: 3, idempotencyKey: ids.b };
    expect(recordCashInput.safeParse({ ...base, amount: '12.345' }).error?.issues[0]?.message).toBe(
      'Enter an amount like 12.50.',
    );
    expect(recordCashInput.safeParse({ ...base, amount: '0.00' }).error?.issues[0]?.message).toBe(
      'Enter at least $0.01.',
    );
    expect(recordCashInput.parse({ ...base, amount: '142.70', note: '  ' })).toMatchObject({
      amount: 14_270,
      note: undefined,
    });
    const adjust = (extra: Record<string, unknown>) =>
      adjustEarningsInput.safeParse({
        ...base,
        direction: 'add',
        amount: '3.00',
        reason: 'bonus',
        message: 'Waited 20 min at the kitchen for order 1050.',
        ...extra,
      });
    expect(adjust({}).success).toBe(true);
    expect(adjust({ amount: '500.01' }).error?.issues[0]?.message).toBe(
      'Adjustments are limited to $500 each.',
    );
    expect(adjust({ direction: 'take-off' }).error?.issues[0]?.path).toEqual(['reason']);
    expect(adjust({ message: '\u0007 ' }).error?.issues[0]?.path).toEqual(['message']);
    expect(
      recordPayoutInput.safeParse({
        ...base,
        amount: '67.05',
        method: 'cheque',
        paidOn: '2026-11-20',
      }).error?.issues[0]?.message,
    ).toBe('Choose how you paid.');
  });

  it('takes a goal in whole dollars from $10 to $1,000, or none', () => {
    expect(goalInput.parse({ cents: 4_000 })).toEqual({ cents: 4_000 });
    expect(goalInput.parse({ cents: null })).toEqual({ cents: null });
    for (const cents of [999, 100_100, 4_050])
      expect(goalInput.safeParse({ cents }).success).toBe(false);
  });

  it('checks report ranges: order and at most 366 days', () => {
    expect(range('2026-11-16', '2026-11-22').success).toBe(true);
    expect(range('2026-11-22', '2026-11-16').error?.issues[0]?.message).toBe(
      "The end date can't be before the start.",
    );
    expect(range('2025-11-16', '2026-11-17').error?.issues[0]?.message).toBe(
      "The range can't be longer than 366 days.",
    );
    expect(
      earningsReportInput.parse({ from: '2026-11-16', to: '2026-11-22', sort: 'nope', q: 'l' }),
    ).toMatchObject({
      sort: 'partner',
      filter: 'all',
      q: '',
      page: 1,
    });
  });
});

describe('what each ending writes (E2)', () => {
  it('pays fee, tip and cash for a delivery; fee and tip by card; no cash in the demo pool', () => {
    expect(expectedEntries(ending({}))).toEqual([
      { kind: 'DELIVERY_FEE', amountCents: 264, reason: null },
      { kind: 'TIP', amountCents: 500, reason: null },
      { kind: 'CASH_COLLECTED', amountCents: -5_897, reason: null },
    ]);
    expect(
      expectedEntries(ending({ paymentMethod: 'CARD' })).map((written) => written.kind),
    ).toEqual(['DELIVERY_FEE', 'TIP']);
    expect(expectedEntries(ending({ pool: 'DEMO' })).map((written) => written.kind)).toEqual([
      'DELIVERY_FEE',
      'TIP',
    ]);
    expect(
      expectedEntries(ending({ tipCents: 0, partnerFeeCents: 529, paymentMethod: 'CARD' })),
    ).toEqual([{ kind: 'DELIVERY_FEE', amountCents: 529, reason: null }]);
  });

  it('pays the fee alone after a cancellation after pickup, and nothing before pickup or without a holder', () => {
    expect(expectedEntries(ending({ status: 'CANCELLED' }))).toEqual([
      { kind: 'DELIVERY_FEE', amountCents: 264, reason: 'cancelled-after-pickup' },
    ]);
    expect(expectedEntries(ending({ status: 'CANCELLED', pickedUpAt: null }))).toEqual([]);
    expect(expectedEntries(ending({ endedPartnerId: null }))).toEqual([]);
    expect(expectedEntries(ending({ status: 'SEARCHING' }))).toEqual([]);
  });
});

describe('balance and cash (P56, A57, A60)', () => {
  it('names the three states', () => {
    expect([cashState(6_705), cashState(-14_270), cashState(0)]).toEqual([
      'owesYou',
      'handIn',
      'square',
    ]);
    expect([balanceState(1), balanceState(-1), balanceState(0)]).toEqual([
      'foodzOwes',
      'partnerOwes',
      'square',
    ]);
  });

  it('turns amber after 48 hours or over $150, and says why', () => {
    const now = new Date('2026-11-20T23:46:00Z');
    expect(owedAmber(14_270, '2026-11-18T01:40:00Z', now)).toEqual({ amber: true, why: ['age'] });
    expect(owedAmber(16_480, '2026-11-20T20:00:00Z', now)).toEqual({
      amber: true,
      why: ['amount'],
    });
    expect(owedAmber(15_000, '2026-11-20T20:00:00Z', now)).toEqual({ amber: false, why: [] });
    expect(owedAmber(0, '2026-11-01T00:00:00Z', now)).toEqual({ amber: false, why: [] });
  });

  it('starts the cash amount at what he owes, capped at what he holds, and empty when he owes nothing', () => {
    expect(defaultCashAmount(-14_270, 16_480)).toBe(14_270);
    expect(defaultCashAmount(-20_000, 16_480)).toBe(16_480);
    expect(defaultCashAmount(6_705, 5_897)).toBeNull();
  });

  it('works out "since the last payout" from the entries, with what the payout carried over', () => {
    const luis = [
      fact('DELIVERY_FEE', 7_440),
      fact('TIP', 2_200),
      fact('PAYOUT', -9_640, 0),
      fact('DELIVERY_FEE', 8_652),
      fact('TIP', 3_950),
      fact('CASH_COLLECTED', -14_392),
      fact('CASH_HANDED_IN', 8_495),
    ];
    expect(cashBreakdown(luis)).toMatchObject({
      from: 'payout',
      payoutCents: 9_640,
      carriedCents: 0,
      earnedCents: 12_602,
      cashCollectedCents: 14_392,
      cashHandedInCents: 8_495,
      resultCents: 6_705,
    });
    expect(cashBreakdown([fact('PAYOUT', -5_000, 1_000), fact('TIP', 100)]).resultCents).toBe(
      1_100,
    );
    expect(cashBreakdown([]).from).toBe('none');
    expect(cashBreakdown([fact('TIP', 100)]).from).toBe('firstDelivery');
  });
});

describe('store weeks and the goal (E5, P52, P53)', () => {
  it('finds Mondays and the presets, inclusive, from a store date', () => {
    expect(mondayOf('2026-11-20')).toBe('2026-11-16');
    expect(mondayOf('2026-11-22')).toBe('2026-11-16');
    expect(isMonday('2026-11-16')).toBe(true);
    expect(weekDates('2026-11-16').at(-1)).toBe('2026-11-22');
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(presetRange('this-week', '2026-11-20')).toEqual({
      from: '2026-11-16',
      to: '2026-11-22',
    });
    expect(presetRange('last-week', '2026-11-20')).toEqual({
      from: '2026-11-09',
      to: '2026-11-15',
    });
    expect(presetRange('this-month', '2026-11-20')).toEqual({
      from: '2026-11-01',
      to: '2026-11-30',
    });
    expect(presetRange('last-month', '2026-01-10')).toEqual({
      from: '2025-12-01',
      to: '2025-12-31',
    });
  });

  it('rounds the ring half up, caps it, and dates the moment the goal was reached', () => {
    expect(goalPercent(1_957, 4_000)).toBe(49);
    expect(goalPercent(4_120, 4_000)).toBe(100);
    expect(goalPercent(1_957, null)).toBe(0);
    const entries = [
      { at: 'a', kind: 'DELIVERY_FEE' as const, amountCents: 3_000 },
      { at: 'b', kind: 'CASH_COLLECTED' as const, amountCents: -5_000 },
      { at: 'c', kind: 'TIP' as const, amountCents: 1_000 },
    ];
    expect(goalReachedAt(entries, 4_000)).toBe('c');
    expect(goalReachedAt(entries, 5_000)).toBeNull();
  });

  it('counts online seconds inside a day, an open session up to now', () => {
    const sessions = [
      { startedAt: at('03:00'), endedAt: at('06:00') },
      { startedAt: at('16:30'), endedAt: at('18:30') },
      { startedAt: at('23:35'), endedAt: null },
    ];
    expect(onlineSecondsWithin(sessions, at('05:00'), at('23:59'), at('23:46'))).toBe(
      (60 + 120 + 11) * 60,
    );
  });
});

describe("the partner's rows (P55)", () => {
  it('folds a delivery into one row and keeps staff entries apart, newest first by day', () => {
    const groups = partnerRows(
      [
        entry({
          kind: 'CASH_HANDED_IN',
          amountCents: 8_495,
          at: '2026-11-19T19:10:00Z',
          date: '2026-11-19',
        }),
        entry({ kind: 'DELIVERY_FEE', amountCents: 264, deliveryId: ids.a }),
        entry({ kind: 'TIP', amountCents: 500, deliveryId: ids.a }),
        entry({ kind: 'CASH_COLLECTED', amountCents: -5_897, deliveryId: ids.a }),
        entry({
          kind: 'DELIVERY_FEE',
          amountCents: 264,
          deliveryId: ids.b,
          reason: 'cancelled-after-pickup',
          at: '2026-11-21T01:31:00Z',
        }),
        entry({
          kind: 'ADJUSTMENT',
          amountCents: -200,
          message: 'Wrong tip entered.',
          at: '2026-11-21T02:00:00Z',
        }),
        entry({
          kind: 'PAYOUT',
          amountCents: -9_640,
          method: 'bank-transfer',
          reference: 'Week of Nov 9',
          at: '2026-11-21T03:00:00Z',
        }),
      ],
      new Map([
        [ids.a, { orderNumber: '1042', areaWords: 'Boston 02109' }],
        [ids.b, { orderNumber: '1043', areaWords: 'Boston 02109' }],
      ]),
    );
    expect(groups.map((group) => [group.date, group.earnedCents])).toEqual([
      ['2026-11-20', 264 + 500 + 264 - 200],
      ['2026-11-19', 0],
    ]);
    expect(groups[0]!.rows.map((row) => [row.kind, row.amountCents, row.orderNumber])).toEqual([
      ['payout', 9_640, null],
      ['takenOff', -200, null],
      ['cancelledAfterPickup', 264, '1043'],
      ['delivery', 764, '1042'],
    ]);
    expect(groups[0]!.rows.at(-1)).toMatchObject({
      tipCents: 500,
      cashCents: 5_897,
      areaWords: 'Boston 02109',
    });
  });
});

describe('the report (A63)', () => {
  it('closes every row as opening + earned − cash collected + handed in − paid out', () => {
    const luis = reportFigures(
      {
        deliveries: 18,
        deliveryPayCents: 8_652,
        tipsCents: 3_950,
        adjustmentsCents: 0,
        cashCollectedCents: 14_392,
        cashHandedInCents: 8_495,
        paidOutCents: 9_640,
      },
      9_640,
    );
    expect(luis).toMatchObject({ earnedCents: 12_602, closingCents: 6_705 });
    expect(splitBalances([6_705, -14_270, 0, 100])).toEqual({
      foodzOwesCents: 6_805,
      owedToFoodzCents: 14_270,
    });
  });
});

describe('the demo partner (P62)', () => {
  it('reads today 4 · $27.80 and, on Friday, the week 23 · $164.35 incl. $41.00 tips', () => {
    const days = practiceDays('2026-11-20');
    const sum = (pick: (day: (typeof days)[number]) => number) =>
      days.reduce((total, day) => total + pick(day), 0);
    expect(days.at(-1)).toMatchObject({ date: '2026-11-20', deliveries: 4, earnedCents: 2_780 });
    expect([
      sum((day) => day.deliveries),
      sum((day) => day.earnedCents),
      sum((day) => day.tipsCents),
    ]).toEqual([23, 16_435, 4_100]);
    expect(practiceDays('2026-11-16')).toHaveLength(1);
    const rows = practiceRows(days[0]!, new Date('2026-11-16T05:00:00Z'), 0);
    expect(rows.reduce((total, row) => total + row.amountCents, 0)).toBe(days[0]!.earnedCents);
    expect(rows.at(-1)).toMatchObject({ orderNumber: 'D-200', areaWords: 'Boston 02116' });
  });
});

describe('words (design 3.5, 3.9, 1.10)', () => {
  it('words the staff ledger and who recorded it', () => {
    expect(entryWords('DELIVERY_FEE', 'cancelled-after-pickup', 264, null)).toBe(
      'Delivery fee · cancelled after pickup',
    );
    expect(entryWords('ADJUSTMENT', 'correction', 300, null)).toBe('Added · Correction');
    expect(entryWords('ADJUSTMENT', 'cancelled-order-pay', -200, null)).toBe(
      'Taken off · Pay for a cancelled order',
    );
    expect(entryWords('PAYOUT', null, -9_640, 'bank-transfer')).toBe('Payout · Bank transfer');
    expect(recordedByWords({ kind: 'system' })).toBe('Foodz (automatic)');
    expect(recordedByWords({ kind: 'staff', name: 'Morgan Diaz', role: 'support' })).toBe(
      'Morgan Diaz (Support)',
    );
    expect(recordedByRole({ kind: 'staff', name: 'Morgan Diaz', role: 'admin' })).toBe('Admin');
    expect(signedPrice(-5_897)).toBe('−$58.97');
    expect(signedPrice(300)).toBe('+$3.00');
  });

  it('says what changed in between, and the payout race close-only line', () => {
    const when = '2026-11-23T15:02:00Z';
    expect(
      ledgerChangedWords({
        latest: {
          kind: 'CASH_HANDED_IN',
          amountCents: 5_000,
          reason: null,
          at: when,
          orderNumber: null,
          byName: 'Morgan Diaz',
        },
        partnerName: 'Diego Alvarez',
        balanceCents: -9_270,
        holdingCents: 11_480,
        closeOnly: false,
        timeZone: TZ,
      }),
    ).toBe(
      'The figures changed after you opened this: Morgan Diaz recorded $50.00 in cash from Diego at 10:02 am. Check the amount.',
    );
    expect(
      ledgerChangedWords({
        latest: {
          kind: 'PAYOUT',
          amountCents: -6_705,
          reason: null,
          at: when,
          orderNumber: null,
          byName: 'Foodz Admin',
        },
        partnerName: 'Luis Moreno',
        balanceCents: 0,
        holdingCents: 5_897,
        closeOnly: true,
        timeZone: TZ,
      }),
    ).toBe(
      "Foodz Admin recorded a payout of $67.05 for Luis at 10:02 am. Luis's balance is now $0.00.",
    );
    expect(
      ledgerChangedWords({
        latest: {
          kind: 'TIP',
          amountCents: 500,
          reason: null,
          at: when,
          orderNumber: '1046',
          byName: null,
        },
        partnerName: 'Luis Moreno',
        balanceCents: 100,
        holdingCents: 0,
        closeOnly: false,
        timeZone: TZ,
      }),
    ).toContain('Luis delivered order 1046 at 10:02 am.');
  });

  it("reads a jsonb time without an offset as UTC, whatever the server's zone (review S2)", () => {
    const zone = process.env.TZ;
    // The conflict answer's `at` comes from jsonb without an offset; a server in Boston read it
    // as local time and said 7:08 pm for 2:08 pm.
    process.env.TZ = 'America/New_York';
    try {
      expect(utcInstant('2026-11-26T19:08:00').toISOString()).toBe('2026-11-26T19:08:00.000Z');
      expect(utcInstant('2026-11-26T19:08:00.123').toISOString()).toBe('2026-11-26T19:08:00.123Z');
      expect(utcInstant('2026-11-26T19:08:00Z').toISOString()).toBe('2026-11-26T19:08:00.000Z');
      expect(utcInstant('2026-11-26T14:08:00-05:00').toISOString()).toBe(
        '2026-11-26T19:08:00.000Z',
      );
      expect(
        ledgerChangedWords({
          latest: {
            kind: 'CASH_HANDED_IN',
            amountCents: 5_000,
            reason: null,
            at: '2026-11-26T19:08:00',
            orderNumber: null,
            byName: 'Morgan Diaz',
          },
          partnerName: 'Diego Alvarez',
          balanceCents: -9_270,
          holdingCents: 11_480,
          closeOnly: false,
          timeZone: TZ,
        }),
      ).toContain('Morgan Diaz recorded $50.00 in cash from Diego at 2:08 pm.');
    } finally {
      if (zone === undefined) delete process.env.TZ;
      else process.env.TZ = zone;
    }
  });

  it('words board notices and partner notices, never naming staff', () => {
    expect(boardNotice('CASH_HANDED_IN', 14_270, 'Diego Alvarez')).toBe(
      'Recorded $142.70 in cash from Diego A.',
    );
    expect(boardNotice('ADJUSTMENT', 300, 'Luis Moreno')).toBe(
      "Added $3.00 to Luis M.'s earnings.",
    );
    expect(boardNotice('ADJUSTMENT', -200, 'Luis Moreno')).toBe(
      "Took $2.00 off Luis M.'s earnings.",
    );
    expect(boardNotice('PAYOUT', -6_705, 'Riley')).toBe('Recorded a payout of $67.05 to Riley.');
    expect(
      partnerNotice({ kind: 'CASH_HANDED_IN', amountCents: 14_270, message: null, method: null }),
    ).toEqual({
      type: 'earnings.cash-recorded',
      title: 'Foodz recorded $142.70 in cash from you.',
      body: 'Your balance is updated in Earnings.',
    });
    expect(
      partnerNotice({
        kind: 'BONUS',
        amountCents: 300,
        message: 'Waited 20 min at the kitchen for order 1050.',
        method: null,
      }).title,
    ).toBe('Foodz added $3.00: Waited 20 min at the kitchen for order 1050.');
    expect(
      partnerNotice({ kind: 'ADJUSTMENT', amountCents: -200, message: 'Wrong tip.', method: null })
        .title,
    ).toBe('Foodz took off $2.00: Wrong tip.');
    expect(
      partnerNotice({ kind: 'PAYOUT', amountCents: -6_705, message: null, method: 'bank-transfer' })
        .title,
    ).toBe('Foodz paid you $67.05 · Bank transfer');
    expect(deletedPartnerName('1a2b3c4d-0000-7000-8000-000000000000')).toBe(
      'Deleted partner · 1a2b',
    );
    expect(customerShort('Hana Kim', false)).toBe('Hana K.');
    expect(customerShort('Deleted customer', true)).toBe('Deleted customer');
  });
});

describe('the CSV writer (A64, B11)', () => {
  it('builds decimals from cents without floats', () => {
    expect([
      centsToDecimal(12_602),
      centsToDecimal(-14_270),
      centsToDecimal(5),
      centsToDecimal(0),
    ]).toEqual(['126.02', '-142.70', '0.05', '0.00']);
    expect(() => centsToDecimal(1.5)).toThrow('cents must be a safe integer');
  });

  it('guards text cells that a spreadsheet would run, and never touches numbers', () => {
    expect(textCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    for (const start of ['+', '-', '@', '\t', '\r'])
      expect(textCell(`${start}1`).includes("'")).toBe(true);
    expect(textCell('Luis Moreno')).toBe('Luis Moreno');
    expect(textCell('Moreno, Luis')).toBe('"Moreno, Luis"');
    const file = toCsv(
      ['Partner', 'Closing balance', 'Deliveries'],
      [['Diego', money(-14_270), count(3)]],
    );
    expect(file).toBe('﻿Partner,Closing balance,Deliveries\r\nDiego,-142.70,3\r\n');
  });
});
