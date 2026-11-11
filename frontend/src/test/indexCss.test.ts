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
 * point (the Light Ocean finish, pb-safe, all @keyframes, the pixel-scene
 * animations) was missing from production CSS while the build stayed green.
 */

const require = createRequire(import.meta.url);
const INDEX_CSS = fileURLToPath(new URL('../index.css', import.meta.url));
const KIT_CSS = fileURLToPath(new URL('../styles/faceplate.css', import.meta.url));
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
let source = '';

async function build(text: string): Promise<string> {
  const compiler = await compile(text, { base: path.dirname(INDEX_CSS), loadStylesheet });
  // Candidates for the utilities checked below (normally found by scanning the app).
  return compiler.build(['animate-spin', 'animate-pulse']);
}

/** Every `@keyframes` name declared in a stylesheet's code (comments stripped). */
function declaredKeyframes(text: string): string[] {
  return [...text.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]);
}

/** The prelude of the last top-level rule in index.css itself (not the imports), read from the source. */
function lastSourceRule(text: string): string {
  const { preludes: own } = scanTopLevel(text);
  return own[own.length - 1];
}

/**
 * The checks that would notice a truncated stylesheet: the output is balanced, nothing escaped a
 * comment, the source's last rule and every keyframes block (index.css and the kit) made it.
 * Returns what is missing, so the same function can be run on a deliberately broken copy.
 */
function truncationProblems(text: string, out: string): string[] {
  const scan = scanTopLevel(out);
  const problems: string[] = [];
  if (scan.finalDepth !== 0) problems.push(`unbalanced output (depth ${scan.finalDepth})`);
  const escaped = scan.preludes.filter((p) => p.startsWith('--'));
  if (escaped.length) problems.push(`comment text became a rule: ${escaped[0].slice(0, 60)}`);
  const last = lastSourceRule(text);
  if (!scan.preludes.includes(last)) problems.push(`last rule missing: ${last}`);
  for (const name of [...declaredKeyframes(text), ...declaredKeyframes(readFileSync(KIT_CSS, 'utf8'))]) {
    if (!new RegExp(`@keyframes ${name}\\s*\\{`).test(out)) problems.push(`@keyframes ${name} missing`);
  }
  return problems;
}

beforeAll(async () => {
  source = readFileSync(INDEX_CSS, 'utf8');
  css = await build(source);
  ({ finalDepth, preludes } = scanTopLevel(css));
});

describe('index.css compiles completely', () => {
  it('produces balanced output that reaches the last rule in the file', () => {
    expect(finalDepth).toBe(0);
    // Read from the source, so deleting or adding rules at the end can't leave a stale sentinel.
    expect(preludes).toContain(lastSourceRule(source));
  });

  it('never turns leftover comment text into a top-level rule', () => {
    // A top-level "--name" block is text that escaped a comment.
    expect(preludes.filter((p) => p.startsWith('--'))).toEqual([]);
  });

  it('emits every @keyframes block declared in index.css and the kit', () => {
    // Built CSS had 20 blocks in 1a, 13 after 1d (the pixel scene went) and 12 after phase 2
    // (no page uses Tailwind's ping animation any more). Tailwind only emits its own animate-* keyframes for
    // utilities in use; everything declared in our files must always be there.
    expect(truncationProblems(source, css)).toEqual([]);
    expect(declaredKeyframes(source)).toContain('roomba-halo-pulse');
  });

  it('would notice a stray comment terminator truncating the file', async () => {
    // The 2026 incident, replayed: a comment ending early leaves "--…" text at the top level.
    const at = source.indexOf(':root:not([data-theme="dark"])');
    expect(at).toBeGreaterThan(0);
    const broken = `${source.slice(0, at)}/* the --app tokens */ --apptext-note: stays */\n${source.slice(at)}`;
    const problems = truncationProblems(broken, await build(broken));
    expect(problems.length).toBeGreaterThan(0);
  });

  it('processes every Tailwind directive instead of passing it through as text', () => {
    for (const directive of ['@apply', '@utility', '@theme', '@custom-variant']) {
      expect(css, `${directive} left unprocessed in the output`).not.toContain(directive);
    }
    // body's @apply resolved to the tokens.
    expect(css).toMatch(/body\s*\{[^}]*background-color:\s*var\(--color-appbg\)/);
    expect(preludes).toContain('.roomba-roomhit:hover > polygon');
  });

  it('keeps the rules that follow the old palette section (where the 2026 truncation began)', () => {
    // The finish blocks became the app colour (inline tokens from utils/appColour.ts); what came
    // after them in the file must still all be there.
    expect(preludes).toContain('.theme-switching *, .theme-switching *::before, .theme-switching *::after');
    expect(preludes).toContain('.app-wheel-handle:focus-visible::before');
    expect(css).toMatch(/--appradius-panel:\s*12px/);
  });

  it('emits the Roomba halo keyframes and the Tailwind animate-* ones', () => {
    for (const name of ['roomba-halo-pulse', 'spin', 'pulse']) {
      expect(preludes).toContain(`@keyframes ${name}`);
    }
  });

  it('keeps the light-only pastel remap (the deferred Maintenance tab still uses palette classes) and the theme blocks', () => {
    expect(preludes).toContain(':root, [data-theme="light"]');
    expect(preludes).toContain('[data-theme="dark"]');
    expect(preludes).toContain(':root:not([data-theme="dark"])');
  });
});

describe('the Faceplate kit (styles/faceplate.css)', () => {
  const kit = readFileSync(KIT_CSS, 'utf8');

  it('compiles completely, inside the components layer', () => {
    expect(preludes).toContain('@layer components');
    // Its first and last rules both made it, so nothing in between was cut off.
    expect(css).toMatch(/\.fp-sprite\s*\{/);
    expect(css).toMatch(/\.fp-disclosure--row\.fp-mt-m\s*\{/);
    for (const name of ['fp-lamp-pulse', 'fp-scrim-in', 'fp-sheet-in', 'fp-dialog-in', 'fp-skel-shine', 'fp-rec-blink', 'fp-map-ping', 'fp-dial-sweep', 'fp-dial-needle']) {
      expect(css, `@keyframes ${name}`).toMatch(new RegExp(`@keyframes ${name}\\s*\\{`));
    }
  });

  it('prefixes every class with fp-, so none collides with a Tailwind utility', () => {
    const selectors = [...kit.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{};]+)\{/g)]
      .map((m) => m[1].trim())
      .filter((s) => !s.startsWith('@') && !/^(from|to|\d)/.test(s));
    expect(selectors.length).toBeGreaterThan(300);
    const unprefixed = selectors.flatMap((s) =>
      [...s.replace(/\[[^\]]*\]/g, '').matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]).filter((c) => !c.startsWith('fp-')),
    );
    expect(unprefixed).toEqual([]);
  });

  it('has no comment terminator inside a comment and balanced braces', () => {
    // A comment that opens inside another comment means a stray terminator ended one early.
    for (const comment of kit.match(/\/\*[\s\S]*?\*\//g) ?? []) expect(comment.slice(2).includes('/*'), comment.slice(0, 60)).toBe(false);
    expect(scanTopLevel(kit).finalDepth).toBe(0);
  });

  it('draws with the app tokens only: no literal colours outside comments', () => {
    const code = kit.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
    expect(code.match(/rgba?\(/g) ?? []).toEqual([]);
  });
});
