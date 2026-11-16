import { describe, expect, it } from 'vitest';
import { isCurrentSection, isSitePath, pathOf } from './navigation';

describe('current section', () => {
  it.each([
    ['/', '/', true],
    ['/', '/menu', false],
    ['/menu', '/menu', true],
    ['/menu', '/menu/bulgogi', true],
    ['/menu', '/menus', false],
    ['/blog', '/menu', false],
    ['/contact', '/contact', true],
  ])('%s is current on %s: %s', (href, pathname, expected) => {
    expect(isCurrentSection(href, pathname)).toBe(expected);
  });
});

describe('site paths', () => {
  it('accepts paths on this site', () => {
    expect(isSitePath('/menu?cuisine=korean')).toBe(true);
    expect(isSitePath('/')).toBe(true);
  });

  it('rejects other origins and protocol-relative links', () => {
    expect(isSitePath('https://example.com')).toBe(false);
    expect(isSitePath('//evil.example')).toBe(false);
    expect(isSitePath('/\\evil.example')).toBe(false);
    expect(isSitePath('javascript:alert(1)')).toBe(false);
  });

  it('strips the query and hash', () => {
    expect(pathOf('/menu?cuisine=thai')).toBe('/menu');
    expect(pathOf('/menu#specials')).toBe('/menu');
    expect(pathOf('/menu/pad-thai')).toBe('/menu/pad-thai');
  });
});
