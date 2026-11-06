# Contract Check — Tahap 1

Alat lokal yang mendeteksi dampak perubahan kontrak API (OpenAPI) terhadap repo consumer sebelum merge. Satu proses Node di laptop, bind ke `127.0.0.1`, membaca repo lewat `git` (read-only), men-diff spec dengan `oasdiff`, dan memakai Claude hanya untuk membaca kode.

> Perintah dan variabel env di dokumen ini dicocokkan dengan `package.json` dan `.env.example` oleh test (`packages/server/src/docs.test.ts`). Bila ada yang gagal, lihat [RUNBOOK.md](./RUNBOOK.md).

## Status implementasi

Lihat [HANDOFF.md](./HANDOFF.md) untuk task yang sudah selesai, keputusan, dan langkah berikutnya.

## Prasyarat

| Kebutuhan   | Versi                          | Catatan                                                                       |
| ----------- | ------------------------------ | ----------------------------------------------------------------------------- |
| Node.js     | 20.19+ (diuji di 20.20 dan 24) | `.nvmrc` = 20. Node 20 sudah EOL sejak April 2026, lihat HANDOFF D-1          |
| npm         | 10+                            | Workspaces                                                                    |
| git         | 2.30+                          | Dipanggil lewat `runCommand()`                                                |
| `oasdiff`   | >= 1.11                        | Dicek saat start; hilang atau terlalu lama: server tetap hidup, check ditolak |
| Akun Claude | API key + nama model           | Nama model wajib di `.env`; API key hanya dibutuhkan saat Claude dipanggil    |

### Memasang `oasdiff`

`oasdiff` membandingkan dua spec OpenAPI. Pasang salah satu, lalu cek dengan `oasdiff --version` (minimum `1.11.0`):

```bash
brew install oasdiff                                  # macOS / Linux dengan Homebrew
go install github.com/oasdiff/oasdiff@latest          # butuh Go; hasil di $(go env GOPATH)/bin
# atau unduh binary dari https://github.com/oasdiff/oasdiff/releases dan taruh di PATH
```

Langkah ini mengikuti dokumentasi `oasdiff` dan belum dicoba di mesin pengembang. Bila binary tidak ada di `PATH`, isi `OASDIFF_BIN` dengan path lengkapnya. Tanpa `oasdiff`, server tetap hidup tetapi check ditolak.

### Tool generator spec (opsional)

Hanya dibutuhkan bila spec repo provider **tidak** di-commit. Isi `spec_cmd` repo itu (saat menyetujui profil repo) dengan perintah yang menulis spec ke `spec_path`, misalnya `swag init -o docs` untuk Go atau skrip yang mengekspor OpenAPI dari FastAPI. Perintah dijalankan di worktree sementara; tool-nya (`swag`, Python, Node, ...) dipasang sendiri dan tidak dicek saat start. Repo provider dengan spec ter-commit tidak butuh ini.

## Menjalankan

```bash
npm install
cp .env.example .env     # isi ANTHROPIC_MODEL (dan ANTHROPIC_API_KEY untuk memanggil Claude)
npm run dev              # server http://127.0.0.1:4711 + Vite http://127.0.0.1:5173 (proxy /api)
```

Produksi lokal (satu proses, web disajikan server):

```bash
npm run build
npm start -w @cc/server  # http://127.0.0.1:4711
```

## Check pertama

Buka `http://127.0.0.1:5173` (mode `npm run dev`) atau `http://127.0.0.1:4711` (produksi lokal). Halaman **Panduan** menjelaskan alurnya secara singkat. Tanpa repo sendiri, `npm run fixtures` membuat empat repo git contoh (provider `svc-order`, consumer `mfe-dashboard` dan `svc-payment`, serta `e2e-suite`); daftarkan folder hasilnya.

1. **Projects** → **Project baru** → isi nama.
2. **Tambah repo** untuk tiap repo: path lokal folder git (absolut), nama, dan peran. Syaratnya minimal satu `service` (provider) dan, bersama `microfrontend`, total dua repo; `e2e` tidak dihitung. Tiap repo harus punya remote `origin` dengan default branch yang sudah di-fetch.
3. Discovery berjalan otomatis untuk repo non-e2e (butuh `ANTHROPIC_API_KEY`). Buka **Tinjau profil**, periksa, lalu **Setujui & simpan**. Untuk repo provider, isi `spec_path` (dan `spec_cmd` bila spec dibangkitkan).
4. **Checks** → pilih project, provider, serta base dan head ref (branch, tag, atau commit) → **Jalankan check**. Repo di-fetch otomatis di langkah pertama; **Fetch sekarang** hanya untuk memeriksa lebih dulu.
5. Layar progres menampilkan enam langkah. Setelah selesai muncul laporan per endpoint; **Salin ringkasan** menyalin teks untuk deskripsi PR.

## Perintah

| Perintah                      | Fungsi                                                                   |
| ----------------------------- | ------------------------------------------------------------------------ |
| `npm run dev`                 | Server (`node --watch`, restart otomatis) dan Vite bersamaan             |
| `npm run build`               | Build `shared`, `server`, lalu `web` (hasil web di `packages/web/dist`)  |
| `npm test`                    | Vitest, semua paket                                                      |
| `npm run test:coverage`       | `npm test` + ambang cakupan 90% per berkas untuk 5 modul murni           |
| `npm run lint`                | ESLint + `prettier --check`                                              |
| `npm run typecheck`           | `tsc --noEmit` per paket (web menjalankan `tsr generate` dulu)           |
| `npm run verify`              | lint + typecheck + test:coverage. **Wajib hijau sebelum task selesai**   |
| `npm run format`              | `prettier --write .`                                                     |
| `npm run generate -w @cc/web` | Membangkitkan `src/routeTree.gen.ts` (otomatis saat dev/build/typecheck) |
| `npm run fixtures [-- <dir>]` | Membuat empat repo git fixture (default `<tmp>/contract-check-fixtures`) |

## Variabel lingkungan

Dibaca dari `.env` di **root repo** (tidak di-commit), lalu ditimpa variabel proses. Semua divalidasi `packages/server/src/config.ts`; proses berhenti dengan pesan yang menyebut nama variabel bila ada yang salah. Contoh lengkap: `.env.example`.

| Variabel                  | Default             | Keterangan                                                                                                                                |
| ------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`       | — (opsional)        | Divalidasi saat panggilan Claude pertama, bukan saat start. Tidak pernah dicetak ke log atau pesan error, tidak diwariskan ke proses anak |
| `ANTHROPIC_MODEL`         | — (wajib)           | Nama model untuk discovery dan ekstraksi                                                                                                  |
| `PORT`                    | `4711`              | Host selalu `127.0.0.1`; tidak ada variabel untuk mengubahnya                                                                             |
| `WORKSPACE_DIR`           | `~/.contract-check` | Harus absolut atau diawali `~`                                                                                                            |
| `MAX_FILES_PER_CHECK`     | `40`                |                                                                                                                                           |
| `MAX_LLM_CALLS_PER_CHECK` | `40`                | Batas panggilan ekstraksi ke Claude per check; cache hit tidak dihitung, sisanya dilewati                                                 |
| `GIT_CONCURRENCY`         | `4`                 |                                                                                                                                           |
| `LLM_CONCURRENCY`         | `4`                 |                                                                                                                                           |
| `SPEC_CMD_TIMEOUT_MS`     | `180000`            |                                                                                                                                           |
| `OASDIFF_BIN`             | `oasdiff`           | Satu-satunya binary selain `git` yang boleh dijalankan                                                                                    |

## Workspace

Data aplikasi ada di `WORKSPACE_DIR`, tidak pernah di dalam repo user:

```
<WORKSPACE_DIR>/
├── app.db                      # SQLite (WAL), 4 tabel
├── contexts/projects/<slug>/<repo>.md   # profil discovery yang disetujui (<repo>.json = draf)
├── cache/specs/<repoId>/<sha>-<cmdhash>.json
├── cache/extract/<repoId>/<blob>-<pv>.json
└── runs/checks/<checkId>/      # artefak check + worktree sementara wt-<sha>/
```

## Struktur repo

```
packages/shared   skema zod + tipe (satu-satunya definisi kontrak API)
packages/server   Express 5, SQLite, git/oasdiff, runner
packages/web      Vite 6 + React 19 + TanStack Router/Query + Tailwind 4
fixtures/         generator repo git untuk test (make-fixtures.ts); isi repo di fixtures/repos/
docs/             README, RUNBOOK, HANDOFF, OPEN-QUESTIONS
```

## Keamanan

- Repo user **read-only**. `runCommand()` hanya mengizinkan subcommand git di allowlist (`fetch --prune`, `rev-parse`, `merge-base`, `show`, `grep`, `ls-tree`, `for-each-ref`, `symbolic-ref`, `diff`, `worktree add|remove|prune`).
- Server menolak request dengan header `Host` non-loopback dan, untuk method pengubah state, `Origin` non-loopback (pertahanan DNS rebinding/CSRF; API ini bisa menjalankan `spec_cmd`).
- `spec_cmd` hanya berjalan di dalam `runs/checks/` dan tanpa `ANTHROPIC_*` di lingkungannya.

## Halaman pengembang

- `/dev/tokens` — seluruh token desain Material 3 (warna, radius, font, skala teks).
- `/dev/ui` — setiap komponen dasar (`packages/web/src/components/ui/`) beserta variannya.
