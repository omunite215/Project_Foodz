/*
 * The browser's half of an upload (F6 design 4.4, contract 2.4): the file goes straight to the
 * presigned URL with XHR, so the bar shows real bytes sent (P17.6). Type and exact size are part
 * of the signature, so the storage server refuses anything else. Nothing is shown from the
 * phone's copy: the preview comes only after the server's check (P2.3).
 */

export type PutOutcome = 'ok' | 'failed' | 'aborted';

export interface PutRequest {
  url: string;
  file: Blob;
  headers: Record<string, string>;
  onProgress: (percent: number) => void;
  signal: AbortSignal;
  /** Gives up when nothing has been sent for this long. */
  stallMs?: number;
}

export function putWithProgress({
  url,
  file,
  headers,
  onProgress,
  signal,
  stallMs = 30_000,
}: PutRequest): Promise<PutOutcome> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    let stall: ReturnType<typeof setTimeout> | undefined;
    const settle = (outcome: PutOutcome) => {
      clearTimeout(stall);
      signal.removeEventListener('abort', abort);
      resolve(outcome);
    };
    const armStall = () => {
      clearTimeout(stall);
      stall = setTimeout(() => {
        xhr.abort();
        settle('failed');
      }, stallMs);
    };
    const abort = () => {
      xhr.abort();
      settle('aborted');
    };
    if (signal.aborted) {
      resolve('aborted');
      return;
    }
    signal.addEventListener('abort', abort);
    xhr.open('PUT', url);
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.upload.addEventListener('progress', (event) => {
      armStall();
      if (event.lengthComputable && event.total > 0) onProgress((event.loaded / event.total) * 100);
    });
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100);
        settle('ok');
      } else {
        settle('failed');
      }
    });
    xhr.addEventListener('error', () => settle('failed'));
    xhr.addEventListener('timeout', () => settle('failed'));
    armStall();
    xhr.send(file);
  });
}

/** How often the check's state is asked for while it runs. */
export const POLL_MS = 1_500;
/** After this long "checking", the field says it may take a moment (P2.5). */
export const STILL_CHECKING_MS = 15_000;
