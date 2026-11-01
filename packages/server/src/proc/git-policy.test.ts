import { describe, expect, it } from 'vitest';
import { CommandNotAllowedError } from './errors.js';
import { checkGitArgs } from './git-policy.js';

describe('checkGitArgs: diizinkan', () => {
  it.each([
    [['fetch', '--prune', 'origin']],
    [['-C', '/repo', 'fetch', '--prune', 'origin']],
    [['-C', '/repo', 'rev-parse', '--is-inside-work-tree']],
    [['rev-parse', '--verify', 'origin/main']],
    [['merge-base', 'origin/main', 'abc1234']],
    [['show', 'abc1234:src/a.ts']],
    [['ls-tree', '-r', '--name-only', 'origin/main']],
    [['for-each-ref', 'refs/remotes/origin']],
    [['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']],
    [['grep', '-n', '-F', '-e', '/orders', 'origin/main']],
    [['diff', '--name-only', 'a...b']],
    [['worktree', 'add', '--detach', '/ws/runs/checks/1/wt-abc', 'abc1234']],
    [['worktree', 'remove', '--force', '/ws/runs/checks/1/wt-abc']],
    [['worktree', 'prune']],
    [['--no-pager', '-c', 'core.quotepath=false', '-C', '/repo', 'show', 'x:y']],
  ])('%j', (args) => {
    expect(() => checkGitArgs(args)).not.toThrow();
  });

  it('mengembalikan subcommand dan action worktree', () => {
    expect(checkGitArgs(['-C', '/r', 'show', 'x'])).toEqual({ subcommand: 'show' });
    expect(checkGitArgs(['worktree', 'prune'])).toEqual({
      subcommand: 'worktree',
      action: 'prune',
    });
  });

  it('pola grep dan argumen sesudah -- tidak dianggap opsi walau diawali -', () => {
    expect(() => checkGitArgs(['grep', '-n', '-F', '-e', '--output', 'origin/main'])).not.toThrow();
    expect(() => checkGitArgs(['show', '--', '--output=x'])).not.toThrow();
  });
});

describe('checkGitArgs: dilarang (repo user read-only)', () => {
  it.each(['checkout', 'switch', 'reset', 'clean', 'commit', 'push', 'stash', 'apply'])(
    'git %s ditolak, juga dengan -C di depannya',
    (subcommand) => {
      expect(() => checkGitArgs([subcommand, '.'])).toThrow(CommandNotAllowedError);
      expect(() => checkGitArgs(['-C', '/repo', subcommand])).toThrow(/read-only/);
    },
  );

  it.each(['restore', 'merge', 'rebase', 'pull', 'add', 'rm', 'tag', 'branch', 'config'])(
    'subcommand penulis lain (%s) ditolak',
    (subcommand) => {
      expect(() => checkGitArgs([subcommand])).toThrow(CommandNotAllowedError);
    },
  );

  it('subcommand yang tidak dikenal ditolak (allowlist, bukan denylist)', () => {
    expect(() => checkGitArgs(['frobnicate'])).toThrow(/allowlist/);
    expect(() => checkGitArgs([])).toThrow(/kosong/);
  });

  it('fetch tanpa --prune ditolak', () => {
    expect(() => checkGitArgs(['fetch', 'origin'])).toThrow(/--prune/);
  });

  it.each([['worktree'], ['worktree', 'list'], ['worktree', 'move'], ['worktree', 'lock']])(
    'worktree %j ditolak',
    (...args) => {
      expect(() => checkGitArgs(args.flat())).toThrow(CommandNotAllowedError);
    },
  );

  it.each([
    [['-c', 'core.sshCommand=calc', 'fetch', '--prune']],
    [['-c', 'alias.show=!calc', 'show']],
    [['-c']],
    [['--exec-path=/tmp', 'show']],
    [['--git-dir=/other', 'show']],
    [['--work-tree=/other', 'show']],
    [['fetch', '--prune', '--upload-pack=calc', 'origin']],
    [['grep', '--open-files-in-pager=calc', 'x']],
    [['grep', '-Ocalc', 'x']],
    [['diff', '--output=/tmp/x']],
    [['show', '--output=/tmp/x', 'abc1234']],
  ])('opsi berbahaya %j ditolak', (args) => {
    expect(() => checkGitArgs(args)).toThrow(CommandNotAllowedError);
  });
});
