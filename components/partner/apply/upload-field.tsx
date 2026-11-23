'use client';

import { Camera, CircleCheck, IdCard, Images, UserRound } from 'lucide-react';
import { type ReactNode, type RefObject, useEffect, useId, useRef, useState } from 'react';
import type { IdDocumentType } from '@/server/modules/partners/rules';
import {
  confirmUploadAction,
  requestUploadAction,
  uploadStatusAction,
} from '@/server/modules/uploads/actions';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';
import { callAction } from '@/lib/action-result';
import { announce } from '@/lib/announce';
import {
  ACCEPT_ATTRIBUTE,
  ACCEPTED_TYPES,
  browserFileError,
  rejectedUploadError,
  UPLOAD_ERRORS,
  UPLOAD_STILL_CHECKING,
  type UploadKind,
  uploadHint,
  uploadingAnnouncement,
  uploadingLine,
  uploadLegend,
} from '@/lib/partner/text';
import { POLL_MS, putWithProgress, STILL_CHECKING_MS } from '@/lib/partner/upload';
import { useMediaQuery } from '@/lib/use-media-query';
import { cn } from '@/lib/utils';

/*
 * The upload field (F6 design 4.4): "Take a photo" and "Choose a photo" are labels on two file
 * inputs, so they work before the scripts load (D14). The file goes up with real progress, the
 * server checks it, and only then is a preview drawn, through a 5-minute link: nothing refused
 * is ever shown (D13). Desktop gets one button and a drop zone.
 */

/** What the form keeps about an upload. */
export interface UploadValue {
  uploadId: string;
  status: 'checking' | 'ready';
  url: string | null;
}

type Phase =
  | { kind: 'empty' }
  | { kind: 'uploading'; percent: number }
  | { kind: 'checking'; since: number }
  | { kind: 'ready'; url: string | null };

const PURPOSE: Record<UploadKind, 'PARTNER_PHOTO' | 'PARTNER_DOCUMENT'> = {
  photo: 'PARTNER_PHOTO',
  id: 'PARTNER_DOCUMENT',
};

const phaseOf = (value: UploadValue | null): Phase => {
  if (!value) return { kind: 'empty' };
  return value.status === 'ready'
    ? { kind: 'ready', url: value.url }
    : { kind: 'checking', since: Date.now() };
};

export function UploadField({
  kind,
  documentType,
  value,
  error,
  onChange,
  onError,
  focusRef,
  examples,
  recheck = false,
}: {
  kind: UploadKind;
  documentType: IdDocumentType;
  value: UploadValue | null;
  /** The form's error for this field (missing, refused at send). */
  error: string | null;
  onChange: (value: UploadValue | null) => void;
  /** The field's own errors (type, size, the check, the connection). */
  onError: (message: string | null) => void;
  /** "Take a photo" ("Choose a photo" on desktop), focused when the field has an error. */
  focusRef?: RefObject<HTMLInputElement | null>;
  /** The ID's drawn examples, between the hint and the row. */
  examples?: ReactNode;
  /** A draft's upload: ask the server once whether it is still there (design 4.2). */
  recheck?: boolean;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const statusId = `${id}-status`;
  const errorId = `${id}-error`;
  const takeRef = useRef<HTMLInputElement>(null);
  const chooseRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const retryRef = useRef<File | null>(null);
  const [phase, setPhase] = useState<Phase>(() => phaseOf(value));
  const [stillChecking, setStillChecking] = useState(false);
  const [canRetry, setCanRetry] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const desktop = useMediaQuery('(hover: hover) and (pointer: fine)');
  const legend = uploadLegend(kind, documentType);
  const uploadId = value?.uploadId ?? null;

  // The input focus goes to after a problem: "Take a photo", or "Choose a photo" on desktop.
  const primaryInput = () => (desktop ? chooseRef.current : takeRef.current) ?? chooseRef.current;
  // The form focuses the same input through its own ref.
  const bindPrimary = (element: HTMLInputElement | null) => {
    if (focusRef && element) focusRef.current = element;
  };

  const fail = (message: string) => {
    setPhase({ kind: 'empty' });
    onChange(null);
    onError(message);
    requestAnimationFrame(() => primaryInput()?.focus());
  };

  // While checking: ask every 1.5 s; after 15 s say it may take a moment (P2.5).
  useEffect(() => {
    if (phase.kind !== 'checking' || !uploadId) return undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const outcome = await callAction(() => uploadStatusAction({ uploadId }));
      if (cancelled) return;
      if (outcome.ok) {
        const view = outcome.data;
        if (view.status === 'READY') {
          setPhase({ kind: 'ready', url: view.url });
          onChange({ uploadId, status: 'ready', url: view.url });
          announce('Photo added');
          return;
        }
        if (view.status === 'REJECTED') {
          fail(rejectedUploadError(view.code, kind));
          return;
        }
      } else if (outcome.error.code === 'NOT_FOUND') {
        fail(UPLOAD_ERRORS.expired);
        return;
      }
      if (Date.now() - phase.since >= STILL_CHECKING_MS && !stillChecking) {
        setStillChecking(true);
        announce(UPLOAD_STILL_CHECKING);
      }
      timer = setTimeout(() => void poll(), POLL_MS);
    };
    timer = setTimeout(() => void poll(), recheck ? 0 : POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // The poll restarts only when a new upload starts checking.
    // oxlint-disable-next-line react/exhaustive-deps
  }, [phase.kind, uploadId]);

  // A ready draft upload: confirm it is still there and get a fresh link (design 4.2).
  useEffect(() => {
    if (!recheck || phase.kind !== 'ready' || !uploadId) return undefined;
    let cancelled = false;
    const check = async () => {
      const outcome = await callAction(() => uploadStatusAction({ uploadId }));
      if (cancelled) return;
      if (outcome.ok && outcome.data.status === 'READY') {
        const url = outcome.data.url;
        setPhase({ kind: 'ready', url });
        onChange({ uploadId, status: 'ready', url });
      } else if (!outcome.ok && outcome.error.code === 'NOT_FOUND') {
        fail(UPLOAD_ERRORS.expired);
      } else if (outcome.ok && outcome.data.status === 'REJECTED') {
        fail(rejectedUploadError(outcome.data.code, kind));
      }
    };
    void check();
    return () => {
      cancelled = true;
    };
    // Once, for the draft's upload.
    // oxlint-disable-next-line react/exhaustive-deps
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function refreshLink(forUpload: string) {
    const outcome = await callAction(() => uploadStatusAction({ uploadId: forUpload }));
    const url = outcome.ok && outcome.data.status === 'READY' ? outcome.data.url : null;
    setPhase({ kind: 'ready', url });
  }

  async function upload(file: File) {
    const problem = browserFileError(file, kind);
    if (problem) {
      fail(problem);
      return;
    }
    onError(null);
    setCanRetry(false);
    setStillChecking(false);
    retryRef.current = file;
    setPhase({ kind: 'uploading', percent: 0 });
    announce(uploadingAnnouncement(kind, documentType));

    const contentType = ACCEPTED_TYPES.find((type) => type === file.type);
    if (!contentType) {
      fail(UPLOAD_ERRORS.badType);
      return;
    }
    const asked = await callAction(() =>
      requestUploadAction({ purpose: PURPOSE[kind], contentType, sizeBytes: file.size }),
    );
    if (!asked.ok) {
      const sizeError = asked.error.fieldErrors?.sizeBytes?.[0];
      if (asked.error.code === 'OFFLINE' || asked.error.code === 'TIMEOUT') {
        setCanRetry(true);
        fail(UPLOAD_ERRORS.stopped);
      } else {
        fail(sizeError ?? asked.error.message);
      }
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    const put = await putWithProgress({
      url: asked.data.url,
      file,
      headers: asked.data.headers,
      signal: controller.signal,
      onProgress: (percent) =>
        setPhase((current) =>
          current.kind === 'uploading' ? { kind: 'uploading', percent } : current,
        ),
    });
    abortRef.current = null;
    if (put === 'aborted') {
      setPhase({ kind: 'empty' });
      return;
    }
    if (put === 'failed') {
      setCanRetry(true);
      fail(UPLOAD_ERRORS.stopped);
      return;
    }
    const confirmed = await callAction(() =>
      confirmUploadAction({ uploadId: asked.data.uploadId }),
    );
    if (!confirmed.ok) {
      setCanRetry(true);
      fail(UPLOAD_ERRORS.stopped);
      return;
    }
    setPhase({ kind: 'checking', since: Date.now() });
    onChange({ uploadId: asked.data.uploadId, status: 'checking', url: null });
  }

  const onFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (file) void upload(file);
  };

  const describedBy = [hintId, statusId, error ? errorId : null].filter(Boolean).join(' ');
  const busy = phase.kind === 'uploading' || phase.kind === 'checking';
  const ready = phase.kind === 'ready';

  const fileInput = (
    capture: 'user' | 'environment' | null,
    ref: RefObject<HTMLInputElement | null>,
    primary: boolean,
  ) => (
    <input
      ref={(element) => {
        ref.current = element;
        if (primary) bindPrimary(element);
      }}
      type="file"
      accept={ACCEPT_ATTRIBUTE}
      {...(capture ? { capture } : {})}
      aria-describedby={describedBy}
      aria-invalid={error ? true : undefined}
      className="sr-only"
      onChange={(event) => {
        onFiles(event.target.files);
        event.target.value = '';
      }}
    />
  );

  const label = (
    icon: typeof Camera,
    text: string,
    capture: 'user' | 'environment' | null,
    ref: RefObject<HTMLInputElement | null>,
    full = false,
    primary = false,
  ) => {
    const Icon = icon;
    return (
      <label
        className={cn(
          'inline-flex h-12 min-w-12 cursor-pointer items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 text-button-1 font-medium text-strong hover:bg-muted dark:border-input has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring has-[:focus-visible]:outline-solid',
          full && 'w-full',
        )}
      >
        {fileInput(capture, ref, primary)}
        <Icon className="size-5" aria-hidden />
        {text}
      </label>
    );
  };

  const placeholder =
    kind === 'photo' ? (
      <UserRound className="size-8 text-muted-foreground" aria-hidden />
    ) : (
      <IdCard className="size-8 text-muted-foreground" aria-hidden />
    );

  const preview = (
    <span
      className={cn(
        'relative flex shrink-0 items-center justify-center overflow-hidden border border-border bg-muted',
        kind === 'photo' ? 'size-24 rounded-full' : 'aspect-[1.586] h-24 rounded-lg',
      )}
    >
      {ready && phase.url ? (
        // A 5-minute private link to the checked image; never through the optimizer.
        // oxlint-disable-next-line nextjs/no-img-element
        <img
          src={phase.url}
          alt=""
          referrerPolicy="no-referrer"
          className="size-full object-cover"
          onError={() => {
            if (!uploadId) return;
            // The link expired: ask for a fresh one, silently (design 4.4).
            void refreshLink(uploadId);
          }}
        />
      ) : (
        placeholder
      )}
      {phase.kind === 'checking' ? (
        <span className="absolute inset-0 flex items-center justify-center bg-muted/70">
          <Spinner className="size-5 text-foreground" aria-hidden />
        </span>
      ) : null}
    </span>
  );

  const status = (
    <div id={statusId} className="min-w-0 flex-1 text-body-5 text-foreground">
      {phase.kind === 'uploading' ? (
        <>
          <p className="tabular-nums">{uploadingLine(phase.percent)}</p>
          <progress
            value={Math.round(phase.percent)}
            max={100}
            aria-label={kind === 'photo' ? 'Uploading your photo' : 'Uploading the photo'}
            className="mt-2 block h-2 w-full appearance-none overflow-hidden rounded-full bg-muted [&::-moz-progress-bar]:bg-primary [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-primary [&::-webkit-progress-value]:transition-[width] [&::-webkit-progress-value]:duration-150"
          />
        </>
      ) : null}
      {phase.kind === 'checking' ? (
        <p>{stillChecking ? UPLOAD_STILL_CHECKING : 'Checking your photo…'}</p>
      ) : null}
      {ready ? (
        <p className="flex items-center gap-1.5">
          <CircleCheck className="size-4 text-success-mark" aria-hidden />
          Photo added
        </p>
      ) : null}
    </div>
  );

  const dropZone = desktop && !busy;

  return (
    <fieldset aria-describedby={describedBy} className="min-w-0">
      <legend className="text-body-4 font-medium text-strong">{legend}</legend>
      <p id={hintId} className="mt-1 text-body-5 text-muted-foreground">
        {uploadHint(kind)}
      </p>
      {examples}
      <div
        className={cn(
          'mt-4 flex items-center gap-4',
          dropZone && 'rounded-2xl border-2 border-dashed border-input p-6',
          dropZone && dragOver && 'border-primary bg-muted',
        )}
        onDragOver={(event) => {
          if (!dropZone) return;
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          if (!dropZone) return;
          event.preventDefault();
          setDragOver(false);
          onFiles(event.dataTransfer.files);
        }}
      >
        {preview}
        <div className="min-w-0 flex-1">
          {status}
          {dropZone && !ready ? (
            <p className="text-body-5 text-muted-foreground">or drop a photo here</p>
          ) : null}
        </div>
      </div>
      {phase.kind === 'uploading' ? (
        <Button
          type="button"
          variant="ghost"
          size="kitchen"
          className="mt-4 text-strong"
          onClick={() => abortRef.current?.abort()}
        >
          Cancel
        </Button>
      ) : null}
      {phase.kind === 'empty' && canRetry && retryRef.current ? (
        <Button
          type="button"
          size="kitchen"
          className="mt-4 w-full"
          onClick={() => {
            if (retryRef.current) void upload(retryRef.current);
          }}
        >
          Try again
        </Button>
      ) : null}
      {phase.kind === 'empty' ? (
        desktop ? (
          <div className="mt-4">{label(Images, 'Choose a photo', null, chooseRef, true, true)}</div>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-2 min-[360px]:grid-cols-2">
            {label(
              Camera,
              'Take a photo',
              kind === 'photo' ? 'user' : 'environment',
              takeRef,
              false,
              true,
            )}
            {label(Images, 'Choose a photo', null, chooseRef)}
          </div>
        )
      ) : null}
      {ready ? (
        <div className="mt-4">{label(Images, 'Change photo', null, chooseRef, true, true)}</div>
      ) : null}
      <FieldError id={errorId}>{error}</FieldError>
    </fieldset>
  );
}
