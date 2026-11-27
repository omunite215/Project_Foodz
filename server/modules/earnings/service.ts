import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { formatPrice } from '@/lib/format';
import { can, type Permission } from '@/server/auth/roles';
import { requirePermission, type UserActor } from '@/server/auth/session';
import { type DbContext, runAs, runAsSystem } from '@/server/db/context';
import { AppError, conflict, invalidInput, unauthenticated } from '@/server/errors';
import { logger } from '@/server/logger';
import { audit } from '@/server/modules/audit/service';
import { cityAndZip, firstNameOf } from '@/server/modules/delivery/text';
import { passStepUp, stepUpFreshUntilFor } from '@/server/modules/staff/service';
import { type CsvCell, money as moneyCell, reportCsvRow, toCsv } from './csv';
import { announceEarnings, notifyPartnerOfEntry } from './effects';
import * as repo from './repo';
import {
  addDays,
  balanceState,
  cashBreakdown,
  cashState,
  defaultCashAmount,
  goalReachedAt,
  isMonday,
  latestReportDay,
  mondayOf,
  onlineSecondsWithin,
  owedAmber,
  partnerRows,
  practiceDays,
  practiceRows,
  PRACTICE_TODAY,
  reportFigures,
  splitBalances,
  weekDates,
} from './rules';
import {
  adjustEarningsInput,
  type CashCard,
  EARNINGS_FIELD_ERRORS,
  EARNINGS_LIMITS,
  type EarningKind,
  earningsDeliveryParams,
  type EarningsDeliveryDetail,
  type EarningsReport,
  earningsReportInput,
  type EarningsReportQuery,
  type EarningsSummary,
  type EarningsWeek,
  type EarningsWeekBlock,
  earningsWeekQuery,
  entriesExportInput,
  goalInput,
  type LedgerChangedDetails,
  type LedgerRow,
  type MoneyActionResult,
  type MoneyDialogKind,
  type MoneyDialogOpening,
  openMoneyDialogInput,
  type PartnerEarningsPage,
  partnerEarningsInput,
  type PartnerListMoney,
  isPayoutMethod,
  recordCashInput,
  recordPayoutInput,
  type ReportRow,
  reportExportInput,
  type TodayLine,
} from './schema';
import {
  boardNotice,
  deletedPartnerName,
  entryWords,
  ledgerChangedWords,
  recordedByRole,
  utcInstant,
} from './text';

/*
 * F9's earnings (contract §1–§5): the partner's figures, the staff ledger and its three money
 * actions, the payouts report and both CSVs. Every figure comes from the same ledger rows and
 * day totals, so the app, the partner page and the report agree to the cent (A59.3, E4.2).
 */

const READ_OWN: Permission = { earnings: ['read-own'] };
const STAFF_READ: Permission = { earnings: ['read'] };
const REPORT: Permission = { earnings: ['report'] };
const DIALOG_PERMISSION: Record<MoneyDialogKind, Permission> = {
  cash: { earnings: ['record-cash'] },
  adjust: { earnings: ['adjust'] },
  payout: { earnings: ['payout'] },
};
const DEMO_READ_ONLY = 'Read-only in the demo';

const notApproved = () =>
  new AppError('NOT_APPROVED', 'Your partner account is not approved to deliver.', 403);
const partnerNotFound = () => new AppError('NOT_FOUND', 'Partner not found.', 404);
const deliveryNotFound = () => new AppError('NOT_FOUND', "This delivery isn't available.", 404);

// ------------------------------------------------------------------ the partner (P51–P62)

interface PartnerSelf {
  partnerId: string;
  status: string;
  goalCents: number | null;
  practice: boolean;
}

async function partnerSelf(ctx: DbContext, actor: UserActor): Promise<PartnerSelf> {
  if (!can(actor.role, READ_OWN)) throw notApproved();
  const own = await repo.findOwnPartner(ctx, actor.userId);
  if (!own || (own.status !== 'APPROVED' && own.status !== 'SUSPENDED')) throw notApproved();
  return {
    partnerId: own.id,
    status: own.status,
    goalCents: own.dailyGoalCents,
    practice: own.user.isDemo,
  };
}

interface WeekFrame {
  monday: string;
  dates: string[];
  starts: Map<string, Date>;
  from: Date;
  to: Date;
}

async function weekFrame(ctx: DbContext, monday: string, extra: string[] = []): Promise<WeekFrame> {
  const dates = weekDates(monday);
  const starts = await repo.dayStarts(ctx, [...dates, addDays(monday, 7), ...extra]);
  return {
    monday,
    dates,
    starts,
    from: starts.get(monday) ?? new Date(`${monday}T00:00:00Z`),
    to: starts.get(addDays(monday, 7)) ?? new Date(`${addDays(monday, 7)}T00:00:00Z`),
  };
}

const sumDays = (days: readonly repo.DayRow[], pick: (day: repo.DayRow) => number) =>
  days.reduce((total, day) => total + pick(day), 0);
const earnedOf = (day: repo.DayRow) => day.deliveryPayCents + day.tipsCents + day.adjustmentsCents;

async function firstWeekOf(ctx: DbContext, firstEntryAt: Date | null): Promise<string | null> {
  if (!firstEntryAt) return null;
  return mondayOf(await repo.storeDateOf(ctx, firstEntryAt));
}

async function weekBlock(
  ctx: DbContext,
  partnerId: string,
  frame: WeekFrame,
  today: string,
  now: Date,
  firstWeek: string | null,
): Promise<EarningsWeekBlock> {
  const days = await repo.listDays(ctx, partnerId, frame.monday, addDays(frame.monday, 6));
  const byDate = new Map(days.map((day) => [day.date, day]));
  const sessions = await repo.listSessions(ctx, partnerId, frame.from, frame.to);
  const isFirstWeek = !firstWeek || firstWeek >= frame.monday;
  let previousWeekEarnedCents: number | null = null;
  if (!isFirstWeek) {
    const previous = await repo.listDays(
      ctx,
      partnerId,
      addDays(frame.monday, -7),
      addDays(frame.monday, -1),
    );
    previousWeekEarnedCents = sumDays(previous, earnedOf);
  }
  return {
    start: frame.monday,
    end: addDays(frame.monday, 6),
    isCurrent: frame.monday === mondayOf(today),
    isFirstWeek,
    earnedCents: sumDays(days, earnedOf),
    deliveries: sumDays(days, (day) => day.deliveries),
    tipsCents: sumDays(days, (day) => day.tipsCents),
    onlineSeconds: onlineSecondsWithin(sessions, frame.from, frame.to, now),
    days: frame.dates.map((date) => {
      const day = byDate.get(date);
      let state: 'past' | 'today' | 'future' = 'past';
      if (date === today) state = 'today';
      else if (date > today) state = 'future';
      return {
        date,
        earnedCents: day ? earnedOf(day) : 0,
        deliveries: day?.deliveries ?? 0,
        state,
      };
    }),
    previousWeekEarnedCents,
  };
}

async function cashCard(
  ctx: DbContext,
  partnerId: string,
): Promise<CashCard & { version: number; firstEntryAt: Date | null }> {
  const ledger = await repo.findLedger(ctx, partnerId);
  if (!ledger) {
    return {
      state: 'square',
      balanceCents: 0,
      holdingCents: 0,
      hasEntries: false,
      breakdown: cashBreakdown([]),
      version: 0,
      firstEntryAt: null,
    };
  }
  const payout = ledger.lastPayoutEntryId
    ? await repo.findEntryVersion(ctx, ledger.lastPayoutEntryId)
    : null;
  const entries = await repo.listEntries(ctx, partnerId, {
    fromVersion: payout?.versionAfter ?? null,
  });
  const balanceCents = Number(ledger.balanceCents);
  return {
    state: cashState(balanceCents),
    balanceCents,
    holdingCents: Number(ledger.holdingCents),
    hasEntries: ledger.version > 0,
    breakdown: cashBreakdown(
      entries.map((entry) => ({
        id: entry.id,
        kind: entry.kind,
        amountCents: entry.amountCents,
        reason: entry.reason,
        at: entry.at.toISOString(),
        balanceAfterCents: entry.balanceAfterCents,
      })),
    ),
    version: ledger.version,
    firstEntryAt: ledger.firstEntryAt,
  };
}

function practiceSummary(
  clock: { today: string; now: Date; zone: string },
  frame: WeekFrame,
): EarningsSummary {
  const days = practiceDays(clock.today);
  const byDate = new Map(days.map((day) => [day.date, day]));
  const earned = days.reduce((total, day) => total + day.earnedCents, 0);
  const tomorrow = frame.starts.get(addDays(clock.today, 1)) ?? clock.now;
  return {
    asOf: clock.now.toISOString(),
    storeTimeZone: clock.zone,
    practice: true,
    readOnly: false,
    version: 0,
    hasEntries: true,
    firstWeekStart: frame.monday,
    today: {
      date: clock.today,
      earnedCents: PRACTICE_TODAY.earnedCents,
      deliveries: PRACTICE_TODAY.deliveries,
      tipsCents: PRACTICE_TODAY.tipsCents,
      onlineSeconds: 7_500,
      goalCents: null,
      goalReachedAt: null,
      nextDayAt: tomorrow.toISOString(),
    },
    week: {
      start: frame.monday,
      end: addDays(frame.monday, 6),
      isCurrent: true,
      isFirstWeek: true,
      earnedCents: earned,
      deliveries: days.reduce((total, day) => total + day.deliveries, 0),
      tipsCents: days.reduce((total, day) => total + day.tipsCents, 0),
      onlineSeconds: days.length * 9_000,
      days: frame.dates.map((date) => {
        const day = byDate.get(date);
        let state: 'past' | 'today' | 'future' = 'past';
        if (date === clock.today) state = 'today';
        else if (date > clock.today) state = 'future';
        return {
          date,
          earnedCents: day?.earnedCents ?? 0,
          deliveries: day?.deliveries ?? 0,
          state,
        };
      }),
      previousWeekEarnedCents: null,
    },
    cash: {
      state: 'owesYou',
      balanceCents: earned,
      holdingCents: 0,
      hasEntries: true,
      breakdown: {
        from: 'firstDelivery',
        fromAt: (frame.starts.get(frame.monday) ?? clock.now).toISOString(),
        payoutCents: null,
        carriedCents: 0,
        earnedCents: earned,
        cashCollectedCents: 0,
        cashHandedInCents: 0,
        resultCents: earned,
      },
    },
  };
}

/** `GET /api/v1/partner/earnings/summary` (B3): today, this week and the cash card. */
export async function getEarningsSummary(
  actor: UserActor,
  now = new Date(),
): Promise<EarningsSummary> {
  return runAs(actor, async (ctx) => {
    const self = await partnerSelf(ctx, actor);
    const clock = await repo.storeClock(ctx);
    const frame = await weekFrame(ctx, mondayOf(clock.today), [addDays(clock.today, 1)]);
    if (self.practice) return practiceSummary(clock, frame);
    const card = await cashCard(ctx, self.partnerId);
    const firstWeek = await firstWeekOf(ctx, card.firstEntryAt);
    const week = await weekBlock(ctx, self.partnerId, frame, clock.today, now, firstWeek);
    const todayFrom = frame.starts.get(clock.today) ?? frame.from;
    const tomorrow = frame.starts.get(addDays(clock.today, 1)) ?? frame.to;
    const todayEntries = await repo.listEntries(ctx, self.partnerId, {
      from: todayFrom,
      to: tomorrow,
    });
    const sessions = await repo.listSessions(ctx, self.partnerId, todayFrom, tomorrow);
    const day = week.days.find((entry) => entry.date === clock.today);
    const goalCents = self.status === 'APPROVED' ? self.goalCents : null;
    return {
      asOf: clock.now.toISOString(),
      storeTimeZone: clock.zone,
      practice: false,
      readOnly: self.status !== 'APPROVED',
      version: card.version,
      hasEntries: card.hasEntries,
      firstWeekStart: firstWeek,
      today: {
        date: clock.today,
        earnedCents: day?.earnedCents ?? 0,
        deliveries: day?.deliveries ?? 0,
        tipsCents: todayEntries
          .filter((entry) => entry.kind === 'TIP')
          .reduce((total, entry) => total + entry.amountCents, 0),
        onlineSeconds: onlineSecondsWithin(sessions, todayFrom, tomorrow, now),
        goalCents,
        goalReachedAt: goalReachedAt(
          todayEntries.map((entry) => ({
            at: entry.at.toISOString(),
            kind: entry.kind,
            amountCents: entry.amountCents,
          })),
          goalCents,
        ),
        nextDayAt: tomorrow.toISOString(),
      },
      week,
      cash: {
        state: card.state,
        balanceCents: card.balanceCents,
        holdingCents: card.holdingCents,
        hasEntries: card.hasEntries,
        breakdown: card.breakdown,
      },
    };
  });
}

/** `GET /api/v1/partner/earnings/entries?weekStart=` (B3, P54, P55). */
export async function getEarningsWeek(
  actor: UserActor,
  query: unknown,
  now = new Date(),
): Promise<EarningsWeek> {
  const { weekStart } = earningsWeekQuery.parse(query);
  if (!isMonday(weekStart))
    throw invalidInput(EARNINGS_FIELD_ERRORS.week, { weekStart: [EARNINGS_FIELD_ERRORS.week] });
  return runAs(actor, async (ctx) => {
    const self = await partnerSelf(ctx, actor);
    const clock = await repo.storeClock(ctx);
    if (weekStart > mondayOf(clock.today)) {
      throw invalidInput(EARNINGS_FIELD_ERRORS.week, { weekStart: [EARNINGS_FIELD_ERRORS.week] });
    }
    const frame = await weekFrame(ctx, weekStart);
    if (self.practice) {
      const summary = practiceSummary(
        clock,
        await weekFrame(ctx, mondayOf(clock.today), [addDays(clock.today, 1)]),
      );
      if (weekStart !== mondayOf(clock.today)) {
        return {
          ...summary.week,
          start: weekStart,
          end: addDays(weekStart, 6),
          isCurrent: false,
          earnedCents: 0,
          deliveries: 0,
          tipsCents: 0,
          onlineSeconds: 0,
          days: frame.dates.map((date) => ({
            date,
            earnedCents: 0,
            deliveries: 0,
            state: 'past' as const,
          })),
          practice: true,
          groups: [],
        };
      }
      let offset = 0;
      const groups = practiceDays(clock.today)
        .map((day) => {
          const rows = practiceRows(day, frame.starts.get(day.date) ?? frame.from, offset);
          offset += day.deliveries;
          return { date: day.date, earnedCents: day.earnedCents, rows };
        })
        .toReversed();
      return { ...summary.week, practice: true, groups };
    }
    const ledger = await repo.findLedger(ctx, self.partnerId);
    const firstWeek = await firstWeekOf(ctx, ledger?.firstEntryAt ?? null);
    const block = await weekBlock(ctx, self.partnerId, frame, clock.today, now, firstWeek);
    const entries = await repo.listEntries(ctx, self.partnerId, { from: frame.from, to: frame.to });
    const deliveryIds = [
      ...new Set(entries.flatMap((entry) => (entry.deliveryId ? [entry.deliveryId] : []))),
    ];
    const facts = await repo.partnerDeliveryFacts(ctx, deliveryIds);
    const words = new Map(
      facts.map((fact) => [
        fact.deliveryId,
        { orderNumber: fact.orderNumber, areaWords: cityAndZip(fact.addressCity) },
      ]),
    );
    const groups = partnerRows(
      entries.map((entry) => ({
        id: entry.id,
        kind: entry.kind,
        reason: entry.reason,
        amountCents: entry.amountCents,
        at: entry.at.toISOString(),
        date: entry.date,
        deliveryId: entry.deliveryId,
        message: entry.message,
        method: entry.method,
        reference: entry.reference,
      })),
      words,
    );
    return { ...block, practice: false, groups };
  });
}

/** `GET /api/v1/partner/earnings/deliveries/{id}` (P55.2): never the customer's details. */
export async function getEarningsDelivery(
  actor: UserActor,
  params: unknown,
): Promise<EarningsDeliveryDetail> {
  const { deliveryId } = earningsDeliveryParams.parse(params);
  return runAs(actor, async (ctx) => {
    const self = await partnerSelf(ctx, actor);
    if (self.practice) throw deliveryNotFound();
    const entries = await repo.listEntries(ctx, self.partnerId, { deliveryId });
    const [facts] = await repo.partnerDeliveryFacts(ctx, [deliveryId]);
    if (entries.length === 0 || !facts) throw deliveryNotFound();
    const amount = (kind: EarningKind) =>
      entries
        .filter((entry) => entry.kind === kind)
        .reduce((total, entry) => total + entry.amountCents, 0);
    const cancelled = entries.some((entry) => entry.reason === 'cancelled-after-pickup');
    const feeCents = amount('DELIVERY_FEE');
    const tipCents = amount('TIP');
    const cash = -amount('CASH_COLLECTED');
    const steps: EarningsDeliveryDetail['steps'] = [];
    if (facts.acceptedAt) steps.push({ kind: 'accepted', at: facts.acceptedAt.toISOString() });
    if (facts.pickedUpAt) steps.push({ kind: 'pickedUp', at: facts.pickedUpAt.toISOString() });
    if (cancelled && facts.endedAt)
      steps.push({ kind: 'cancelled', at: facts.endedAt.toISOString() });
    if (!cancelled && facts.deliveredAt)
      steps.push({ kind: 'delivered', at: facts.deliveredAt.toISOString() });
    let how: EarningsDeliveryDetail['how'] = 'admin-override';
    if (cancelled) how = 'cancelled-after-pickup';
    else if (
      facts.handoverHow === 'code' ||
      facts.handoverHow === 'staff-confirmed' ||
      facts.handoverHow === 'demo'
    ) {
      how = facts.handoverHow;
    }
    return {
      deliveryId,
      orderNumber: facts.orderNumber,
      date: entries[0]!.date,
      areaWords: cityAndZip(facts.addressCity),
      distanceKm: facts.distanceKm,
      steps,
      feeCents,
      tipCents,
      tipPaid: !cancelled && tipCents > 0,
      totalCents: feeCents + tipCents,
      cashCents: cash > 0 ? cash : null,
      how,
      orderTipCents: facts.tipCents ?? tipCents,
    };
  });
}

/** `PUT /api/v1/partner/earnings/goal` (P53): approved partners only; never the demo. */
export async function setEarningsGoal(
  actor: UserActor,
  body: unknown,
): Promise<{ goalCents: number | null }> {
  const { cents } = goalInput.parse(body);
  if (actor.isDemo) throw new AppError('DEMO_READ_ONLY', "Goals aren't saved in the demo.", 403);
  const partnerId = await runAs(actor, async (ctx) => {
    const self = await partnerSelf(ctx, actor);
    if (self.status !== 'APPROVED' || !(await repo.setDailyGoal(ctx, cents))) {
      throw new AppError('PARTNER_SUSPENDED', 'Your partner account is suspended.', 403);
    }
    return self.partnerId;
  });
  await announceEarnings(partnerId);
  return { goalCents: cents };
}

/** Today's figures for F6's home and F8's hand-over answer, in the caller's transaction. */
export async function todayLineIn(
  ctx: DbContext,
  partnerId: string,
  practice = false,
): Promise<TodayLine> {
  if (practice)
    return { earnedCents: PRACTICE_TODAY.earnedCents, deliveries: PRACTICE_TODAY.deliveries };
  const clock = await repo.storeClock(ctx);
  const [day] = await repo.listDays(ctx, partnerId, clock.today, clock.today);
  return { earnedCents: day ? earnedOf(day) : 0, deliveries: day?.deliveries ?? 0 };
}

/** P57.3: the fee he keeps for an order cancelled after pickup, in the caller's transaction. */
export function cancelledFeeIn(
  ctx: DbContext,
  partnerId: string,
  orderNumber: string,
): Promise<number | null> {
  return repo.cancelledFee(ctx, partnerId, orderNumber);
}

// ------------------------------------------------------------------ staff: who may read (A57–A66)

interface StaffViewer {
  userId: string;
  role: UserActor['role'];
  isDemo: boolean;
}

async function staffViewer(
  actor: UserActor,
  permission: Permission,
  write: boolean,
): Promise<StaffViewer> {
  const checked = await requirePermission(permission, { write, demoMessage: DEMO_READ_ONLY });
  if (checked.userId !== actor.userId) throw unauthenticated();
  return { userId: checked.userId, role: checked.role, isDemo: checked.isDemo };
}

/**
 * A partner's name for staff: `partner_directory` already applies F6's rule for the demo admin
 * (demo and sample partners shown, every other real partner masked). Figures stay hidden for
 * every non-demo partner (`hiddenForDemo`), whatever the name shows (A66, gate S3).
 */
function visibleName(partner: repo.StaffPartnerRow) {
  return partner.deleted ? deletedPartnerName(partner.id) : partner.name;
}

const hiddenForDemo = (partner: repo.StaffPartnerRow, viewer: StaffViewer) =>
  viewer.isDemo && !partner.isDemo;

async function rangeInstants(ctx: DbContext, from: string, to: string) {
  const starts = await repo.dayStarts(ctx, [from, addDays(to, 1)]);
  return {
    from: starts.get(from) ?? new Date(`${from}T00:00:00Z`),
    to: starts.get(addDays(to, 1)) ?? new Date(`${addDays(to, 1)}T00:00:00Z`),
  };
}

function toLedgerRow(row: repo.StaffLedgerRow, viewer: StaffViewer): LedgerRow {
  const staff = row.recordedKind === 'staff' && row.recordedName && row.recordedRole;
  return {
    id: row.id,
    at: row.at.toISOString(),
    kind: row.kind,
    reason: row.reason,
    message: row.message,
    staffNote: viewer.isDemo ? null : row.staffNote,
    orderId: row.orderId,
    orderNumber: row.orderNumber,
    amountCents: row.amountCents,
    balanceAfterCents: row.balanceAfterCents,
    recordedBy: staff
      ? {
          kind: 'staff',
          name: row.recordedName ?? 'Staff member',
          role: row.recordedRole ?? 'support',
        }
      : { kind: 'system' },
    method: row.method,
    reference: row.reference,
    paidOn: row.paidOn,
  };
}

/** The partner page's Earnings section (A59) for SUPPORT, ADMIN and the demo admin. */
export async function getPartnerEarnings(
  actor: UserActor,
  input: unknown,
  now = new Date(),
): Promise<PartnerEarningsPage | null> {
  const query = partnerEarningsInput.parse(input);
  const viewer = await staffViewer(actor, STAFF_READ, false);
  const fresh = viewer.isDemo ? null : await stepUpFreshUntilFor(actor, now);
  return runAs(actor, async (ctx) => {
    const partner = await repo.findPartnerForStaff(ctx, query.partnerId);
    if (!partner) return null;
    const clock = await repo.storeClock(ctx);
    const monday = mondayOf(clock.today);
    const from = query.from ?? monday;
    const to = query.to && query.to >= from ? query.to : query.from ? from : addDays(monday, 6);
    const base = {
      partnerId: partner.id,
      name: visibleName(partner),
      masked: partner.masked,
      deleted: partner.deleted,
      asOf: clock.now.toISOString(),
      range: { from, to },
    };
    const hidden = hiddenForDemo(partner, viewer);
    const ledger = hidden ? null : await repo.findLedger(ctx, partner.id);
    const balanceCents = Number(ledger?.balanceCents ?? 0);
    const holdingCents = Number(ledger?.holdingCents ?? 0);
    const owed = owedAmber(Math.max(0, -balanceCents), ledger?.owedSince ?? null, now);
    const weekDays = hidden ? [] : await repo.listDays(ctx, partner.id, monday, addDays(monday, 6));
    const payout = ledger?.lastPayoutEntryId
      ? await repo.findEntryVersion(ctx, ledger.lastPayoutEntryId)
      : null;
    const instants = await rangeInstants(ctx, from, to);
    const page = Math.max(1, query.page);
    const total = hidden ? 0 : await repo.countStaffLedgerRows(ctx, partner.id, instants);
    const rows = hidden
      ? []
      : await repo.staffLedgerRows(ctx, partner.id, instants, {
          dir: query.dir,
          limit: EARNINGS_LIMITS.pageSize,
          offset: (page - 1) * EARNINGS_LIMITS.pageSize,
        });
    const canWrite = !viewer.isDemo;
    const firstName = firstNameOf(base.name);
    return {
      ...base,
      hiddenForDemo: hidden,
      version: ledger?.version ?? 0,
      balance: {
        state: balanceState(balanceCents),
        balanceCents,
        holdingCents,
        owedSince: balanceCents < 0 ? (ledger?.owedSince?.toISOString() ?? null) : null,
        amber: owed.amber,
        why: owed.why,
      },
      week: {
        start: monday,
        end: addDays(monday, 6),
        deliveries: sumDays(weekDays, (day) => day.deliveries),
        earnedCents: sumDays(weekDays, earnedOf),
        tipsCents: sumDays(weekDays, (day) => day.tipsCents),
        cashCollectedCents: sumDays(weekDays, (day) => day.cashCollectedCents),
        cashHandedInCents: sumDays(weekDays, (day) => day.cashHandedInCents),
      },
      lastPayout:
        payout && isPayoutMethod(payout.method) && payout.paidOn
          ? {
              at: payout.occurredAt.toISOString(),
              paidOn: payout.paidOn.toISOString().slice(0, 10),
              amountCents: -payout.amountCents,
              method: payout.method,
              reference: payout.reference,
            }
          : null,
      entries: {
        rows: rows.map((row) => toLedgerRow(row, viewer)),
        total,
        page,
        pageCount: Math.max(1, Math.ceil(total / EARNINGS_LIMITS.pageSize)),
        pageSize: EARNINGS_LIMITS.pageSize,
        dir: query.dir,
      },
      actions: {
        recordCash:
          canWrite && !hidden && can(viewer.role, DIALOG_PERMISSION.cash) && holdingCents > 0,
        adjust: canWrite && !hidden && can(viewer.role, DIALOG_PERMISSION.adjust),
        payout:
          canWrite && !hidden && can(viewer.role, DIALOG_PERMISSION.payout) && balanceCents > 0,
        csv: !hidden && can(viewer.role, REPORT),
        stepUpRequired: !fresh || fresh.getTime() <= now.getTime(),
        readOnlyDemo: viewer.isDemo,
        whyNot: {
          recordCash: holdingCents > 0 ? null : `${firstName} isn't holding any cash.`,
          payout: balanceCents > 0 ? null : `Foodz doesn't owe ${firstName} anything right now.`,
        },
      },
    };
  });
}

/** A67.2: a money dialog opens with a fresh key and the ledger version. */
export async function openMoneyDialog(
  actor: UserActor,
  input: unknown,
  now = new Date(),
): Promise<MoneyDialogOpening> {
  const { partnerId, kind } = openMoneyDialogInput.parse(input);
  const viewer = await staffViewer(actor, DIALOG_PERMISSION[kind], false);
  const fresh = viewer.isDemo ? null : await stepUpFreshUntilFor(actor, now);
  return runAs(actor, async (ctx) => {
    const partner = await repo.findPartnerForStaff(ctx, partnerId);
    if (!partner || hiddenForDemo(partner, viewer)) throw partnerNotFound();
    const ledger = await repo.findLedger(ctx, partnerId);
    const balanceCents = Number(ledger?.balanceCents ?? 0);
    const holdingCents = Number(ledger?.holdingCents ?? 0);
    const name = visibleName(partner);
    const first = firstNameOf(name);
    let applies = !viewer.isDemo && !partner.isDemo;
    let whyNot: string | null = viewer.isDemo ? DEMO_READ_ONLY : null;
    if (applies && kind === 'cash' && holdingCents <= 0) {
      applies = false;
      whyNot = `${first} isn't holding any cash.`;
    }
    if (applies && kind === 'payout' && balanceCents <= 0) {
      applies = false;
      whyNot = `Foodz doesn't owe ${first} anything right now.`;
    }
    let defaultAmountCents: number | null = null;
    let maxAmountCents: number | null = EARNINGS_LIMITS.adjustMaxCents;
    if (kind === 'cash') {
      defaultAmountCents = defaultCashAmount(balanceCents, holdingCents);
      maxAmountCents = holdingCents;
    } else if (kind === 'payout') {
      defaultAmountCents = balanceCents > 0 ? balanceCents : null;
      maxAmountCents = Math.max(0, balanceCents);
    }
    return {
      partnerId,
      kind,
      idempotencyKey: randomUUID(),
      version: ledger?.version ?? 0,
      balanceCents,
      holdingCents,
      owedCents: Math.max(0, -balanceCents),
      defaultAmountCents,
      maxAmountCents,
      stepUpRequired: kind !== 'cash' && (!fresh || fresh.getTime() <= now.getTime()),
      partnerName: name,
      partnerFirstName: first,
      applies,
      whyNot,
    };
  });
}

// ------------------------------------------------------------------ staff money actions (A60–A62)

type MoneyValues =
  | { kind: 'cash'; values: ReturnType<typeof recordCashInput.parse> }
  | { kind: 'adjust'; values: ReturnType<typeof adjustEarningsInput.parse> }
  | { kind: 'payout'; values: ReturnType<typeof recordPayoutInput.parse> };

const AUDIT_ACTION: Record<MoneyDialogKind, string> = {
  cash: 'earnings.cash-recorded',
  adjust: 'earnings.adjusted',
  payout: 'earnings.payout-recorded',
};

function entryCall(money: MoneyValues): Omit<repo.StaffEntryCall, 'partnerId'> {
  const { values } = money;
  const common = {
    amountCents: values.amount,
    expectedVersion: values.expectedVersion,
    idempotencyKey: values.idempotencyKey,
    staffNote: values.note ?? null,
  };
  if (money.kind === 'cash') {
    return {
      ...common,
      kind: 'CASH_HANDED_IN',
      direction: null,
      reason: null,
      message: null,
      orderNumber: null,
      method: null,
      reference: null,
      paidOn: null,
    };
  }
  if (money.kind === 'payout') {
    return {
      ...common,
      kind: 'PAYOUT',
      direction: null,
      reason: null,
      message: null,
      orderNumber: null,
      method: money.values.method,
      reference: money.values.reference ?? null,
      paidOn: money.values.paidOn,
    };
  }
  const bonus = money.values.reason === 'bonus';
  return {
    ...common,
    kind: bonus ? 'BONUS' : 'ADJUSTMENT',
    direction: money.values.direction,
    reason: bonus ? null : money.values.reason,
    message: money.values.message ?? null,
    orderNumber: money.values.orderNumber ?? null,
    method: null,
    reference: null,
    paidOn: null,
  };
}

function overLimit(outcome: repo.StaffEntryOutcome, name: string, money: MoneyValues): AppError {
  const first = firstNameOf(name);
  const holding = formatPrice(outcome.holdingCents ?? 0);
  const balance = formatPrice(Math.max(0, outcome.balanceCents ?? 0));
  switch (outcome.which) {
    case 'holding': {
      const message = `${first} is holding ${holding}, so enter ${holding} or less.`;
      return invalidInput(message, { amount: [message] });
    }
    case 'balance': {
      const message = `Foodz owes ${first} ${balance}, so enter ${balance} or less.`;
      return invalidInput(message, { amount: [message] });
    }
    case 'adjust-cap':
      return invalidInput(EARNINGS_FIELD_ERRORS.adjustCap, {
        amount: [EARNINGS_FIELD_ERRORS.adjustCap],
      });
    case 'paid-on': {
      const message =
        money.kind === 'payout' && money.values.paidOn < new Date().toISOString().slice(0, 10)
          ? 'Enter a date within the last year.'
          : EARNINGS_FIELD_ERRORS.futureDate;
      return invalidInput(message, { paidOn: [message] });
    }
    case 'nothing-held':
      return conflict(`${first} isn't holding any cash.`);
    case 'nothing-owed':
    default:
      return conflict(`Foodz doesn't owe ${first} anything right now.`);
  }
}

async function moneyAction(
  actor: UserActor,
  money: MoneyValues,
  now: Date,
): Promise<MoneyActionResult> {
  await staffViewer(actor, DIALOG_PERMISSION[money.kind], true);
  if (money.kind !== 'cash') {
    const fresh = await stepUpFreshUntilFor(actor, now);
    if (!fresh || fresh.getTime() <= now.getTime()) {
      await passStepUp(actor, money.values.stepUp, now, 'earnings');
    }
  }
  const call = entryCall(money);
  const done = await runAs(actor, async (ctx) => {
    const partner = await repo.findPartnerForStaff(ctx, money.values.partnerId);
    if (!partner || partner.isDemo) throw partnerNotFound();
    const clock = await repo.storeClock(ctx);
    const outcome = await repo.recordStaffEntry(ctx, { ...call, partnerId: partner.id });
    if (outcome.outcome === 'recorded') {
      await audit(ctx, {
        action: AUDIT_ACTION[money.kind],
        targetType: 'partner',
        targetId: partner.id,
        data: {
          entryId: outcome.entryId ?? null,
          amountCents: outcome.amountCents ?? null,
          kind: call.kind,
          reason: call.reason,
          method: call.method,
          paidOn: call.paidOn,
          orderNumber: call.orderNumber,
          hasNote: Boolean(call.staffNote),
          hasReference: Boolean(call.reference),
        },
      });
    }
    return { partner, outcome, zone: clock.zone };
  });
  const { partner, outcome } = done;
  if (outcome.outcome === 'not-found') throw partnerNotFound();
  if (outcome.outcome === 'not-his-order') {
    const message = `${firstNameOf(partner.name)} didn't have order ${call.orderNumber ?? ''}.`;
    throw invalidInput(message, { orderNumber: [message] });
  }
  if (outcome.outcome === 'over-limit') throw overLimit(outcome, partner.name, money);
  if (outcome.outcome === 'changed') {
    const balanceCents = outcome.balanceCents ?? 0;
    const holdingCents = outcome.holdingCents ?? 0;
    const latest = outcome.latest ?? null;
    const closeOnly =
      (money.kind === 'payout' && (balanceCents <= 0 || latest?.kind === 'PAYOUT')) ||
      (money.kind === 'cash' && holdingCents <= 0);
    const words = ledgerChangedWords({
      latest,
      partnerName: partner.name,
      balanceCents,
      holdingCents,
      closeOnly,
      timeZone: done.zone,
    });
    const details: LedgerChangedDetails = {
      partnerId: partner.id,
      version: outcome.version ?? 0,
      balanceCents,
      holdingCents,
      closeOnly,
      words,
      latest: latest
        ? {
            kind: latest.kind,
            amountCents: latest.amountCents,
            at: utcInstant(latest.at).toISOString(),
            byWords: latest.byName ?? 'Foodz',
            orderNumber: latest.orderNumber,
          }
        : null,
    };
    throw new AppError('LEDGER_CHANGED', words, 409, { details: { ...details } });
  }
  const kind = outcome.kind ?? call.kind;
  const amountCents = outcome.amountCents ?? 0;
  if (outcome.outcome === 'recorded') {
    await notifyPartnerOfEntry(partner.userId, {
      kind,
      amountCents,
      message: call.message,
      method: call.method,
    });
    await announceEarnings(partner.id);
  }
  return {
    entryId: outcome.entryId ?? '',
    kind,
    amountCents,
    version: outcome.version ?? 0,
    balanceCents: outcome.balanceCents ?? 0,
    holdingCents: outcome.holdingCents ?? 0,
    replayed: outcome.outcome === 'replayed',
    boardNotice: boardNotice(kind, amountCents, partner.name),
  };
}

export function recordCashHandIn(actor: UserActor, input: unknown, now = new Date()) {
  return moneyAction(actor, { kind: 'cash', values: recordCashInput.parse(input) }, now);
}

export function adjustEarnings(actor: UserActor, input: unknown, now = new Date()) {
  return moneyAction(actor, { kind: 'adjust', values: adjustEarningsInput.parse(input) }, now);
}

export function recordPayout(actor: UserActor, input: unknown, now = new Date()) {
  return moneyAction(actor, { kind: 'payout', values: recordPayoutInput.parse(input) }, now);
}

// ------------------------------------------------------------------ the report (A63, A66)

const SORT_VALUE: Record<EarningsReportQuery['sort'], (row: ReportRow) => number | string> = {
  partner: (row) => row.name.toLowerCase(),
  deliveries: (row) => row.figures?.deliveries ?? Number.NEGATIVE_INFINITY,
  deliveryPay: (row) => row.figures?.deliveryPayCents ?? Number.NEGATIVE_INFINITY,
  tips: (row) => row.figures?.tipsCents ?? Number.NEGATIVE_INFINITY,
  adjustments: (row) => row.figures?.adjustmentsCents ?? Number.NEGATIVE_INFINITY,
  earned: (row) => row.figures?.earnedCents ?? Number.NEGATIVE_INFINITY,
  cashCollected: (row) => row.figures?.cashCollectedCents ?? Number.NEGATIVE_INFINITY,
  cashHandedIn: (row) => row.figures?.cashHandedInCents ?? Number.NEGATIVE_INFINITY,
  paidOut: (row) => row.figures?.paidOutCents ?? Number.NEGATIVE_INFINITY,
  opening: (row) => row.figures?.openingCents ?? Number.NEGATIVE_INFINITY,
  closing: (row) => row.figures?.closingCents ?? Number.NEGATIVE_INFINITY,
};

function compareRows(sort: EarningsReportQuery['sort'], dir: 'asc' | 'desc') {
  const value = SORT_VALUE[sort];
  return (a: ReportRow, b: ReportRow) => {
    if (a.hidden !== b.hidden) return a.hidden ? 1 : -1;
    const x = value(a);
    const y = value(b);
    let order = 0;
    if (typeof x === 'string' && typeof y === 'string') order = x.localeCompare(y);
    else order = Number(x) - Number(y);
    if (order === 0) order = a.name.localeCompare(b.name) || a.partnerId.localeCompare(b.partnerId);
    return dir === 'asc' ? order : -order;
  };
}

function checkReportDates(query: { from: string; to: string }, today: string) {
  if (query.from > today) {
    throw invalidInput(EARNINGS_FIELD_ERRORS.rangeFuture, {
      from: [EARNINGS_FIELD_ERRORS.rangeFuture],
    });
  }
  if (query.to > latestReportDay(today)) {
    throw invalidInput(EARNINGS_FIELD_ERRORS.rangeFuture, {
      to: [EARNINGS_FIELD_ERRORS.rangeFuture],
    });
  }
}

interface ReportData {
  rows: ReportRow[];
  filtered: ReportRow[];
  clock: { today: string; now: Date; zone: string };
}

async function reportData(
  ctx: DbContext,
  viewer: StaffViewer,
  query: Omit<EarningsReportQuery, 'page'>,
): Promise<ReportData> {
  const clock = await repo.storeClock(ctx);
  checkReportDates(query, clock.today);
  const sums = await repo.reportSums(ctx, query, viewer.isDemo ? 'DEMO' : 'REAL');
  const rows: ReportRow[] = [];
  for (const sum of sums) {
    const figures = reportFigures(
      {
        deliveries: sum.deliveries,
        deliveryPayCents: sum.deliveryPayCents,
        tipsCents: sum.tipsCents,
        adjustmentsCents: sum.adjustmentsCents,
        cashCollectedCents: sum.cashCollectedCents,
        cashHandedInCents: sum.cashHandedInCents,
        paidOutCents: sum.paidOutCents,
      },
      sum.openingCents,
    );
    if (sum.activeDays === 0 && figures.openingCents === 0 && figures.closingCents === 0) continue;
    rows.push({
      partnerId: sum.partnerId,
      name: sum.deleted ? deletedPartnerName(sum.partnerId) : sum.name,
      deleted: sum.deleted,
      masked: sum.masked,
      hidden: false,
      vehicle: sum.vehicle,
      figures,
    });
  }
  if (viewer.isDemo) {
    for (const real of await repo.realPartnersForDemo(ctx)) {
      rows.push({
        partnerId: real.partnerId,
        name: real.name,
        deleted: false,
        masked: real.masked,
        hidden: true,
        vehicle: real.vehicle,
        figures: null,
      });
    }
  }
  const q = query.q.toLowerCase();
  const filtered = rows
    .filter((row) => !q || row.name.toLowerCase().includes(q))
    .filter((row) => {
      if (query.filter === 'all') return true;
      if (!row.figures) return false;
      return query.filter === 'foodz-owes'
        ? row.figures.closingCents > 0
        : row.figures.closingCents < 0;
    })
    .toSorted(compareRows(query.sort, query.dir));
  return { rows, filtered, clock };
}

const withFigures = (list: readonly ReportRow[]) =>
  list.flatMap((row) => (row.figures ? [row.figures] : []));

/** `getEarningsReport` (A63): ADMIN only; the demo admin sees demo partners' figures. */
export async function getEarningsReport(actor: UserActor, input: unknown): Promise<EarningsReport> {
  const query = earningsReportInput.parse(input);
  const viewer = await staffViewer(actor, REPORT, false);
  return runAs(actor, async (ctx) => {
    const { rows, filtered, clock } = await reportData(ctx, viewer, query);
    const all = withFigures(rows);
    const shown = withFigures(filtered);
    const sum = (list: typeof shown, pick: (figures: (typeof shown)[number]) => number) =>
      list.reduce((total, figures) => total + pick(figures), 0);
    const owedTo = all.filter((figures) => figures.closingCents > 0);
    const owedBy = all.filter((figures) => figures.closingCents < 0);
    const pageCount = Math.max(1, Math.ceil(filtered.length / EARNINGS_LIMITS.pageSize));
    const page = Math.min(query.page, pageCount);
    return {
      asOf: clock.now.toISOString(),
      query: { ...query, page },
      range: { from: query.from, to: query.to },
      summary: {
        owedToPartnersCents: sum(owedTo, (figures) => figures.closingCents),
        owedToPartnersCount: owedTo.length,
        owedByPartnersCents: -sum(owedBy, (figures) => figures.closingCents),
        owedByPartnersCount: owedBy.length,
      },
      rows: filtered.slice((page - 1) * EARNINGS_LIMITS.pageSize, page * EARNINGS_LIMITS.pageSize),
      total: filtered.length,
      page,
      pageCount,
      pageSize: EARNINGS_LIMITS.pageSize,
      totals: {
        partners: filtered.length,
        deliveries: sum(shown, (figures) => figures.deliveries),
        deliveryPayCents: sum(shown, (figures) => figures.deliveryPayCents),
        tipsCents: sum(shown, (figures) => figures.tipsCents),
        adjustmentsCents: sum(shown, (figures) => figures.adjustmentsCents),
        earnedCents: sum(shown, (figures) => figures.earnedCents),
        cashCollectedCents: sum(shown, (figures) => figures.cashCollectedCents),
        cashHandedInCents: sum(shown, (figures) => figures.cashHandedInCents),
        paidOutCents: sum(shown, (figures) => figures.paidOutCents),
        opening: splitBalances(shown.map((figures) => figures.openingCents)),
        closing: splitBalances(shown.map((figures) => figures.closingCents)),
      },
      totalsCoverDemoOnly: viewer.isDemo,
    };
  });
}

// ------------------------------------------------------------------ CSV (A64)

const REPORT_HEADER = [
  'Partner ID',
  'Partner',
  'Vehicle',
  'From',
  'To',
  'Deliveries',
  'Delivery pay',
  'Tips',
  'Bonuses and adjustments',
  'Earned',
  'Cash collected',
  'Cash handed in',
  'Paid out',
  'Opening balance',
  'Closing balance',
];

const ENTRIES_HEADER = ['Time', 'Kind', 'Order', 'Amount', 'Message to partner', 'Recorded by'];

export interface CsvFile {
  fileName: string;
  body: string;
  rows: number;
}

/** "2026-11-20T19:46:00-05:00": the instant with the store's offset (A64.4). */
function isoWithOffset(at: Date, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
      timeZoneName: 'longOffset',
    })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  );
  const offset = (parts.timeZoneName ?? 'GMT').replace('GMT', '') || '+00:00';
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`;
}

/** `POST /admin/partners/earnings/export`: every row of the range and filter (A64.1–A64.3). */
export async function exportEarningsReport(actor: UserActor, input: unknown): Promise<CsvFile> {
  const query = reportExportInput.parse(input);
  const viewer = await staffViewer(actor, REPORT, false);
  return runAs(actor, async (ctx) => {
    const { filtered } = await reportData(ctx, viewer, query);
    const rows: CsvCell[][] = filtered.flatMap((row) =>
      row.figures ? [reportCsvRow(row, query, row.figures)] : [],
    );
    await audit(ctx, {
      action: 'report.exported',
      targetType: 'report',
      targetId: 'partner-earnings',
      data: {
        kind: 'report',
        from: query.from,
        to: query.to,
        filter: query.filter,
        hasSearch: Boolean(query.q),
        rows: rows.length,
      },
    });
    return {
      fileName: `foodz-partner-earnings-${query.from}-to-${query.to}.csv`,
      body: toCsv(REPORT_HEADER, rows),
      rows: rows.length,
    };
  });
}

/** `POST /admin/partners/{id}/earnings/export`: one partner's entries (A64.4). */
export async function exportPartnerEntries(
  actor: UserActor,
  rawPartnerId: string,
  input: unknown,
): Promise<CsvFile> {
  const partnerId = z.uuid().parse(rawPartnerId);
  const query = entriesExportInput.parse(input);
  const viewer = await staffViewer(actor, REPORT, false);
  return runAs(actor, async (ctx) => {
    const partner = await repo.findPartnerForStaff(ctx, partnerId);
    if (!partner || hiddenForDemo(partner, viewer)) throw partnerNotFound();
    const clock = await repo.storeClock(ctx);
    checkReportDates(query, clock.today);
    const instants = await rangeInstants(ctx, query.from, query.to);
    const entries = await repo.staffLedgerRows(ctx, partner.id, instants, {
      dir: 'asc',
      limit: 100_000,
      offset: 0,
    });
    const rows: CsvCell[][] = entries.map((entry) => {
      const row = toLedgerRow(entry, viewer);
      return [
        isoWithOffset(entry.at, clock.zone),
        entryWords(row.kind, row.reason, row.amountCents, row.method),
        row.orderNumber,
        moneyCell(row.amountCents),
        row.message,
        recordedByRole(row.recordedBy),
      ];
    });
    await audit(ctx, {
      action: 'report.exported',
      targetType: 'partner',
      targetId: partner.id,
      data: { kind: 'entries', from: query.from, to: query.to, rows: rows.length },
    });
    return {
      fileName: `foodz-partner-entries-${query.from}-to-${query.to}.csv`,
      body: toCsv(ENTRIES_HEADER, rows),
      rows: rows.length,
    };
  });
}

// ------------------------------------------------------------------ the partners list (A57)

/**
 * The money columns for a page of the partners list, keyed by partner. Real partners' money is
 * hidden from the demo admin (A66.1).
 */
export async function partnerListMoney(
  actor: UserActor,
  partnerIds: readonly string[],
  now: Date,
): Promise<Map<string, PartnerListMoney>> {
  const viewer = { role: actor.role, isDemo: actor.isDemo };
  const rows = await runAs(actor, async (ctx) => {
    const clock = await repo.storeClock(ctx);
    const monday = mondayOf(clock.today);
    return repo.listMoney(ctx, partnerIds, { from: monday, to: addDays(monday, 6) });
  });
  const demoRatings = viewer.isDemo
    ? new Map(
        (
          await runAsSystem('demo partner ratings', (system) =>
            repo.demoPartnerRatings(system, partnerIds),
          )
        ).map((row) => [row.id, row]),
      )
    : new Map();
  const money = new Map<string, PartnerListMoney>();
  for (const row of rows) {
    const hidden = viewer.isDemo && !row.isDemo;
    // A66.3: real staff never see a demo partner's figures (practice ratings, demo runs), the
    // isolation F8 keeps for demo runs: the columns read "—" for them.
    const otherPool = !viewer.isDemo && row.isDemo;
    const demo = demoRatings.get(row.partnerId);
    const ratingCount = demo ? demo.ratingCount : row.ratingCount;
    const ratingAvg = demo ? demo.ratingAvg : row.ratingAvg;
    const balance = row.balanceCents ?? 0;
    const owedCents = Math.max(0, -balance);
    const amber = owedAmber(owedCents, row.owedSince, now);
    money.set(row.partnerId, {
      hidden,
      rating:
        hidden || otherPool || ratingCount === 0
          ? null
          : { average: ratingAvg, count: ratingCount, shownToCustomers: ratingCount >= 5 },
      week:
        hidden || otherPool || row.weekDeliveries + row.weekEarnedCents === 0
          ? null
          : { deliveries: row.weekDeliveries, earnedCents: row.weekEarnedCents },
      cash:
        hidden || otherPool || owedCents === 0 || !row.owedSince
          ? null
          : { owedCents, since: row.owedSince.toISOString(), amber: amber.amber, why: amber.why },
      holdingCents: hidden || otherPool ? 0 : (row.holdingCents ?? 0),
      actions: {
        recordCash:
          !viewer.isDemo &&
          !otherPool &&
          can(viewer.role, DIALOG_PERMISSION.cash) &&
          (row.holdingCents ?? 0) > 0,
      },
    });
  }
  return money;
}

// ------------------------------------------------------------------ nightly jobs (E7, U20)

/** E7: every mismatch raises one alert with the ids; nothing is fixed automatically. */
export async function reconcileEarnings(): Promise<repo.ReconcileResult & { ok: boolean }> {
  const result = await runAsSystem('earnings reconcile', (ctx) => repo.reconcile(ctx));
  const ok =
    result.deliveries.length +
      result.ledgers.length +
      result.sessions.length +
      result.stuckDeliveries.length ===
    0;
  if (!ok) {
    logger.error(
      { ...result, alert: 'earnings-reconcile-mismatch' },
      'earnings reconcile found mismatches',
    );
  }
  return { ...result, ok };
}

/** The nightly demo reset's ledger and ratings part (U20), then F8's finished demo orders. */
export async function resetDemoEarnings() {
  const result = await runAsSystem('demo reset', (ctx) => repo.resetDemo(ctx));
  if (result.orders < 0)
    logger.warn({ alert: 'demo-reset-orders' }, 'demo orders kept: something still points at them');
  return result;
}

// ------------------------------------------------------------------ account tie-ins (U22, F2)

export const BALANCE_NOT_SETTLED =
  "Your Foodz balance isn't settled yet. Call Foodz Kitchen before deleting your account.";

/** P61.2: in the deletion's transaction; refuses while the balance isn't zero. */
export async function settlePartnerForDeletionIn(ctx: DbContext): Promise<void> {
  if (!(await repo.settleForDeletion(ctx))) {
    throw new AppError('BALANCE_NOT_SETTLED', BALANCE_NOT_SETTLED, 409);
  }
}

/** The partner's part of "Download my data": his entries and goal, never a rating about him. */
export async function earningsExportFor(actor: UserActor) {
  return runAs(actor, async (ctx) => {
    const own = await repo.findOwnPartner(ctx, actor.userId);
    if (!own) return null;
    const entries = await repo.listEntries(ctx, own.id, {});
    return {
      dailyGoalCents: own.dailyGoalCents,
      entries: entries.map((entry) => ({
        at: entry.at.toISOString(),
        kind: entryWords(entry.kind, entry.reason, entry.amountCents, entry.method),
        amountCents: entry.amountCents,
        message: entry.message,
        reference: entry.reference,
      })),
    };
  });
}
