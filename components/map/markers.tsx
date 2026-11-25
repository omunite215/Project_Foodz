'use client';

import { House, type LucideIcon, Store } from 'lucide-react';
import type { Map as MapLibreMap, Marker } from 'maplibre-gl';
import type { ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import type { MapPalette } from '@/lib/map/colors';
import type { MapLibreModule } from '@/lib/map/maplibre';
import type { Point } from '@/lib/map-geometry';

/*
 * Markers and pins drawn as small DOM trees (F8 design 0, 3.3): the courier disc with its
 * bearing notch, hollow and gray states; the partner's own dot; the door, kitchen and drop-off
 * teardrops; the label chip. Every one is hidden from screen readers (the text twin and the
 * list carry the words) and carries its own background and edge over the tiles.
 */

export interface MountedMarker {
  marker: Marker;
  element: HTMLElement;
  render: (node: ReactNode) => void;
  remove: () => void;
}

/** A MapLibre marker whose element is a React tree, re-rendered in place on each change. */
export function mountMarker(
  handle: { map: MapLibreMap; lib: MapLibreModule },
  at: Point,
  node: ReactNode,
  options: { anchor?: 'center' | 'bottom' | 'left'; offset?: [number, number] } = {},
): MountedMarker {
  const element = document.createElement('div');
  element.setAttribute('aria-hidden', 'true');
  const root: Root = createRoot(element);
  flushSync(() => root.render(node));
  const marker = new handle.lib.Marker({
    element,
    anchor: options.anchor ?? 'center',
    offset: options.offset,
  })
    .setLngLat([at.lng, at.lat])
    .addTo(handle.map);
  return {
    marker,
    element,
    render: (next) => root.render(next),
    remove: () => {
      marker.remove();
      // Unmounting while React renders warns; the next task is always outside a render.
      setTimeout(() => root.unmount(), 0);
    },
  };
}

export function CourierDisc({
  fill,
  icon: Icon,
  iconColor = '#ffffff',
  ring = '#ffffff',
  size = 36,
  hollow = false,
  heading = null,
  selected = false,
  selectedColor = '#02630a',
}: {
  fill: string;
  icon: LucideIcon;
  iconColor?: string;
  ring?: string;
  size?: number;
  /** No location for 45 s: white fill, a ring and icon in the state's color. */
  hollow?: boolean;
  /** Degrees from north; no notch without one. */
  heading?: number | null;
  selected?: boolean;
  selectedColor?: string;
}) {
  const ringWidth = hollow ? 3 : size >= 36 ? 3 : 2;
  return (
    <span
      className="relative block transition-transform duration-150 motion-reduce:transition-none"
      style={{ width: size, height: size, transform: selected ? 'scale(1.15)' : undefined }}
    >
      {heading !== null && !hollow ? (
        <span
          className="absolute inset-0 transition-transform duration-300 ease-out motion-reduce:transition-none"
          style={{ transform: `rotate(${Math.round(heading)}deg)` }}
        >
          <svg
            width="10"
            height="8"
            viewBox="0 0 10 8"
            className="absolute left-1/2 -translate-x-1/2"
            style={{ top: -6 }}
          >
            <path d="M5 0 10 8H0Z" fill={fill} stroke={ring} strokeWidth="1.5" />
          </svg>
        </span>
      ) : null}
      <span
        className="absolute inset-0 flex items-center justify-center rounded-full"
        style={{
          background: hollow ? '#ffffff' : fill,
          border: `${ringWidth}px solid ${hollow ? fill : ring}`,
          boxShadow: selected
            ? `0 0 0 3px ${selectedColor}, 0 0 0 4px rgb(20 20 22 / 0.25)`
            : '0 0 0 1px rgb(20 20 22 / 0.25)',
          boxSizing: 'border-box',
        }}
      >
        <Icon
          style={{
            width: size >= 36 ? 20 : 18,
            height: size >= 36 ? 20 : 18,
            color: hollow ? fill : iconColor,
          }}
          strokeWidth={2.25}
        />
      </span>
    </span>
  );
}

export function YouDot({ palette }: { palette: MapPalette }) {
  return (
    <span
      className="block rounded-full"
      style={{
        width: 18,
        height: 18,
        background: palette.you,
        border: `3px solid ${palette.youRing}`,
        boxShadow: '0 0 0 1px rgb(20 20 22 / 0.25)',
        boxSizing: 'border-box',
      }}
    />
  );
}

/** A teardrop pin with a glyph in its head (door, kitchen, drop-off). */
export function TeardropPin({
  fill,
  stroke,
  glyph: Glyph,
  glyphColor,
  width = 32,
}: {
  fill: string;
  stroke: string;
  glyph: LucideIcon;
  glyphColor: string;
  width?: number;
}) {
  const height = Math.round(width * 1.25);
  const icon = Math.round(width * 0.44);
  return (
    <span className="relative block" style={{ width, height }}>
      <svg
        viewBox="0 0 32 40"
        width={width}
        height={height}
        style={{ filter: 'drop-shadow(0 2px 4px rgb(20 20 22 / 0.3))' }}
      >
        <path
          d="M16 39S30 24.6 30 15A14 14 0 0 0 2 15c0 9.6 14 24 14 24Z"
          fill={fill}
          stroke={stroke}
          strokeWidth="2"
        />
      </svg>
      <Glyph
        className="absolute left-1/2 -translate-x-1/2"
        style={{ top: Math.round(width * 0.24), width: icon, height: icon, color: glyphColor }}
        strokeWidth={2.5}
      />
    </span>
  );
}

export function DoorPin({ palette, width = 32 }: { palette: MapPalette; width?: number }) {
  return (
    <TeardropPin
      fill={palette.door}
      stroke={palette.doorStroke}
      glyph={House}
      glyphColor={palette.doorGlyph}
      width={width}
    />
  );
}

export function KitchenPin({ palette }: { palette: MapPalette }) {
  return (
    <TeardropPin
      fill={palette.kitchen}
      stroke={palette.kitchenStroke}
      glyph={Store}
      glyphColor={palette.kitchenStroke}
    />
  );
}

/** "You", "Priya", "1042": its own background and a 3:1 edge against any tile. */
export function LabelChip({ text, palette }: { text: string; palette: MapPalette }) {
  return (
    <span
      className="inline-flex h-6 items-center rounded-md px-2 text-caption font-semibold whitespace-nowrap"
      style={{
        background: palette.chipBackground,
        color: palette.chipText,
        border: `1px solid ${palette.chipBorder}`,
      }}
    >
      {text}
    </span>
  );
}

/** A pin with its chip beside it, anchored at the pin's tip. */
export function PinWithLabel({ pin, label }: { pin: ReactNode; label: ReactNode }) {
  return (
    <span className="relative block">
      {pin}
      <span className="absolute top-1 left-full ml-1.5">{label}</span>
    </span>
  );
}
