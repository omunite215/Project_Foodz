'use client';

import { Volume2, VolumeOff, VolumeX } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { announce } from '@/lib/announce';
import { readSwitch, writeSwitch } from '@/lib/board/preferences';
import { audioContext, playChime, type SoundState, soundStateAfterLoad } from '@/lib/board/sound';
import { cn } from '@/lib/utils';

/*
 * Sound and "Keep screen on" (F5 design 2.10). The sound button's words say the state and what
 * a press does (D10). Browsers only play after a tap: a sound left on before a reload says "Tap
 * to turn sound back on" until someone taps (A3.4). Sound is never the only signal.
 */

/** The board's sound: its state, a toggle for the button, and the chime itself. */
export function useSound() {
  const [state, setState] = useState<SoundState>('off');

  // After hydration: a saved "on" either plays already or waits for a tap.
  useEffect(() => {
    const saved = readSwitch('sound');
    if (!saved) return undefined;
    const context = audioContext();
    const next = soundStateAfterLoad(saved, context?.state ?? null);
    const timer = setTimeout(() => setState(next), 0);
    return () => clearTimeout(timer);
  }, []);

  const chime = useCallback(() => {
    const context = audioContext();
    if (state !== 'on' || !context || context.state !== 'running') return;
    playChime(context);
  }, [state]);

  const toggle = useCallback(async () => {
    if (state === 'on') {
      setState('off');
      writeSwitch('sound', false);
      announce('Sound off');
      return;
    }
    const context = audioContext();
    try {
      await context?.resume();
    } catch {
      // Refused: stays blocked below.
    }
    if (!context || context.state !== 'running') {
      setState('blocked');
      return;
    }
    setState('on');
    writeSwitch('sound', true);
    // A test, so the person hears what a new order sounds like.
    playChime(context);
    announce('Sound on');
  }, [state]);

  return { state, toggle, chime };
}

export function SoundButton({
  state,
  onToggle,
  compact = false,
}: {
  state: SoundState;
  onToggle: () => void;
  /** Icon only at every width. Without it, the words show from 1280 px (design 1.3, 2.10). */
  compact?: boolean;
}) {
  const words =
    state === 'on'
      ? { visible: 'Sound on', name: 'Sound on, turn off', icon: Volume2 }
      : state === 'blocked'
        ? { visible: 'Tap to turn sound back on', name: 'Tap to turn sound back on', icon: VolumeX }
        : { visible: 'Turn on sound', name: 'Turn on sound', icon: VolumeOff };
  const Icon = words.icon;

  return (
    <Button
      type="button"
      variant="outline"
      size={compact ? 'icon-kitchen' : 'kitchen'}
      onClick={onToggle}
      aria-label={words.name}
      className={cn(
        !compact && 'max-xl:size-12 max-xl:px-0 xl:w-auto xl:px-4',
        state === 'on' &&
          'border-2 border-brand-strong bg-brand-soft text-neutral-1 hover:bg-brand-soft',
        state === 'blocked' && 'border-warning-strong bg-tag-6-bg text-neutral-1 hover:bg-tag-6-bg',
      )}
    >
      <Icon className="size-5" aria-hidden />
      {compact ? null : <span className="hidden xl:inline">{words.visible}</span>}
    </Button>
  );
}

interface WakeLockSentinelLike {
  release(): Promise<void>;
}

/**
 * "Keep screen on" (A3.5): on by default for KITCHEN, shown only where Screen Wake Lock exists.
 * The lock is let go while the tab is hidden and asked for again when it's shown.
 */
export function useWakeLock(defaultOn: boolean, onRefused: () => void) {
  const [supported, setSupported] = useState(false);
  const [on, setOn] = useState(false);
  const sentinel = useRef<WakeLockSentinelLike | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!('wakeLock' in navigator)) return;
      setSupported(true);
      setOn(readSwitch('wakeLock') ?? defaultOn);
    }, 0);
    return () => clearTimeout(timer);
  }, [defaultOn]);

  useEffect(() => {
    if (!supported || !on) return undefined;
    let cancelled = false;
    const request = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const lock = await navigator.wakeLock.request('screen');
        if (cancelled) void lock.release();
        else sentinel.current = lock;
      } catch {
        if (cancelled) return;
        setOn(false);
        onRefused();
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void request();
      else {
        void sentinel.current?.release();
        sentinel.current = null;
      }
    };
    void request();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      void sentinel.current?.release();
      sentinel.current = null;
    };
  }, [supported, on, onRefused]);

  const change = useCallback((next: boolean) => {
    setOn(next);
    writeSwitch('wakeLock', next);
  }, []);

  return { supported, on, change };
}

export function WakeLockSwitch({
  on,
  onChange,
  className,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  className?: string;
}) {
  const id = useId();
  // The whole 48 px row is the target, not just the 32 px switch (A16.1): a wet-hands tablet.
  return (
    <label
      htmlFor={id}
      className={cn(
        'flex min-h-12 cursor-pointer items-center gap-3 rounded-md px-2 hover:bg-neutral-7',
        className,
      )}
    >
      <Switch
        id={id}
        checked={on}
        onCheckedChange={onChange}
        className="focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid"
      />
      <span className="text-body-5 font-medium whitespace-nowrap text-neutral-1">
        Keep screen on
      </span>
    </label>
  );
}
