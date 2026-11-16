#!/usr/bin/env node
// Decodes a Figma .fig export into design tokens, per-screen layout specs and image assets.
//
//   node scripts/figma/extract.mjs [input.fig] [outDir]
//
// A .fig file is a ZIP archive. `canvas.fig` inside it starts with the "fig-kiwi" magic,
// a version number, then length-prefixed chunks: chunk 0 is the kiwi schema (deflate-raw),
// chunk 1 is the document encoded with that schema (zstd in recent exports).

import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { unzipSync } from 'fflate';
import sharp from 'sharp';

const input = process.argv[2] ?? 'docs/foodz.fig';
const outDir = process.argv[3] ?? 'design';
const SCREENS_PAGE = 'UI Design';
const IMAGE_MAX_WIDTH = 1600;

// ---------------------------------------------------------------- kiwi decoding

class Reader {
  constructor(bytes) {
    this.d = bytes;
    this.i = 0;
    this.f32 = new Float32Array(1);
    this.i32 = new Int32Array(this.f32.buffer);
  }
  byte() {
    return this.d[this.i++];
  }
  uint() {
    let result = 0;
    let shift = 0;
    let b;
    do {
      b = this.d[this.i++];
      result |= (b & 127) << shift;
      shift += 7;
    } while (b & 128 && shift < 35);
    return result >>> 0;
  }
  int() {
    const v = this.uint();
    return v & 1 ? ~(v >>> 1) : v >>> 1;
  }
  float() {
    const d = this.d;
    const i = this.i;
    if (d[i] === 0) {
      this.i++;
      return 0;
    }
    let bits = d[i] | (d[i + 1] << 8) | (d[i + 2] << 16) | (d[i + 3] << 24);
    this.i += 4;
    bits = (bits << 23) | (bits >>> 9);
    this.i32[0] = bits;
    return this.f32[0];
  }
  string() {
    let end = this.i;
    while (this.d[end] !== 0) end++;
    const s = Buffer.from(this.d.buffer, this.d.byteOffset + this.i, end - this.i).toString('utf8');
    this.i = end + 1;
    return s;
  }
  uint64() {
    let v = 0n;
    let shift = 0n;
    let b;
    while ((b = this.byte()) & 128 && shift < 56n) {
      v |= BigInt(b & 127) << shift;
      shift += 7n;
    }
    return v | (BigInt(b) << shift);
  }
  int64() {
    const v = this.uint64();
    return v & 1n ? ~(v >> 1n) : v >> 1n;
  }
}

const KINDS = ['ENUM', 'STRUCT', 'MESSAGE'];
const PRIMITIVES = ['bool', 'byte', 'int', 'uint', 'float', 'string', 'int64', 'uint64'];

function readSchema(bytes) {
  const r = new Reader(bytes);
  const defs = [];
  const count = r.uint();
  for (let i = 0; i < count; i++) {
    const name = r.string();
    const kind = KINDS[r.byte()];
    const fieldCount = r.uint();
    const fields = [];
    for (let j = 0; j < fieldCount; j++) {
      fields.push({
        name: r.string(),
        type: r.int(),
        isArray: Boolean(r.byte() & 1),
        value: r.uint(),
      });
    }
    defs.push({ name, kind, fields });
  }
  for (const def of defs) {
    for (const field of def.fields) {
      if (def.kind === 'ENUM') field.type = null;
      else field.type = field.type < 0 ? PRIMITIVES[~field.type] : defs[field.type].name;
    }
  }
  return Object.fromEntries(defs.map((d) => [d.name, d]));
}

function decode(schema, r, type) {
  switch (type) {
    case 'bool':
      return Boolean(r.byte());
    case 'byte':
      return r.byte();
    case 'int':
      return r.int();
    case 'uint':
      return r.uint();
    case 'float':
      return r.float();
    case 'string':
      return r.string();
    case 'int64':
      return r.int64();
    case 'uint64':
      return r.uint64();
  }
  const def = schema[type];
  if (def.kind === 'ENUM') {
    const v = r.uint();
    return def.fields.find((f) => f.value === v)?.name ?? v;
  }
  const out = {};
  if (def.kind === 'STRUCT') {
    for (const field of def.fields) out[field.name] = decodeField(schema, r, field);
    return out;
  }
  for (;;) {
    const id = r.uint();
    if (id === 0) return out;
    const field = def.fields.find((f) => f.value === id);
    if (!field) throw new Error(`Unknown field ${id} in ${type}`);
    out[field.name] = decodeField(schema, r, field);
  }
}

function decodeField(schema, r, field) {
  if (!field.isArray) return decode(schema, r, field.type);
  const length = r.uint();
  if (field.type === 'byte') {
    const bytes = r.d.subarray(r.i, r.i + length);
    r.i += length;
    return bytes;
  }
  const items = [];
  for (let i = 0; i < length; i++) items.push(decode(schema, r, field.type));
  return items;
}

function inflateChunk(chunk) {
  const isZstd = chunk[0] === 0x28 && chunk[1] === 0xb5 && chunk[2] === 0x2f && chunk[3] === 0xfd;
  return isZstd ? zlib.zstdDecompressSync(chunk) : zlib.inflateRawSync(chunk);
}

function readCanvas(canvas) {
  const view = Buffer.from(canvas);
  if (view.subarray(0, 8).toString() !== 'fig-kiwi') throw new Error('Not a Figma kiwi canvas');
  const chunks = [];
  let offset = 12;
  while (offset < view.length) {
    const length = view.readUInt32LE(offset);
    chunks.push(view.subarray(offset + 4, offset + 4 + length));
    offset += 4 + length;
  }
  const schema = readSchema(inflateChunk(chunks[0]));
  return decode(schema, new Reader(inflateChunk(chunks[1])), 'Message');
}

// ---------------------------------------------------------------- helpers

const guidKey = (g) => (g ? `${g.sessionID}:${g.localID}` : '');
const round = (n) => Math.round(n * 100) / 100;
const hashHex = (bytes) => Buffer.from(bytes).toString('hex');
const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const channel = (v) =>
  Math.round(v * 255)
    .toString(16)
    .padStart(2, '0');

function hex(color, opacity = 1) {
  const alpha = (color.a ?? 1) * opacity;
  const base = `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`.toUpperCase();
  return alpha < 1 ? `${base}/${round(alpha)}` : base;
}

function overridesFor(instance) {
  const map = new Map();
  for (const o of instance.symbolData?.symbolOverrides ?? []) {
    const target = o.guidPath?.guids?.at(-1);
    if (target) map.set(guidKey(target), o);
  }
  return map;
}

function paints(list) {
  return (list ?? [])
    .filter((p) => p.visible !== false)
    .map((p) => {
      if (p.type === 'SOLID') return { type: 'solid', color: hex(p.color, p.opacity ?? 1) };
      if (p.type === 'IMAGE' && p.image?.hash) {
        return { type: 'image', hash: hashHex(p.image.hash), scale: p.imageScaleMode };
      }
      if (p.type?.startsWith('GRADIENT')) {
        return {
          type: p.type.toLowerCase(),
          stops: (p.stops ?? []).map((s) => ({ color: hex(s.color), at: round(s.position) })),
        };
      }
      return { type: String(p.type).toLowerCase() };
    });
}

function lineHeight(lh) {
  if (!lh) return undefined;
  if (lh.units === 'PERCENT') return `${round(lh.value)}%`;
  if (lh.units === 'PIXELS') return `${round(lh.value)}px`;
  return 'auto';
}

function letterSpacing(ls) {
  if (!ls) return undefined;
  return ls.units === 'PERCENT' ? `${round(ls.value)}%` : `${round(ls.value)}px`;
}

function textStyle(node) {
  return {
    family: node.fontName?.family,
    style: node.fontName?.style,
    size: node.fontSize,
    lineHeight: lineHeight(node.lineHeight),
    letterSpacing: letterSpacing(node.letterSpacing),
    align: node.textAlignHorizontal,
    case: node.textCase,
  };
}

// ---------------------------------------------------------------- main

async function main() {
  const zip = unzipSync(new Uint8Array(await readFile(input)));
  const message = readCanvas(zip['canvas.fig']);
  const nodes = message.nodeChanges;
  const byId = new Map(nodes.map((n) => [guidKey(n.guid), n]));
  const children = new Map();
  for (const n of nodes) {
    const parent = guidKey(n.parentIndex?.guid);
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(n);
  }
  for (const list of children.values()) {
    list.sort((a, b) => (a.parentIndex.position < b.parentIndex.position ? -1 : 1));
  }
  const kids = (n) => children.get(guidKey(n.guid)) ?? [];

  const imageUsage = new Map();
  const noteImage = (hash, name) => {
    if (!imageUsage.has(hash)) imageUsage.set(hash, new Set());
    imageUsage.get(hash).add(name);
  };

  function toSpec(node, originX, originY, overrides, depth) {
    if (depth > 60) return null;
    const override = overrides.get(guidKey(node.guid)) ?? overrides.get(guidKey(node.overrideKey));
    const merged = override ? { ...node, ...override, guid: node.guid } : node;
    if (merged.visible === false) return null;

    const x = originX + (merged.transform?.m02 ?? 0);
    const y = originY + (merged.transform?.m12 ?? 0);
    const spec = {
      name: merged.name,
      type: merged.type,
      x: round(x),
      y: round(y),
      w: round(merged.size?.x ?? 0),
      h: round(merged.size?.y ?? 0),
    };

    const fills = paints(merged.fillPaints);
    if (fills.length) spec.fills = fills;
    for (const f of fills) if (f.type === 'image') noteImage(f.hash, merged.name);
    const strokes = paints(merged.strokePaints);
    if (strokes.length) spec.strokes = { paints: strokes, weight: merged.strokeWeight };
    if (merged.cornerRadius) spec.radius = round(merged.cornerRadius);
    if (merged.opacity !== undefined && merged.opacity < 1) spec.opacity = round(merged.opacity);
    if (merged.effects?.length) {
      spec.effects = merged.effects
        .filter((e) => e.visible !== false)
        .map((e) => ({
          type: e.type,
          color: e.color ? hex(e.color) : undefined,
          x: e.offset?.x,
          y: e.offset?.y,
          blur: e.radius,
          spread: e.spread,
        }));
    }
    if (merged.stackMode && merged.stackMode !== 'NONE') {
      spec.layout = {
        direction: merged.stackMode,
        gap: merged.stackSpacing ?? 0,
        padding: [
          merged.stackVerticalPadding ?? merged.stackPaddingTop ?? 0,
          merged.stackPaddingRight ?? merged.stackHorizontalPadding ?? 0,
          merged.stackPaddingBottom ?? merged.stackVerticalPadding ?? 0,
          merged.stackHorizontalPadding ?? 0,
        ],
        mainAlign: merged.stackPrimaryAlignItems,
        crossAlign: merged.stackCounterAlignItems,
      };
    }
    if (merged.type === 'TEXT') {
      spec.text = merged.textData?.characters ?? '';
      spec.style = textStyle(merged);
    }

    let childNodes = kids(node);
    let childOverrides = overrides;
    if (node.type === 'INSTANCE' && node.symbolData?.symbolID) {
      const master = byId.get(guidKey(node.symbolData.symbolID));
      if (master) {
        spec.component = master.name;
        childNodes = kids(master);
        childOverrides = new Map([...overrides, ...overridesFor(node)]);
      }
    }
    const childSpecs = childNodes
      .map((c) => toSpec(c, x, y, childOverrides, depth + 1))
      .filter(Boolean);
    if (childSpecs.length) spec.children = childSpecs;
    return spec;
  }

  // tokens
  const tokens = { colors: {}, text: {}, effects: {}, grids: {} };
  for (const n of nodes) {
    if (n.styleType === 'FILL' && n.fillPaints?.[0]?.type === 'SOLID') {
      tokens.colors[n.name] = hex(n.fillPaints[0].color, n.fillPaints[0].opacity ?? 1);
    } else if (n.styleType === 'TEXT') {
      tokens.text[n.name] = textStyle(n);
    } else if (n.styleType === 'EFFECT') {
      tokens.effects[n.name] = (n.effects ?? []).map((e) => ({
        type: e.type,
        color: hex(e.color),
        x: e.offset.x,
        y: e.offset.y,
        blur: e.radius,
        spread: e.spread,
      }));
    }
    if (n.layoutGrids?.length && n.type === 'FRAME') {
      tokens.grids[n.name] = n.layoutGrids.map((g) => ({
        pattern: g.pattern,
        count: g.numSections,
        gutter: g.gutterSize,
        margin: g.offset,
        align: g.align,
      }));
    }
  }

  // screens
  const page = nodes.find((n) => n.type === 'CANVAS' && n.name.includes(SCREENS_PAGE));
  if (!page) throw new Error(`Page "${SCREENS_PAGE}" not found`);
  const frames = kids(page).filter((n) => n.type === 'FRAME' && n.visible !== false);

  await rm(path.join(outDir, 'screens'), { recursive: true, force: true });
  await mkdir(path.join(outDir, 'screens'), { recursive: true });
  await mkdir(path.join(outDir, 'assets'), { recursive: true });

  const index = await Promise.all(
    frames.map(async (frame) => {
      const ox = -(frame.transform?.m02 ?? 0);
      const oy = -(frame.transform?.m12 ?? 0);
      const spec = toSpec(frame, ox, oy, new Map(), 0);
      const file = `${slug(frame.name)}.json`;
      await writeFile(path.join(outDir, 'screens', file), JSON.stringify(spec, null, 2));
      return { name: frame.name, file, width: spec.w, height: spec.h };
    }),
  );

  // the "Image" page holds the named food photography
  const imagePage = nodes.find((n) => n.type === 'CANVAS' && n.name === 'Image');
  for (const n of imagePage ? kids(imagePage) : []) {
    for (const f of paints(n.fillPaints)) if (f.type === 'image') noteImage(f.hash, n.name);
  }

  const assets = await Promise.all(
    [...imageUsage]
      .filter(([hash]) => zip[`images/${hash}`])
      .map(async ([hash, names]) => {
        const name = slug([...names][0]) || hash.slice(0, 12);
        const file = `${name}-${hash.slice(0, 6)}.webp`;
        const meta = await sharp(Buffer.from(zip[`images/${hash}`]))
          .rotate()
          .resize({ width: IMAGE_MAX_WIDTH, withoutEnlargement: true })
          .webp({ quality: 82 })
          .toFile(path.join(outDir, 'assets', file));
        return { file, usedBy: [...names], width: meta.width, height: meta.height };
      }),
  );

  await writeFile(path.join(outDir, 'tokens.json'), JSON.stringify(tokens, null, 2));
  await writeFile(
    path.join(outDir, 'index.json'),
    JSON.stringify({ source: path.basename(input), screens: index, assets }, null, 2),
  );

  console.warn(
    `Extracted ${index.length} screens, ${assets.length} images, ` +
      `${Object.keys(tokens.colors).length} colors, ${Object.keys(tokens.text).length} text styles → ${outDir}/`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
