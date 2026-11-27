'use client';

import { Download } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useSlowPending } from '@/components/forms/submit-button';
import { announce } from '@/lib/announce';
import { useOnline } from '@/lib/use-online';
import { cn } from '@/lib/utils';

/*
 * "Download CSV" (F9 design 3.15): a fetch rather than a link, so a refusal (the export limit,
 * a server failure) can be shown under the toolbar instead of a broken download. The file name
 * comes from the answer's Content-Disposition; the answer is never cached.
 */

export const CSV_COPY = {
  preparing: 'Preparing CSV…',
  downloaded: 'CSV downloaded.',
  failed: "Couldn't prepare the CSV. Try again.",
  offline: "You're offline.",
} as const;

/** `attachment; filename="foodz-partner-earnings-…csv"` gives the quoted name, or null. */
export function fileNameFrom(disposition: string | null): string | null {
  if (!disposition) return null;
  const match = /filename="?([^";]+)"?/i.exec(disposition);
  const name = match?.[1]?.trim();
  return name && /^[\w.-]+\.csv$/.test(name) ? name : null;
}

async function refusalOf(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (
      response.status === 429 &&
      typeof body === 'object' &&
      body !== null &&
      typeof Reflect.get(body, 'message') === 'string'
    ) {
      return String(Reflect.get(body, 'message'));
    }
  } catch {
    // Not JSON: fall through to the general words.
  }
  return CSV_COPY.failed;
}

/** One download at a time; `error` holds the words for the alert under the toolbar. */
export function useCsvDownload({
  endpoint,
  body,
  fallbackFileName,
}: {
  endpoint: string;
  body: () => Record<string, unknown>;
  fallbackFileName: string;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);

  const download = useCallback(async () => {
    if (running.current) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setError(CSV_COPY.offline);
      announce(CSV_COPY.offline);
      return;
    }
    running.current = true;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body()),
        cache: 'no-store',
        credentials: 'same-origin',
      });
      if (!response.ok) {
        const words = await refusalOf(response);
        setError(words);
        announce(words, { assertive: true });
        return;
      }
      const blob = await response.blob();
      const name = fileNameFrom(response.headers.get('content-disposition')) ?? fallbackFileName;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      announce(CSV_COPY.downloaded);
    } catch {
      setError(CSV_COPY.failed);
      announce(CSV_COPY.failed, { assertive: true });
    } finally {
      running.current = false;
      setPending(false);
    }
  }, [endpoint, body, fallbackFileName]);

  return { download, pending, error, clearError: () => setError(null) };
}

/**
 * The button itself. Its name is the visible words then `srSuffix` ("Download CSV for Nov 9 to
 * Nov 15"). Offline it stays focusable and says why when pressed.
 */
export function CsvButton({
  label,
  srSuffix,
  pending,
  onPress,
  className,
  reasonId,
}: {
  label: string;
  srSuffix: string;
  pending: boolean;
  onPress: () => void;
  className?: string;
  /** The id of the "You're offline." line, when the caller shows one. */
  reasonId?: string;
}) {
  const online = useOnline();
  const slow = useSlowPending(pending);
  const blocked = !online;
  return (
    <Button
      type="button"
      variant="outline"
      size="touch"
      aria-disabled={pending || blocked || undefined}
      aria-describedby={blocked ? reasonId : undefined}
      className={cn('bg-white', (pending || blocked) && 'cursor-not-allowed', className)}
      onClick={() => {
        if (pending) return;
        if (blocked) {
          announce(CSV_COPY.offline);
          return;
        }
        onPress();
      }}
    >
      {slow ? (
        <>
          <Spinner className="size-4" aria-hidden />
          {CSV_COPY.preparing}
        </>
      ) : (
        <>
          <Download className="size-4" aria-hidden />
          {label}
          <span className="sr-only"> {srSuffix}</span>
        </>
      )}
    </Button>
  );
}
