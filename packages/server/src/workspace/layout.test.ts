import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertSafeSegment, isInside, WorkspaceLayout, WorkspacePathError } from './layout.js';

const ROOT = path.resolve(path.sep, 'ws-root');
const layout = new WorkspaceLayout(ROOT);
const SHA = 'a'.repeat(40);

describe('WorkspaceLayout: bentuk path', () => {
  it('menyusun semua lokasi sesuai dokumen arsitektur', () => {
    const rel = (p: string) => path.relative(ROOT, p).split(path.sep).join('/');
    expect(rel(layout.dbFile)).toBe('app.db');
    expect(rel(layout.projectContextDir('order-system'))).toBe('contexts/projects/order-system');
    expect(rel(layout.repoProfileFile('order-system', 'svc-order'))).toBe(
      'contexts/projects/order-system/svc-order.md',
    );
    expect(rel(layout.specCacheFile(7, SHA, 'abc123'))).toBe(`cache/specs/7/${SHA}-abc123.json`);
    expect(rel(layout.extractCacheFile(7, SHA, 'v1-m1'))).toBe(`cache/extract/7/${SHA}-v1-m1.json`);
    expect(rel(layout.checkRunDir(42))).toBe('runs/checks/42');
    expect(rel(layout.checkArtifact(42, 'spec-base.json'))).toBe('runs/checks/42/spec-base.json');
    expect(rel(layout.checkExtractFile(42, 'a.json'))).toBe('runs/checks/42/extract/a.json');
    expect(rel(layout.worktreeDir(42, SHA))).toBe(`runs/checks/42/wt-${SHA}`);
  });

  it('semua path yang dihasilkan berada di dalam root', () => {
    const all = [
      layout.dbFile,
      layout.contextsDir,
      layout.specCacheDir,
      layout.extractCacheDir,
      layout.checksDir,
      layout.projectContextDir('p'),
      layout.repoProfileFile('p', 'r'),
      layout.specCacheFile(1, SHA, 'ab'),
      layout.extractCacheFile(1, SHA, 'v1'),
      layout.checkRunDir(1),
      layout.checkArtifact(1, 'x.json'),
      layout.worktreeDir(1, SHA),
    ];
    for (const p of all) expect(isInside(ROOT, p)).toBe(true);
  });
});

describe('WorkspaceLayout: menolak path yang keluar dari WORKSPACE_DIR', () => {
  it.each([
    '..',
    '../x',
    'a/b',
    'a\\b',
    '/etc/passwd',
    'C:evil',
    '',
    '.',
    'x\0y',
    'nama.',
    'nama ',
  ])('slug project %j ditolak', (slug) => {
    expect(() => layout.projectContextDir(slug)).toThrow(WorkspacePathError);
  });

  it.each(['../../x', 'a/b', '..', 'x:y', 'x*', ''])('nama repo %j ditolak', (name) => {
    expect(() => layout.repoProfileFile('p', name)).toThrow(WorkspacePathError);
  });

  it.each(['../x', 'a/b', '..'])('nama artefak %j ditolak', (name) => {
    expect(() => layout.checkArtifact(1, name)).toThrow(WorkspacePathError);
    expect(() => layout.checkExtractFile(1, name)).toThrow(WorkspacePathError);
  });

  it('sha dan hash yang bukan hex ditolak', () => {
    expect(() => layout.worktreeDir(1, '../../x')).toThrow(WorkspacePathError);
    expect(() => layout.specCacheFile(1, 'zzzzzzz', 'ab')).toThrow(WorkspacePathError);
    expect(() => layout.specCacheFile(1, SHA, '../ab')).toThrow(WorkspacePathError);
    expect(() => layout.extractCacheFile(1, 'abc', 'v1')).toThrow(WorkspacePathError); // terlalu pendek
    expect(() => layout.extractCacheFile(1, SHA, 'v1/../../x')).toThrow(WorkspacePathError);
  });

  it.each([0, -1, 1.5, Number.NaN])('id %s ditolak', (id) => {
    expect(() => layout.checkRunDir(id)).toThrow(WorkspacePathError);
    expect(() => layout.specCacheFile(id, SHA, 'ab')).toThrow(WorkspacePathError);
  });

  it('resolveInside menolak path absolut dan ../ di luar root, menerima yang di dalam', () => {
    const outside = path.resolve(path.sep, 'elsewhere', 'x');
    expect(() => layout.resolveInside(outside)).toThrow(WorkspacePathError);
    expect(() => layout.resolveInside(path.join('..', 'x'))).toThrow(WorkspacePathError);
    expect(() => layout.resolveInside(path.join('a', '..', '..', 'x'))).toThrow(WorkspacePathError);
    expect(layout.resolveInside(path.join('a', 'b.json'))).toBe(path.join(ROOT, 'a', 'b.json'));
    expect(layout.resolveInside(path.join(ROOT, 'a'))).toBe(path.join(ROOT, 'a'));
  });

  it('direktori bersaudara dengan awalan sama bukan "di dalam" (ws-root vs ws-root-evil)', () => {
    expect(isInside(ROOT, `${ROOT}-evil`)).toBe(false);
    expect(() => layout.resolveInside(`${ROOT}-evil`)).toThrow(WorkspacePathError);
  });

  it('root relatif ditolak', () => {
    expect(() => new WorkspaceLayout('relatif/dir')).toThrow(WorkspacePathError);
  });
});

describe('assertSafeSegment', () => {
  it('menerima nama biasa, termasuk spasi di tengah dan titik di tengah', () => {
    expect(assertSafeSegment('svc-order', 'x')).toBe('svc-order');
    expect(assertSafeSegment('My Repo', 'x')).toBe('My Repo');
    expect(assertSafeSegment('v1.2.3', 'x')).toBe('v1.2.3');
  });
});
