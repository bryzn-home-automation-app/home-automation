// @vitest-environment node
import { beforeAll, describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from 'tailwindcss';

/*
 * Compiles src/index.css with Tailwind (the same compiler the Vite plugin uses)
 * and checks that nothing in the file was silently dropped.
 *
 * Why this exists: a comment in the palette section once contained a stray
 * comment terminator, which ended the comment early. Tailwind read the leftover
 * text (it began with "--") as a custom property running to the end of the file,
 * and the first !important further down truncated it. Every rule after that
 * point (the Light Ocean palette, pb-safe, all @keyframes, the pixel-scene
 * animations) was missing from production CSS while the build stayed green.
 */

const require = createRequire(import.meta.url);
const INDEX_CSS = fileURLToPath(new URL('../index.css', import.meta.url));
const TAILWIND_DIR = path.dirname(require.resolve('tailwindcss/package.json'));

async function loadStylesheet(id: string, base: string) {
  const file = id === 'tailwindcss' ? path.join(TAILWIND_DIR, 'index.css') : path.resolve(base, id);
  return { path: file, base: path.dirname(file), content: readFileSync(file, 'utf8') };
}

/**
 * Walks `css` outside comments and strings. Returns the brace depth left open
 * at the end, plus the prelude (selector or at-rule text, whitespace collapsed)
 * of every top-level block.
 */
function scanTopLevel(css: string): { finalDepth: number; preludes: string[] } {
  const preludes: string[] = [];
  let depth = 0;
  let buffer = '';
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      i = end < 0 ? css.length : end + 1;
      continue;
    }
    if (c === '"' || c === "'") {
      const start = i;
      i++;
      while (i < css.length && css[i] !== c) i += css[i] === '\\' ? 2 : 1;
      if (depth === 0) buffer += css.slice(start, i + 1);
      continue;
    }
    if (c === '{') {
      if (depth === 0) preludes.push(buffer.replace(/\s+/g, ' ').trim());
      depth++;
    } else if (c === '}') {
      depth--;
      buffer = '';
    } else if (depth === 0) {
      buffer = c === ';' ? '' : buffer + c;
    }
  }
  return { finalDepth: depth, preludes };
}

let css = '';
let preludes: string[] = [];
let finalDepth = 0;

beforeAll(async () => {
  const source = readFileSync(INDEX_CSS, 'utf8');
  const compiler = await compile(source, { base: path.dirname(INDEX_CSS), loadStylesheet });
  // Candidates for the utilities checked below (normally found by scanning the app).
  css = compiler.build(['pb-safe', 'animate-spin', 'animate-pulse']);
  ({ finalDepth, preludes } = scanTopLevel(css));
});

describe('index.css compiles completely', () => {
  it('produces balanced output that reaches the last rule in the file', () => {
    expect(finalDepth).toBe(0);
    expect(preludes).toContain('@keyframes px-drive-wide');
  });

  it('never turns leftover comment text into a top-level rule', () => {
    // A top-level "--name" block is text that escaped a comment.
    expect(preludes.filter((p) => p.startsWith('--'))).toEqual([]);
  });

  it('processes every Tailwind directive instead of passing it through as text', () => {
    for (const directive of ['@apply', '@utility', '@theme', '@custom-variant']) {
      expect(css, `${directive} left unprocessed in the output`).not.toContain(directive);
    }
    expect(css).toMatch(/\.pb-safe\s*\{\s*padding-bottom:\s*env\(safe-area-inset-bottom\)/);
    expect(preludes).toContain('.theme-toggle');
  });

  it('keeps every palette block, including Light Ocean', () => {
    for (const theme of ['light', 'dark']) {
      for (const palette of ['ocean', 'sunset', 'violet']) {
        expect(preludes).toContain(`[data-theme="${theme}"][data-palette="${palette}"]`);
      }
    }
  });

  it('emits the keyframes for the pixel scenes and Tailwind animate-* utilities', () => {
    for (const name of ['px-bob', 'px-flicker', 'px-twinkle', 'px-pulse', 'px-drive', 'px-swing', 'px-spin', 'roomba-halo-pulse', 'spin', 'pulse']) {
      expect(preludes).toContain(`@keyframes ${name}`);
    }
  });
});
