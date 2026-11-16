import { beforeEach, describe, expect, it, vi } from 'vitest';

let memory: typeof import('./route-memory');

beforeEach(async () => {
  vi.resetModules();
  memory = await import('./route-memory');
});

describe('route memory', () => {
  it('knows nothing on the first page of a visit', () => {
    memory.rememberRoute('/menu/pad-thai');
    expect(memory.previousRoute()).toBeNull();
  });

  it('remembers the page before this one', () => {
    memory.rememberRoute('/');
    memory.rememberRoute('/menu');
    memory.rememberRoute('/menu/pad-thai');
    expect(memory.previousRoute()).toBe('/menu');
  });

  it('keeps the menu tab the visitor left from', () => {
    memory.rememberRoute('/');
    memory.rememberRoute('/menu');
    memory.rememberRoute('/menu?cuisine=thai');
    expect(memory.previousRoute()).toBe('/');

    memory.rememberRoute('/menu/pad-thai');
    expect(memory.previousRoute()).toBe('/menu?cuisine=thai');
  });

  it('ignores a repeat of the current route', () => {
    memory.rememberRoute('/menu');
    memory.rememberRoute('/menu/pad-thai');
    memory.rememberRoute('/menu/pad-thai');
    expect(memory.previousRoute()).toBe('/menu');
  });
});
