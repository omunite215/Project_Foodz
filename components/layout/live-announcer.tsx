'use client';

import { useEffect, useState } from 'react';
import { subscribeToAnnouncements } from '@/lib/announce';

/** Messages this close together are read as one, in the order they came. */
const GATHER_MS = 50;

/** The site's one polite live region. Use `announce()` from lib/announce to speak through it. */
export function LiveAnnouncer() {
  const [message, setMessage] = useState('');

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending: string[] = [];
    const unsubscribe = subscribeToAnnouncements((next) => {
      // One change can say two things ("KBBQ5 applied…" and the new total): replacing the
      // first with the second would lose it, so both are read together.
      if (next && !pending.includes(next)) pending.push(next);
      // Clearing first makes a repeated message ("Code copied" twice) read again.
      setMessage('');
      clearTimeout(timer);
      timer = setTimeout(() => {
        setMessage(pending.join(' '));
        pending = [];
      }, GATHER_MS);
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, []);

  return (
    <output aria-live="polite" aria-atomic="true" className="sr-only">
      {message}
    </output>
  );
}
