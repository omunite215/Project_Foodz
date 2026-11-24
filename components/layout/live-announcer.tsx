'use client';

import { useEffect, useState } from 'react';
import { createAnnouncementQueue, subscribeToAnnouncements } from '@/lib/announce';

/**
 * The site's two live regions: one polite, and an assertive twin used only where the design
 * asks for it. Use `announce()` from lib/announce to speak through them.
 */
export function LiveAnnouncer() {
  const [polite, setPolite] = useState('');
  const [assertive, setAssertive] = useState('');

  useEffect(() => {
    const politeQueue = createAnnouncementQueue(setPolite);
    const assertiveQueue = createAnnouncementQueue(setAssertive);
    const unsubscribe = subscribeToAnnouncements((message, options) => {
      (options.assertive ? assertiveQueue : politeQueue).push(message);
    });
    return () => {
      politeQueue.stop();
      assertiveQueue.stop();
      unsubscribe();
    };
  }, []);

  return (
    <>
      <output aria-live="polite" aria-atomic="true" className="sr-only">
        {polite}
      </output>
      <output aria-live="assertive" aria-atomic="true" className="sr-only">
        {assertive}
      </output>
    </>
  );
}
