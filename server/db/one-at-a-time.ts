/**
 * A line of async tasks: each starts when the one before it has settled, in the order they
 * were handed over. A failed task rejects only its own caller.
 */
export function oneAtATime() {
  let last: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const result = last.then(task);
    last = result.catch(() => undefined);
    return result;
  };
}
