import { describe, expect, it } from 'vitest';
import {
  CreateRepoRequest,
  Repo,
  RepoFetchResult,
  RepoIdParams,
  RepoRef,
  UpdateRepoRequest,
} from './repos.js';

const messagesOf = (result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}) => result.error?.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);

describe('CreateRepoRequest', () => {
  it('menerima isian minimal; name dan default_branch kosong dianggap tidak dikirim', () => {
    expect(CreateRepoRequest.parse({ role: 'service', local_path: '/r' })).toEqual({
      role: 'service',
      local_path: '/r',
    });
    expect(
      CreateRepoRequest.parse({ role: 'e2e', local_path: '/r', name: '   ', default_branch: '' }),
    ).toEqual({ role: 'e2e', local_path: '/r', name: undefined, default_branch: undefined });
  });

  it('name dan default_branch di-trim', () => {
    expect(
      CreateRepoRequest.parse({
        role: 'microfrontend',
        local_path: '/r',
        name: '  web  ',
        default_branch: ' main ',
      }),
    ).toMatchObject({ name: 'web', default_branch: 'main' });
  });

  it('local_path dibiarkan apa adanya: normalisasi dan kodenya urusan server', () => {
    expect(CreateRepoRequest.parse({ role: 'service', local_path: '' }).local_path).toBe('');
  });

  it('pesan galat berbahasa Indonesia per isian', () => {
    expect(messagesOf(CreateRepoRequest.safeParse({ role: 'admin' }))).toEqual([
      'role: Peran repo harus salah satu dari: service, microfrontend, e2e',
      'local_path: Path folder repo wajib diisi',
    ]);
    expect(
      messagesOf(CreateRepoRequest.safeParse({ role: 'service', local_path: 1, name: 5 })),
    ).toEqual(['local_path: Path folder repo wajib diisi', 'name: Nama repo harus berupa teks']);
    expect(messagesOf(CreateRepoRequest.safeParse(null))).toEqual([
      ': Body harus berupa objek JSON',
    ]);
  });
});

describe('UpdateRepoRequest', () => {
  it('semua isian opsional; yang tidak dikirim tidak muncul', () => {
    expect(UpdateRepoRequest.parse({})).toEqual({});
  });

  it('spec_path dan spec_cmd: kosong, spasi, atau null menjadi null', () => {
    expect(UpdateRepoRequest.parse({ spec_path: '', spec_cmd: '  ' })).toEqual({
      spec_path: null,
      spec_cmd: null,
    });
    expect(UpdateRepoRequest.parse({ spec_path: null })).toEqual({ spec_path: null });
    expect(UpdateRepoRequest.parse({ spec_path: ' openapi.json ' })).toEqual({
      spec_path: 'openapi.json',
    });
  });

  it('default_branch tidak boleh kosong; name dan local_path dibuang diam-diam', () => {
    expect(messagesOf(UpdateRepoRequest.safeParse({ default_branch: ' ' }))).toEqual([
      'default_branch: Branch default tidak boleh kosong',
    ]);
    expect(UpdateRepoRequest.parse({ name: 'baru', local_path: '/lain', role: 'e2e' })).toEqual({
      role: 'e2e',
    });
  });
});

describe('RepoIdParams', () => {
  it('id harus bilangan bulat positif', () => {
    expect(RepoIdParams.parse({ id: '7' })).toEqual({ id: 7 });
    for (const id of ['abc', '0', '-1', '1.5']) {
      expect(messagesOf(RepoIdParams.safeParse({ id }))).toEqual(['id: Id repo tidak valid']);
    }
  });
});

describe('Repo', () => {
  it('mengenali bentuk baris repos', () => {
    const row = {
      id: 1,
      project_id: 2,
      role: 'service',
      name: 'svc-order',
      local_path: '/r',
      default_branch: 'main',
      spec_path: null,
      spec_cmd: null,
      profile_status: 'not_scanned',
      profile_error: null,
      last_fetch_at: null,
    };
    expect(Repo.parse(row)).toEqual(row);
    expect(Repo.safeParse({ ...row, profile_status: 'scanning' }).success).toBe(false);
  });
});

describe('RepoRef dan RepoFetchResult', () => {
  it('RepoRef: kind hanya branch atau tag', () => {
    const branch = { name: 'feature/xyz', kind: 'branch', sha: 'abc123' };
    expect(RepoRef.parse(branch)).toEqual(branch);
    expect(RepoRef.parse({ ...branch, kind: 'tag' }).kind).toBe('tag');
    expect(RepoRef.safeParse({ ...branch, kind: 'commit' }).success).toBe(false);
  });

  it('RepoFetchResult: gagal membawa alasan, berhasil membawa waktu', () => {
    const ok = {
      repo_id: 1,
      name: 'svc-order',
      ok: true,
      error: null,
      last_fetch_at: '2026-11-01T10:00:00.000Z',
    };
    expect(RepoFetchResult.parse(ok)).toEqual(ok);
    const failed = { ...ok, ok: false, error: 'Fetch gagal: fatal: x', last_fetch_at: null };
    expect(RepoFetchResult.parse(failed)).toEqual(failed);
    expect(RepoFetchResult.safeParse({ ...ok, ok: 'ya' }).success).toBe(false);
  });
});
