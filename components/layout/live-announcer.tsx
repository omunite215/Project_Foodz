'use client';

import { useEffect, useState } from 'react';
import { subscribeToAnnouncements } from '@/lib/announce';

/** The site's one polite live region. Use `announce()` from lib/announce to speak through it. */
export function LiveAnnouncer() {
  const [message, setMessage] = useState('');

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = subscribeToAnnouncements((next) => {
      // Clearing first makes a repeated message ("Code copied" twice) read again.
      setMessage('');
      clearTimeout(timer);
      timer = setTimeout(() => setMessage(next), 50);
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
