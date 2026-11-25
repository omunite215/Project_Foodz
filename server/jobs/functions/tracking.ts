import 'server-only';
import { trackingTimings } from '@/server/modules/tracking/rules';
import {
  demoFinish,
  demoPoint,
  demoPrepare,
  noAnswerDue,
  purgeOldLocations,
  refreshEstimate,
} from '@/server/modules/tracking/service';
import { inngest } from '../client';
import { deliveryAssignmentEnded } from '../dispatch-events';
import {
  deliveryNoAnswerStarted,
  deliveryReplanRequested,
  deliveryTrackingStarted,
  demoDeliveryRequested,
} from '../tracking-events';

/*
 * F8's four functions (contract §6). Every wait is a durable step, so nothing lives in an app
 * task's memory and a restart resumes where it left off (L11.1). The state each one acts on is
 * re-read from the database at every step.
 */

/** Far more turns than a delivery takes; past it the loop stops and logs. */
const MAX_ETA_TURNS = 400;

export const deliveryEta = inngest.createFunction(
  {
    id: 'delivery-eta',
    triggers: [deliveryTrackingStarted],
    // One loop per assignment: a re-assigned delivery (a new version) gets a fresh one.
    idempotency: 'event.data.deliveryId + "-" + string(event.data.version)',
    concurrency: { key: 'event.data.deliveryId', limit: 1 },
    cancelOn: [{ event: deliveryAssignmentEnded, match: 'data.deliveryId' }],
    retries: 3,
  },
  async ({ event, step }) => {
    const { etaSeconds } = trackingTimings(process.env);
    const turn = async (n: number): Promise<{ turns: number }> => {
      if (n >= MAX_ETA_TURNS) return { turns: n };
      const result = await step.run(`estimate-${n}`, () => refreshEstimate(event.data.deliveryId));
      if (!result.active) return { turns: n + 1 };
      await step.waitForEvent(`replan-${n}`, {
        event: deliveryReplanRequested,
        timeout: `${etaSeconds}s`,
        if: `async.data.deliveryId == ${JSON.stringify(event.data.deliveryId)}`,
      });
      return turn(n + 1);
    };
    return turn(0);
  },
);

/** U6: the 5-minute mark of "isn't answering" repaints the board and the phone. */
export const deliveryNoAnswer = inngest.createFunction(
  {
    id: 'delivery-no-answer',
    triggers: [deliveryNoAnswerStarted],
    idempotency: 'event.data.deliveryId + "-" + event.data.since',
    cancelOn: [{ event: deliveryAssignmentEnded, match: 'data.deliveryId' }],
    retries: 3,
  },
  async ({ event, step }) => {
    const { noAnswerSeconds } = trackingTimings(process.env);
    await step.sleepUntil(
      'wait for the clock',
      new Date(Date.parse(event.data.since) + noAnswerSeconds * 1000),
    );
    return step.run('due', () => noAnswerDue(event.data.deliveryId, event.data.since));
  },
);

/** L8.2: every night, positions and stored routes older than 30 days go. */
export const deliveryLocationsRetention = inngest.createFunction(
  {
    id: 'delivery-locations-retention',
    triggers: [{ cron: 'TZ=America/New_York 30 3 * * *' }],
    retries: 2,
  },
  async ({ step }) => step.run('purge', () => purgeOldLocations()),
);

/** L10: the demo courier's run, one at a time for the whole demo. */
export const demoDeliveryRun = inngest.createFunction(
  {
    id: 'demo-delivery-run',
    triggers: [demoDeliveryRequested],
    idempotency: 'event.data.runId',
    concurrency: { key: '"demo"', limit: 1 },
    retries: 2,
    onFailure: async ({ event, step }) => {
      await step.run('end the run', () => demoFinish(event.data.event.data.runId, null, false));
    },
  },
  async ({ event, step }) => {
    const { runId } = event.data;
    const prepared = await step.run('prepare', () => demoPrepare(runId));
    if (!prepared) {
      await step.run('no demo cast', () => demoFinish(runId, null, false));
      return { points: 0 };
    }
    const ride = async (index: number): Promise<number> => {
      if (index >= prepared.points) return index;
      const moved = await step.run(`point-${index}`, () => demoPoint(prepared.deliveryId, index));
      if (!moved) return index;
      await step.sleep(`gap-${index}`, '4s');
      return ride(index + 1);
    };
    const points = await ride(0);
    await step.sleep('at the door', '10s');
    await step.run('hand over', () => demoFinish(runId, prepared.deliveryId, true));
    return { points };
  },
);
