import { describe, expect, it } from 'vitest';
import { oneAtATime } from './one-at-a-time';

const tick = () => new Promise((resolve) => setTimeout(resolve, 1));

describe('oneAtATime', () => {
  it('runs tasks started together one after another, in the order they came', async () => {
    const run = oneAtATime();
    let running = 0;
    let most = 0;
    const order: number[] = [];
    const task = (n: number) => async () => {
      running += 1;
      most = Math.max(most, running);
      await tick();
      order.push(n);
      running -= 1;
      return n * 10;
    };

    const results = await Promise.all([run(task(1)), run(task(2)), run(task(3))]);

    expect(results).toEqual([10, 20, 30]);
    expect(order).toEqual([1, 2, 3]);
    expect(most).toBe(1);
  });

  it('passes a failure to its own caller and still runs the next task', async () => {
    const run = oneAtATime();
    const failed = run(async () => {
      await tick();
      throw new Error('relation does not exist');
    });
    const next = run(async () => 'ran');

    await expect(failed).rejects.toThrow('relation does not exist');
    await expect(next).resolves.toBe('ran');
  });

  it('keeps separate lines independent', async () => {
    const first = oneAtATime();
    const second = oneAtATime();
    let release: (() => void) | undefined;
    const blocked = first(() => new Promise<void>((resolve) => (release = resolve)));

    await expect(second(async () => 'not waiting')).resolves.toBe('not waiting');
    release?.();
    await blocked;
  });
});
