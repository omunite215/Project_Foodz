import { describe, expect, it } from 'vitest';
import { STEP_NOTICE_DELAY_MS } from '@/server/modules/orders/progress-schema';
import {
  BOARD_FIELD_ERRORS,
  boardCardsInput,
  boardInput,
  CANCEL_CODES,
  CUSTOMER_LINE_OF,
  findOrderInput,
  markDeliveredInput,
  markPickedUpInput,
  moveBackInput,
  moveOrderInput,
  normalizeOrderNumber,
  refuseOrderInput,
  setDishAvailabilityInput,
  staffCancelEventData,
  staffCancelInput,
  staffOrderInput,
  UNDO_GRACE_MS,
  UNDO_WINDOW_MS,
  undoMoveInput,
} from './schema';

const ORDER = '0196a1b2-0000-7000-8000-000000000001';
const LINE_A = '0196a1b2-0000-7000-8000-0000000000a1';
const LINE_B = '0196a1b2-0000-7000-8000-0000000000a2';
const EVENT = '0196a1b2-0000-7000-8000-0000000000e1';

const messagesOf = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.error?.issues.map((issue) => issue.message) ?? [];

describe('moveOrderInput', () => {
  it('accepts a forward step with the version the person saw', () => {
    expect(moveOrderInput.parse({ orderId: ORDER, to: 'ACCEPTED', expectedVersion: 3 })).toEqual({
      orderId: ORDER,
      to: 'ACCEPTED',
      expectedVersion: 3,
    });
  });

  it.each([
    { orderId: ORDER, to: 'PICKED_UP', expectedVersion: 3 },
    { orderId: ORDER, to: 'CANCELLED', expectedVersion: 3 },
    { orderId: ORDER, to: 'accepted', expectedVersion: 3 },
    { orderId: ORDER, to: 'ACCEPTED', expectedVersion: -1 },
    { orderId: ORDER, to: 'ACCEPTED', expectedVersion: 1.5 },
    { orderId: ORDER, to: 'ACCEPTED' },
    { orderId: '1042', to: 'ACCEPTED', expectedVersion: 3 },
    { orderId: ORDER, to: 'ACCEPTED', expectedVersion: 3, status: 'DELIVERED' },
  ])('refuses %j', (input) => {
    expect(moveOrderInput.safeParse(input).success).toBe(false);
  });
});

describe('undoMoveInput', () => {
  it('takes the move event id', () => {
    expect(undoMoveInput.parse({ orderId: ORDER, eventId: EVENT })).toEqual({
      orderId: ORDER,
      eventId: EVENT,
    });
    expect(undoMoveInput.safeParse({ orderId: ORDER }).success).toBe(false);
    expect(undoMoveInput.safeParse({ orderId: ORDER, eventId: 'last' }).success).toBe(false);
  });
});

describe('moveBackInput', () => {
  it('needs a reason, and a note for "Other"', () => {
    expect(
      moveBackInput.parse({ orderId: ORDER, expectedVersion: 4, reason: 'wrong-ticket' }),
    ).toEqual({ orderId: ORDER, expectedVersion: 4, reason: 'wrong-ticket' });
    expect(
      messagesOf(moveBackInput.safeParse({ orderId: ORDER, expectedVersion: 4, reason: 'other' })),
    ).toEqual([BOARD_FIELD_ERRORS.otherNote]);
    expect(
      messagesOf(moveBackInput.safeParse({ orderId: ORDER, expectedVersion: 4, reason: 'oops' })),
    ).toEqual([BOARD_FIELD_ERRORS.reason]);
  });
});

describe('refuseOrderInput', () => {
  const base = { orderId: ORDER, expectedVersion: 2 };

  it('keeps ticked dishes, once each, and the sold-out box for "A dish is unavailable"', () => {
    expect(
      refuseOrderInput.parse({
        ...base,
        reason: 'dish-unavailable',
        lineIds: [LINE_A, LINE_B, LINE_A],
        markSoldOut: true,
      }),
    ).toEqual({
      ...base,
      reason: 'dish-unavailable',
      lineIds: [LINE_A, LINE_B],
      markSoldOut: true,
    });
  });

  it('drops dishes and the sold-out box for any other reason', () => {
    expect(
      refuseOrderInput.parse({
        ...base,
        reason: 'too-busy',
        lineIds: [LINE_A],
        markSoldOut: true,
      }),
    ).toEqual({ ...base, reason: 'too-busy', lineIds: [], markSoldOut: false });
  });

  it('says what is missing, under each field (A6.3)', () => {
    expect(messagesOf(refuseOrderInput.safeParse(base))).toEqual([BOARD_FIELD_ERRORS.reason]);
    expect(messagesOf(refuseOrderInput.safeParse({ ...base, reason: 'dish-unavailable' }))).toEqual(
      [BOARD_FIELD_ERRORS.dishes],
    );
    expect(messagesOf(refuseOrderInput.safeParse({ ...base, reason: 'other' }))).toEqual([
      BOARD_FIELD_ERRORS.refusalNote,
    ]);
    expect(
      messagesOf(refuseOrderInput.safeParse({ ...base, reason: 'other', note: '   \n\t ' })),
    ).toEqual([BOARD_FIELD_ERRORS.refusalNote]);
  });

  it('cleans the staff note and caps it at 500 characters', () => {
    const parsed = refuseOrderInput.parse({
      ...base,
      reason: 'other',
      note: '  Fryer broke,\nask Alex​  ',
    });
    expect(parsed.note).toBe('Fryer broke, ask Alex');
    expect(
      refuseOrderInput.safeParse({ ...base, reason: 'other', note: 'x'.repeat(500) }).success,
    ).toBe(true);
    expect(
      messagesOf(refuseOrderInput.safeParse({ ...base, reason: 'other', note: 'x'.repeat(501) })),
    ).toEqual([BOARD_FIELD_ERRORS.noteLength]);
  });

  it('offers only the kitchen reasons', () => {
    for (const reason of ['customer-asked', 'cant-deliver', 'fraud']) {
      expect(refuseOrderInput.safeParse({ ...base, reason }).success).toBe(false);
    }
  });

  it('refuses unknown fields and bad line ids', () => {
    expect(refuseOrderInput.safeParse({ ...base, reason: 'too-busy', refund: 0 }).success).toBe(
      false,
    );
    expect(
      refuseOrderInput.safeParse({ ...base, reason: 'dish-unavailable', lineIds: ['gimbap'] })
        .success,
    ).toBe(false);
    expect(
      refuseOrderInput.safeParse({
        ...base,
        reason: 'dish-unavailable',
        lineIds: Array.from({ length: 26 }, () => LINE_A),
      }).success,
    ).toBe(false);
  });
});

describe('staffCancelInput', () => {
  const base = { orderId: ORDER, expectedVersion: 5 };

  it('accepts every staff reason (A7.2)', () => {
    for (const reason of CANCEL_CODES) {
      const input =
        reason === 'dish-unavailable'
          ? { ...base, reason, lineIds: [LINE_A] }
          : reason === 'other'
            ? { ...base, reason, note: 'Called back to confirm' }
            : { ...base, reason };
      expect(staffCancelInput.safeParse(input).success).toBe(true);
    }
  });

  it('takes the step-up code with the cancellation, cleaned like the sign-in code', () => {
    expect(
      staffCancelInput.parse({
        ...base,
        reason: 'customer-asked',
        stepUp: { method: 'totp', code: '123 456' },
      }).stepUp,
    ).toEqual({ method: 'totp', code: '123456' });
    expect(
      staffCancelInput.safeParse({
        ...base,
        reason: 'customer-asked',
        stepUp: { method: 'totp', code: '12345' },
      }).success,
    ).toBe(false);
    expect(
      refuseOrderInput.safeParse({
        ...base,
        reason: 'too-busy',
        stepUp: { method: 'totp', code: '123456' },
      }).success,
    ).toBe(false);
  });

  it('never takes an amount, a refund choice or a loose code', () => {
    for (const extra of [{ amountCents: 100 }, { refund: false }, { code: '123456' }]) {
      expect(staffCancelInput.safeParse({ ...base, reason: 'too-busy', ...extra }).success).toBe(
        false,
      );
    }
  });
});

describe('hand-over inputs', () => {
  const base = { orderId: ORDER, expectedVersion: 7 };

  it('mark picked up needs a reason, and a note for "Other"', () => {
    expect(markPickedUpInput.parse({ ...base, reason: 'own-driver' })).toEqual({
      ...base,
      reason: 'own-driver',
    });
    expect(messagesOf(markPickedUpInput.safeParse({ ...base, reason: 'other' }))).toEqual([
      BOARD_FIELD_ERRORS.otherNote,
    ]);
    expect(
      markPickedUpInput.safeParse({ ...base, reason: 'own-driver', cashCollected: true }).success,
    ).toBe(false);
  });

  it('mark delivered defaults the cash tick to unticked', () => {
    expect(markDeliveredInput.parse({ ...base, reason: 'customer-collected' })).toEqual({
      ...base,
      reason: 'customer-collected',
      cashCollected: false,
    });
    expect(
      markDeliveredInput.parse({ ...base, reason: 'courier-app-down', cashCollected: true })
        .cashCollected,
    ).toBe(true);
    expect(
      markDeliveredInput.safeParse({ ...base, reason: 'own-driver', cashCollectedCents: 5397 })
        .success,
    ).toBe(false);
  });
});

describe('order numbers (A11.1)', () => {
  it.each([
    ['1042', '1042'],
    ['#1042', '1042'],
    ['  1042 ', '1042'],
    ['# 1042', '1042'],
    ['s1101', 'S1101'],
    [' S1101 ', 'S1101'],
    ['#s1101', 'S1101'],
    ['01042', '1042'],
    ['0', '0'],
  ])('reads %j as %j', (raw, number) => {
    expect(normalizeOrderNumber(raw)).toBe(number);
    expect(findOrderInput.parse({ query: raw })).toEqual({ number });
  });

  it.each(['', 'abc', '10 42', '1042a', 'SS1101', '-1042', '1234567890', "1042' OR 1=1"])(
    'refuses %j',
    (query) => {
      expect(normalizeOrderNumber(query)).toBeNull();
      expect(messagesOf(findOrderInput.safeParse({ query }))).toEqual([
        BOARD_FIELD_ERRORS.orderNumber,
      ]);
    },
  );

  it('refuses long input and unknown fields', () => {
    expect(findOrderInput.safeParse({ query: '1'.repeat(41) }).success).toBe(false);
    expect(findOrderInput.safeParse({ query: '1042', date: 'today' }).success).toBe(false);
  });
});

describe('reads', () => {
  it('takes nothing for the snapshot and refuses anything else', () => {
    expect(boardInput.parse({})).toEqual({});
    expect(boardInput.safeParse({ role: 'admin' }).success).toBe(false);
  });

  it('takes an order id for the detail, never a number', () => {
    expect(staffOrderInput.safeParse({ orderId: ORDER }).success).toBe(true);
    expect(staffOrderInput.safeParse({ orderId: '1042' }).success).toBe(false);
  });

  it('refetches 1 to 50 cards, each once', () => {
    expect(boardCardsInput.parse({ orderIds: [ORDER, ORDER] })).toEqual({ orderIds: [ORDER] });
    expect(boardCardsInput.safeParse({ orderIds: [] }).success).toBe(false);
    expect(
      boardCardsInput.safeParse({ orderIds: Array.from({ length: 51 }, () => ORDER) }).success,
    ).toBe(false);
  });
});

describe('setDishAvailabilityInput', () => {
  it('takes a dish id and the state wanted', () => {
    expect(setDishAvailabilityInput.parse({ dishId: ORDER, available: false })).toEqual({
      dishId: ORDER,
      available: false,
    });
    expect(
      setDishAvailabilityInput.safeParse({ dishId: 'pad-thai', available: false }).success,
    ).toBe(false);
    expect(
      setDishAvailabilityInput.safeParse({ dishId: ORDER, available: false, title: 'x' }).success,
    ).toBe(false);
  });
});

describe('what the customer reads', () => {
  it('has one customer line per reason, and none names fraud or the kitchen refusing', () => {
    expect(Object.keys(CUSTOMER_LINE_OF).toSorted()).toEqual([...CANCEL_CODES].toSorted());
    expect(CUSTOMER_LINE_OF.fraud).toBe('couldNotAccept');
    expect(Object.values(CUSTOMER_LINE_OF).join(' ')).not.toMatch(/fraud|refus|staff/i);
  });
});

describe('stored event data', () => {
  it('keeps a staff cancellation as written and refuses extra fields', () => {
    const data = {
      actor: 'staff',
      by: { name: 'Morgan Diaz', role: 'support' },
      reason: 'customer-asked',
      lineIds: [],
      dishes: [],
      note: 'Called back to confirm',
      refundCents: 5903,
      refundAnnounced: true,
      sample: false,
      codeReleased: 'LASTONE',
    };
    expect(staffCancelEventData.parse(data)).toEqual(data);
    expect(staffCancelEventData.safeParse({ ...data, phone: '+16175550123' }).success).toBe(false);
    expect(
      staffCancelEventData.safeParse({ ...data, by: { name: 'X', role: 'customer' } }).success,
    ).toBe(false);
  });
});

describe('timing constants', () => {
  it('waits out the undo window and its grace before a customer notice', () => {
    expect(STEP_NOTICE_DELAY_MS).toBe(UNDO_WINDOW_MS + UNDO_GRACE_MS);
  });
});
