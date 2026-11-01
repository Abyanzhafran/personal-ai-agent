import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { COLOR_TOKENS, FONT_TOKENS, RADIUS_TOKENS, TEXT_TOKENS } from './tokens';

// `import.meta.url` bukan URL file di lingkungan jsdom, sedangkan dirname tersedia di semua env vitest.
const WEB_ROOT = path.resolve(import.meta.dirname, '../..');
const SRC = path.join(WEB_ROOT, 'src');
const css = fs.readFileSync(path.join(SRC, 'styles', 'globals.css'), 'utf8');

/** Semua deklarasi `--nama: nilai;` di dalam blok @theme. */
function themeVariables(): Map<string, string> {
  const vars = new Map<string, string>();
  for (const match of css.matchAll(/^\s*(--[\w-]+)\s*:\s*([^;]+);/gm)) {
    vars.set(match[1] as string, (match[2] as string).trim());
  }
  return vars;
}
const variables = themeVariables();

const namesWithPrefix = (prefix: string) =>
  [...variables.keys()]
    .filter((k) => k.startsWith(prefix) && !k.includes('--line-height'))
    .map((k) => k.slice(prefix.length))
    .sort();

// Nilai dari backlog CC-071 dan mockup v2 (Main.dc.html). Hex hanya boleh ditulis di test dan CSS.
const EXPECTED_COLORS: Record<string, string> = {
  primary: '#0B57D0',
  'on-primary': '#FFFFFF',
  'secondary-container': '#D3E3FD',
  'on-secondary-container': '#041E49',
  surface: '#F8FAFD',
  'surface-container-lowest': '#FFFFFF',
  'surface-container': '#F3F6FC',
  'surface-container-high': '#F1F4F9',
  outline: '#747775',
  'outline-variant': '#C4C7C5',
  divider: '#E1E3E1',
  'on-surface': '#1F1F1F',
  'on-surface-variant': '#444746',
  'error-container': '#F9DEDC',
  'on-error-container': '#410E0B',
  'warning-container': '#FFE3A3',
  'on-warning-container': '#3E2E00',
  'success-container': '#C4EED0',
  'on-success-container': '#0A3D1B',
  'info-container': '#DDE3EA',
  'on-info-container': '#1F2A37',
  'neutral-container': '#EDF1F8',
  'code-highlight-break': '#FBE3E1',
  'code-highlight-warn': '#FFF0CC',
  'code-highlight-info': '#E2EAF6',
};

describe('nilai token', () => {
  it.each(Object.entries(EXPECTED_COLORS))('--color-%s = %s', (name, hex) => {
    expect(variables.get(`--color-${name}`)?.toUpperCase()).toBe(hex);
  });

  it('radius 8 / 12 / 20 / 28 px', () => {
    expect(['sm', 'md', 'lg', 'xl'].map((n) => variables.get(`--radius-${n}`))).toEqual([
      '8px',
      '12px',
      '20px',
      '28px',
    ]);
  });

  it('font Roboto dan Roboto Mono', () => {
    expect(variables.get('--font-sans')).toMatch(/^'Roboto',/);
    expect(variables.get('--font-mono')).toMatch(/^'Roboto Mono',/);
  });

  it('skala teks mengikuti mockup: 28/36, 16/24, 14/20, 12/16, 13/20', () => {
    const size = (n: string) =>
      `${variables.get(`--text-${n}`)}/${variables.get(`--text-${n}--line-height`)}`;
    expect(TEXT_TOKENS.map(size)).toEqual([
      '28px/36px',
      '16px/24px',
      '14px/20px',
      '12px/16px',
      '13px/20px',
    ]);
  });
});

describe('daftar nama tidak menyimpang dari CSS', () => {
  it('warna: tepat sama (selain transparent/current)', () => {
    const declared = namesWithPrefix('--color-').filter(
      (n) => n !== 'transparent' && n !== 'current' && n !== '*',
    );
    expect(declared).toEqual([...COLOR_TOKENS].sort());
    expect(Object.keys(EXPECTED_COLORS).sort()).toEqual([...COLOR_TOKENS].sort());
  });

  it('radius, font, dan teks', () => {
    expect(namesWithPrefix('--radius-')).toEqual([...RADIUS_TOKENS].sort());
    expect(namesWithPrefix('--font-')).toEqual([...FONT_TOKENS].sort());
    expect(namesWithPrefix('--text-')).toEqual([...TEXT_TOKENS].sort());
  });

  it('palet bawaan Tailwind dikosongkan', () => {
    expect(css).toMatch(/--color-\*\s*:\s*initial/);
  });

  it('tema memakai `static` supaya semua variabel selalu ada di :root', () => {
    expect(css).toMatch(/@theme\s+static/);
  });
});

function sourceFiles(dir: string): { rel: string; text: string }[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return [
      {
        rel: path.relative(SRC, full).split(path.sep).join('/'),
        text: fs.readFileSync(full, 'utf8'),
      },
    ];
  });
}

describe('tidak ada hex yang ditulis langsung di komponen', () => {
  const files = sourceFiles(SRC);
  const code = files.filter(
    (f) =>
      /\.(tsx?|jsx?)$/.test(f.rel) &&
      !/\.test\.(tsx?|jsx?)$/.test(f.rel) &&
      f.rel !== 'routeTree.gen.ts',
  );

  it('memindai berkas sungguhan', () => {
    expect(code.length).toBeGreaterThan(8);
  });

  it('pemindai mendeteksi hex dalam berbagai bentuk (anti-buta)', () => {
    const hex = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/;
    for (const sample of [
      `color: '#0B57D0'`,
      `bg-[#fff]`,
      `fill="#ffffff80"`,
      'style={{ color: "#abc" }}',
    ]) {
      expect(hex.test(sample), sample).toBe(true);
    }
    expect(hex.test('href="#main"')).toBe(false);
  });

  it('komponen layar bebas dari hex', () => {
    const hex = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/;
    const offenders = code.filter((f) => hex.test(f.text)).map((f) => f.rel);
    expect(offenders).toEqual([]);
  });
});

describe('font dimuat lokal', () => {
  const html = fs.readFileSync(path.join(WEB_ROOT, 'index.html'), 'utf8');
  const EXTERNAL = /fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.|unpkg\.com|jsdelivr/i;

  it('tidak ada rujukan CDN di index.html, CSS, maupun kode', () => {
    const everything = [
      html,
      ...sourceFiles(SRC)
        .filter((f) => !f.rel.endsWith('.test.ts'))
        .map((f) => f.text),
    ];
    for (const text of everything) expect(text).not.toMatch(EXTERNAL);
  });

  it.each([
    ['@fontsource/roboto/latin-400.css', 'roboto-latin-400-normal.woff2'],
    ['@fontsource/roboto/latin-500.css', 'roboto-latin-500-normal.woff2'],
    ['@fontsource/roboto/latin-700.css', 'roboto-latin-700-normal.woff2'],
    ['@fontsource/roboto-mono/latin-400.css', 'roboto-mono-latin-400-normal.woff2'],
    ['@fontsource/roboto-mono/latin-500.css', 'roboto-mono-latin-500-normal.woff2'],
  ])('CSS mengimpor %s dan berkas fontnya ada di node_modules', (specifier, woff2) => {
    expect(css).toContain(`@import '${specifier}'`);
    const pkg = specifier.split('/').slice(0, 2).join('/');
    const dir = path.resolve(WEB_ROOT, '../../node_modules', pkg, 'files');
    expect(fs.existsSync(path.join(dir, woff2))).toBe(true);
  });
});
