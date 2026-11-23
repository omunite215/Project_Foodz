'use client';

import { ImageOff, Minus, Plus, RotateCw, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { BLOCKED_BUTTON_CLASS } from '@/components/forms/submit-button';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { announce } from '@/lib/announce';
import { useMotion } from '@/lib/motion';
import {
  clampPan,
  fittedSize,
  needsFreshLink,
  panStep,
  rotateQuarter,
  type Size,
  type Zoom,
  zoomIn,
  zoomOut,
  zoomText,
} from '@/lib/partner-review/viewer';
import { cn } from '@/lib/utils';

/*
 * The document viewer (F6 design 9, A21.2): the photo or the ID, full screen on phones, at 100%,
 * 200% or 300%, turned a quarter at a time, moved by dragging or the arrow keys. Nothing changes
 * the stored file. A link older than 4.5 minutes is renewed before the image loads.
 */

export interface ViewerLink {
  url: string;
  expiresAt: string | null;
}

type Status = 'loading' | 'ready' | 'expired' | 'failed';

export function DocumentViewer({
  open,
  title,
  alt,
  link,
  onFreshLink,
  onClose,
}: {
  open: boolean;
  title: string;
  alt: string;
  link: ViewerLink | null;
  /** A new 5-minute link, or null when none can be made. */
  onFreshLink: () => Promise<ViewerLink | null>;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      {open ? (
        <ViewerContent
          title={title}
          alt={alt}
          link={link}
          onFreshLink={onFreshLink}
          onClose={onClose}
        />
      ) : null}
    </Dialog>
  );
}

function ViewerContent({
  title,
  alt,
  link,
  onFreshLink,
  onClose,
}: {
  title: string;
  alt: string;
  link: ViewerLink | null;
  onFreshLink: () => Promise<ViewerLink | null>;
  onClose: () => void;
}) {
  const hintId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState<ViewerLink | null>(link);
  const [status, setStatus] = useState<Status>('loading');
  const [zoom, setZoom] = useState<Zoom>(1);
  const [rotation, setRotation] = useState(0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [natural, setNatural] = useState<Size>({ width: 0, height: 0 });
  const [canvas, setCanvas] = useState<Size>({ width: 0, height: 0 });
  const drag = useRef<{ x: number; y: number; pan: { x: number; y: number } } | null>(null);
  const [dragging, setDragging] = useState(false);

  const fitted = fittedSize(natural, canvas, rotation);

  const renew = async () => {
    setStatus('loading');
    const fresh = await onFreshLink();
    if (fresh) setCurrent(fresh);
    else setStatus('expired');
  };

  // An old link is renewed first (design 9).
  useEffect(() => {
    if (current && !needsFreshLink(current.expiresAt, Date.now())) return undefined;
    const timer = setTimeout(() => void renew(), 0);
    return () => clearTimeout(timer);
    // Only on opening.
    // oxlint-disable-next-line react/exhaustive-deps
  }, []);

  useEffect(() => {
    const element = canvasRef.current;
    if (!element) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setCanvas({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useMotion(
    (motion) => {
      if (!layerRef.current) return;
      motion.to(layerRef.current, {
        x: pan.x,
        y: pan.y,
        scale: zoom,
        rotation,
        duration: motion.reduced || dragging ? 0 : 0.2,
        ease: 'power2.out',
      });
    },
    { scope: layerRef, dependencies: [pan.x, pan.y, zoom, rotation, dragging] },
  );

  const setZoomTo = (next: Zoom) => {
    if (next === zoom) return;
    setZoom(next);
    setPan((value) => clampPan(value, fitted, canvas, next));
    announce(`Zoom ${zoomText(next)}`);
  };
  const rotate = () => {
    const next = rotateQuarter(rotation);
    setRotation(next);
    setPan({ x: 0, y: 0 });
    announce(`Rotated ${next} degrees`);
  };
  const reset = () => {
    setZoom(1);
    setRotation(0);
    setPan({ x: 0, y: 0 });
    announce('Zoom 100%');
  };
  const move = (dx: number, dy: number) =>
    setPan((value) => clampPan({ x: value.x + dx, y: value.y + dy }, fitted, canvas, zoom));

  const onKeyDown = (event: React.KeyboardEvent) => {
    const step = panStep(event.shiftKey);
    switch (event.key) {
      case '+':
      case '=':
        setZoomTo(zoomIn(zoom));
        break;
      case '-':
        setZoomTo(zoomOut(zoom));
        break;
      case 'r':
      case 'R':
        rotate();
        break;
      case '0':
        reset();
        break;
      case 'ArrowLeft':
        move(step, 0);
        break;
      case 'ArrowRight':
        move(-step, 0);
        break;
      case 'ArrowUp':
        move(0, step);
        break;
      case 'ArrowDown':
        move(0, -step);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  const message = status === 'expired' ? 'This link has expired.' : "The image couldn't load.";

  return (
    <DialogContent
      showCloseButton={false}
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        titleRef.current?.focus();
      }}
      className={cn(
        'flex flex-col gap-0 overflow-hidden bg-white p-0 ring-0',
        'max-md:inset-0 max-md:top-0 max-md:left-0 max-md:h-dvh max-md:max-w-none max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-none',
        'md:h-[calc(100dvh-2rem)] md:w-[calc(100%-2rem)] md:max-w-6xl md:rounded-2xl',
        'duration-200 motion-reduce:duration-120 motion-reduce:data-open:zoom-in-100 motion-reduce:data-closed:zoom-out-100',
      )}
    >
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-neutral-6 bg-white px-4">
        <DialogTitle
          ref={titleRef}
          tabIndex={-1}
          className="min-w-0 flex-1 truncate text-body-3 font-semibold text-neutral-1 outline-none"
        >
          {title}
        </DialogTitle>
        <Button
          type="button"
          variant="ghost"
          size="icon-kitchen"
          aria-label="Close"
          className="ml-auto shrink-0"
          onClick={onClose}
        >
          <X className="size-5" aria-hidden />
        </Button>
      </header>
      <DialogDescription id={hintId} className="sr-only">
        Use plus and minus to zoom, R to rotate, and the arrow keys to move the image.
      </DialogDescription>
      {/* The canvas takes its own keys (design 9); it is described by the key hint. */}
      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <div
        ref={canvasRef}
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
        role="application"
        aria-label={alt}
        aria-describedby={hintId}
        onKeyDown={onKeyDown}
        onPointerDown={(event) => {
          if (zoom === 1 || status !== 'ready') return;
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { x: event.clientX, y: event.clientY, pan };
          setDragging(true);
        }}
        onPointerMove={(event) => {
          const start = drag.current;
          if (!start) return;
          setPan(
            clampPan(
              {
                x: start.pan.x + event.clientX - start.x,
                y: start.pan.y + event.clientY - start.y,
              },
              fitted,
              canvas,
              zoom,
            ),
          );
        }}
        onPointerUp={() => {
          drag.current = null;
          setDragging(false);
        }}
        onPointerCancel={() => {
          drag.current = null;
          setDragging(false);
        }}
        className={cn(
          'relative flex flex-1 touch-none items-center justify-center overflow-hidden bg-neutral-2 outline-none focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-white focus-visible:outline-solid',
          zoom > 1 && status === 'ready' && (dragging ? 'cursor-grabbing' : 'cursor-grab'),
        )}
      >
        {current && status !== 'expired' && status !== 'failed' ? (
          <div ref={layerRef} className="flex size-full items-center justify-center">
            {/* A 5-minute private link: drawn as is, never through the image optimizer. */}
            {/* oxlint-disable-next-line nextjs/no-img-element */}
            <img
              src={current.url}
              alt={alt}
              referrerPolicy="no-referrer"
              draggable={false}
              onLoad={(event) => {
                setNatural({
                  width: event.currentTarget.naturalWidth,
                  height: event.currentTarget.naturalHeight,
                });
                setStatus('ready');
              }}
              onError={() => setStatus('failed')}
              style={
                fitted.width > 0
                  ? {
                      width: rotation % 180 ? fitted.height : fitted.width,
                      height: rotation % 180 ? fitted.width : fitted.height,
                    }
                  : undefined
              }
              className={cn('max-w-none select-none', status !== 'ready' && 'invisible')}
            />
          </div>
        ) : null}
        {status === 'loading' ? (
          <Spinner className="absolute size-8 text-white motion-reduce:animate-none" />
        ) : null}
        {status === 'expired' || status === 'failed' ? (
          <div className="absolute flex flex-col items-center gap-3 p-6 text-center">
            <ImageOff className="size-6 text-white" aria-hidden />
            <p className="text-body-4 text-white">{message}</p>
            <Button
              type="button"
              variant="outline"
              size="touch"
              className="border-white bg-transparent text-white hover:bg-white/10 hover:text-white"
              onClick={() => void renew()}
            >
              Show again
            </Button>
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center justify-center gap-2 border-t border-neutral-6 bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <Button
          type="button"
          variant="outline"
          size="icon-kitchen"
          aria-label="Zoom out"
          aria-disabled={zoom === 1 || undefined}
          className={cn(zoom === 1 && BLOCKED_BUTTON_CLASS)}
          onClick={() => {
            if (zoom > 1) setZoomTo(zoomOut(zoom));
          }}
        >
          <Minus className="size-5" aria-hidden />
        </Button>
        <span className="w-16 text-center text-body-4 font-medium text-neutral-1 tabular-nums">
          {zoomText(zoom)}
        </span>
        <Button
          type="button"
          variant="outline"
          size="icon-kitchen"
          aria-label="Zoom in"
          aria-disabled={zoom === 3 || undefined}
          className={cn(zoom === 3 && BLOCKED_BUTTON_CLASS)}
          onClick={() => {
            if (zoom < 3) setZoomTo(zoomIn(zoom));
          }}
        >
          <Plus className="size-5" aria-hidden />
        </Button>
        <span aria-hidden className="mx-1 h-8 w-px bg-neutral-6" />
        <Button type="button" variant="outline" size="kitchen" onClick={rotate}>
          <RotateCw className="size-5" aria-hidden />
          Rotate
        </Button>
      </div>
    </DialogContent>
  );
}
