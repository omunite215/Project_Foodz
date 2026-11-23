'use client';

import { useEffect, useState } from 'react';
import { announcementQueue, subscribeToAnnouncements } from '@/lib/announce';

/** The site's one polite live region. Use `announce()` from lib/announce to speak through it. */
export function LiveAnnouncer() {
  const [message, setMessage] = useState('');

  useEffect(() => {
    const queue = announcementQueue(setMessage);
    const unsubscribe = subscribeToAnnouncements((next) => queue.push(next));
    return () => {
      queue.dispose();
      unsubscribe();
    };
  }, []);

  return (
    <output aria-live="polite" aria-atomic="true" className="sr-only">
      {message}
    </output>
  );
}
