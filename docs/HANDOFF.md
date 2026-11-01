# HANDOFF — Contract Check Tahap 1

Catatan untuk agent yang melanjutkan. Baca seluruhnya sebelum mulai; yang paling penting ada di bagian 1, 2, dan 5.

## 1. Status

| Hal              | Nilai                                                                                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sesi terakhir    | 2026-10-31                                                                                                                                                                                  |
| Selesai          | **CC-001, 002, 003, 004, 005, 006, 070, 071** (gelombang G1, ~24 jam setara manusia)                                                                                                        |
| Belum dikerjakan | Semua task lain (57 task). Mulai dari bagian 6                                                                                                                                              |
| `npm run verify` | Hijau. 13 file test, **322 test** (shared 8, server dan web sisanya)                                                                                                                        |
| `npm run build`  | Hijau; `npm start -w @cc/server` menyajikan web di `http://127.0.0.1:4711`                                                                                                                  |
| Node             | Lokal v24.16: `verify` 322 test hijau. Docker `node:20` (v20.20.2): `npm ci` + `verify` + `build` lolos dengan 314 test (8 test `shared` ditambahkan sesudahnya dan hanya dijalankan lokal) |
| Backlog          | 28 AC milik 8 task di atas sudah dicentang (Doc rev 23). Tidak ada perubahan lain di Doc                                                                                                    |
| Commit / PR      | **Belum ada.** Repo masih tanpa commit; pemilik repo yang commit manual                                                                                                                     |

Link dokumen sumber (Claude Docs): Backlog `https://claude.ai/artifact/9JhEHyYAfGbdEspd7yGmdi` (id `43418ba4-ee4d-48f2-bc4a-f1cfe8da3299`), Arsitektur `https://claude.ai/artifact/Wi1pbDYivJM7MkPeF8ctno` (id `f0930578-8d3d-418a-81f1-589fc8622f74`), Mockup v2 `https://claude.ai/artifact/WXBabwcVKiWBchD2sGfsHC` (artifact biasa, `list_files` / `read_file`).

## 2. Cara melanjutkan

1. `npm install`, salin `.env.example` ke `.env` dan isi dua variabel wajib (nilai apa saja cukup untuk dev tanpa Claude).
2. `npm run verify` harus hijau sebelum menyentuh apa pun.
3. Pilih task dari bagian 6, kerjakan sesuai kartu di backlog, **tulis test yang membuktikan tiap AC**, lalu `npm run verify`.
4. Centang AC di backlog hanya setelah terbukti (test otomatis atau dijalankan sungguhan). Cara mencentang ada di bagian 8.
5. Perbarui `docs/README.md` bila perintah atau variabel env berubah; perbarui file ini di akhir sesi.
6. Jangan commit atau membuat PR kecuali diminta. Konvensi backlog: pesan `CC-0xx: <judul task>`.

Aturan kerja backlog (10 butir) tetap berlaku. Yang sering terlupa: tanpa panggilan Claude di unit test, kontrak API hanya berubah lewat `packages/shared`, tanpa string UI hardcode di layar produk, tanpa tabel SQLite baru, angka konfigurasi dibaca dari `config.ts`.

## 3. Apa yang sudah ada

Saran pengelompokan commit (satu commit per task, path-based; CC-001 menyentuh tiga paket karena bootstrap):

| Task    | Isi dan file kunci                                                                                                                                                                                |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CC-001  | Root: `package.json`, `tsconfig.*.json`, `eslint.config.js`, `vitest.config.ts`, `.prettier*`, `.editorconfig`, `.gitattributes`, `.gitignore`, `.nvmrc`; kerangka `packages/{shared,server,web}` |
| CC-002  | `server/src/config.ts` (+test), `server/src/util/home.ts`, `.env.example`                                                                                                                         |
| CC-003  | `server/src/db/{schema.sql,database.ts,migrate.ts}` (+test), `shared/src/domain.ts`, `server/scripts/copy-assets.mjs`                                                                             |
| CC-004  | `server/src/workspace/{layout.ts,store.ts}` (+test), `server/test/fixtures/atomic-writer.ts`                                                                                                      |
| CC-005  | `server/src/http/*`, `server/src/{bootstrap.ts,index.ts,logger.ts}`, `shared/src/api.ts`, `shared/src/shared.test.ts`                                                                             |
| CC-006  | `server/src/proc/{run-command.ts,git-policy.ts,executable.ts,errors.ts}` (+test, termasuk `guardrails.test.ts` statis)                                                                            |
| CC-070  | `web/src/{main.tsx,router.ts,routes/*,components/PlaceholderScreen.tsx,lib/query-client.ts,routeTree.gen.ts}`, `web/tsr.config.json`, `web/vite.config.ts`                                        |
| CC-071  | `web/src/styles/globals.css`, `web/src/design/tokens.ts` (+test), `web/src/routes/dev.tokens.tsx` (+test)                                                                                         |
| Dokumen | `docs/README.md`, `docs/OPEN-QUESTIONS.md`, `docs/HANDOFF.md`, `package-lock.json`                                                                                                                |

Peta modul server yang berguna:

- `bootstrap.ts` `startApp(config, {logger, webDist?})`: siapkan workspace, buka `app.db`, migrasi, buat runner, `listen`. `AppContext` (`config, logger, db, workspace, runner`) adalah tempat menambah dependensi baru. **Pemulihan check (CC-063) harus disisipkan antara `migrate` dan `listen`.**
- `http/app.ts` `createApp({logger, webDist?, registerRoutes?})`: rute `/api` baru didaftarkan lewat `registerRoutes(api)`. Pakai `validated({body, query, params}, handler)` dari `http/validate.ts` (handler menerima input hasil parse zod) dan `HttpError(status, code, message, details)` untuk galat. Semua respons non-2xx berbentuk `{ error: { code, message, details } }`.
- `proc/run-command.ts` `createCommandRunner({oasdiffBin, shellRoot})`: satu-satunya pintu ke child process. Mengembalikan `{exitCode, stdout, stderr}` untuk exit code berapa pun; melempar error bertipe untuk tidak diizinkan, tidak ditemukan, timeout, abort, keluaran terlalu besar. `assertSuccess()` untuk yang menganggap exit != 0 sebagai gagal.
- `workspace/layout.ts` `WorkspaceLayout` (hanya menghitung path, selalu di dalam root) dan `workspace/store.ts` `WorkspaceStore` (I/O: tulis atomic, baca cache, hapus data project).
- `shared/src`: `domain.ts` (enum), `api.ts` (amplop galat, `ValidationDetails`, `HealthResponse`). **Skema per endpoint belum ada**, lihat G-2.

## 4. Keputusan yang saya ambil (dan penyimpangan dari backlog)

Yang butuh konfirmasi arsitek ada di `docs/OPEN-QUESTIONS.md`.

| #    | Keputusan                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D-1  | **Runtime**: `engines >=20`, `.nvmrc` 20, diuji di Node 20.20 dan 24. Node 20 sudah EOL, dan `better-sqlite3@13` / `execa@10` mewajibkan Node >= 22, jadi dipilih `better-sqlite3@12`, `execa@9`, `jsdom@26`. Jangan menaikkan mayor tanpa mengecek `engines` (Q-1).                                                                                                                                                                                                                                                                 |
| D-2  | **Versi**: TypeScript ~5.9, Vite **6.4 dipaksa tunggal lewat `overrides`** di root (tanpa itu vitest menarik Vite 8 dan tipe plugin bentrok), Vitest 4.1, ESLint 10, zod 4, Express 5.3, Tailwind 4, React 19.                                                                                                                                                                                                                                                                                                                       |
| D-3  | **`.env` hanya di root repo** (dibaca relatif terhadap lokasi modul, jadi tidak tergantung cwd). Dokumen arsitektur menggambar `.env` di dalam workspace, tetapi `WORKSPACE_DIR` sendiri ada di `.env`, jadi itu tidak mungkin. Prioritas: variabel proses > `.env`. `process.env` tidak dimutasi.                                                                                                                                                                                                                                   |
| D-4  | `ANTHROPIC_API_KEY` dan `ANTHROPIC_MODEL` wajib (Q-3). `PROMPT_VERSION` default `v1` (default ini saya tetapkan; CC-018/040 melipatnya dengan hash file prompt). `WORKSPACE_DIR` harus absolut atau diawali `~`; path relatif ditolak. Variabel `HOST` apa pun diabaikan.                                                                                                                                                                                                                                                            |
| D-5  | **Skema**: kolom `projects.slug` (UNIQUE) ditambahkan karena 409 bentrok-slug butuh constraint; id `INTEGER AUTOINCREMENT`; waktu ISO-8601 UTC `TEXT`; `profile_status` = `not_scanned, scanning, pending_review, approved, skipped`; `summary_json` / `snippet_json` dijaga `json_valid`; `findings.consumer_repo_id/file/line/confidence` nullable (finding `spec_stale` tingkat provider); versi skema di `PRAGMA user_version` (migrasi baru = entri baru di `loadMigrations()`, jangan edit yang lama). CASCADE pada repo: Q-2. |
| D-6  | **Cache** dikunci dengan **id repo**, bukan nama: `cache/specs/<repoId>/...`, `cache/extract/<repoId>/...` (nama repo bisa sama di dua project dengan path berbeda). `<pv>` untuk cache ekstraksi harus sudah aman sebagai nama file (hash/slug).                                                                                                                                                                                                                                                                                    |
| D-7  | Helper workspace **menolak** nama berbahaya (separator, `..`, karakter terlarang Windows) dengan `WorkspacePathError`, bukan menyanitasinya diam-diam. Konsekuensi: **CC-013 harus memvalidasi `name` repo** karena profil ditulis ke `<repo name>.md`.                                                                                                                                                                                                                                                                              |
| D-8  | **runCommand**: allowlist `git` + `OASDIFF_BIN`; subcommand git di-allowlist (bukan denylist) termasuk `diff` (Q-4); opsi berbahaya (`--upload-pack`, `--exec`, `-O`, `--output`) dan `-c` selain `core.quotepath` ditolak; env anak tanpa `ANTHROPIC_*`; git diberi `GIT_TERMINAL_PROMPT=0` dan `GIT_OPTIONAL_LOCKS=0`; `stdin` anak ditutup; shell hanya boleh dengan `cwd` di bawah `runs/checks/`; kill = SIGKILL ke seluruh group langsung (Windows: `taskkill /T /F`).                                                         |
| D-9  | Test group-kill memakai proses Node yang berjalan lama dan memunculkan cucu proses, **bukan** biner `sleep` (AC menyebut `sleep`), agar sama di Windows/macOS/Linux. Buktinya sama: induk dan cucu harus mati.                                                                                                                                                                                                                                                                                                                       |
| D-10 | **Penjaga loopback** (tambahan, tidak ada di backlog): `http/local-only.ts` menolak header `Host` non-loopback (DNS rebinding) dan `Origin` non-loopback untuk method pengubah state. Alasannya API ini akan bisa menyimpan `spec_cmd` yang dijalankan lewat shell. Port tidak dibatasi agar Vite (5173) lolos.                                                                                                                                                                                                                      |
| D-11 | `npm run dev -w @cc/server` memakai `node --watch --import tsx`, **bukan** `tsx watch`: di Windows `tsx watch` tidak pernah menjalankan server bila dijalankan di bawah `concurrently` (diam total, tanpa error). Jangan dikembalikan.                                                                                                                                                                                                                                                                                               |
| D-12 | **Tailwind 4 CSS-first**: token ada di `globals.css` blok `@theme static`, tidak ada `tailwind.config.ts` (backlog menyebutnya, itu gaya Tailwind 3). Palet bawaan dikosongkan (`--color-*: initial`), jadi `bg-red-500` dst. tidak ada. Token tambahan dari mockup yang tidak ada di daftar backlog: `#FFFFFF` (`surface-container-lowest`), `#E1E3E1` (`divider`), `#EDF1F8` (`neutral-container`), serta skala teks 28/16/14/12/13.                                                                                               |
| D-13 | `routeTree.gen.ts` **di-commit** dan dikecualikan dari lint/prettier; `typecheck` dan `build` web menjalankan `tsr generate` dulu.                                                                                                                                                                                                                                                                                                                                                                                                   |
| D-14 | `PlaceholderScreen` (CC-070) dan `__root.tsx` adalah kerangka sementara; teksnya sengaja identifier teknis. CC-073 menggantikan root, CC-076 dst. menggantikan layar. Halaman `/dev/*` dikecualikan dari aturan i18n (alat pengembang).                                                                                                                                                                                                                                                                                              |

## 5. Celah di backlog yang saya temukan

- **G-1 Dependensi melingkar CC-010 <-> CC-090.** AC pertama CC-010 berbunyi "unit test jalan di atas fixture repo (CC-090)", sedangkan CC-090 bergantung pada CC-010. Pemecahan yang saya sarankan: bangun kerangka `fixtures/make-fixtures.ts` yang hanya memakai perintah git biasa (`git init/add/commit`, boleh lewat `child_process` di test/skrip karena itu bukan kode `src`) sebagai bagian CC-010, lalu CC-090 melengkapi isinya (7 kasus finding, `spec_cmd`, dst.).
- **G-2 "Kontrak API beku di akhir M0" belum benar.** Tidak ada task M0 yang menulis skema zod per endpoint (`shared/src/api.ts` baru berisi amplop galat dan health). Frontend M5 yang butuh kontrak (CC-075, 076+) tidak bisa benar-benar paralel sebelum skema ditulis. Saran: tiap task endpoint (CC-012, 013, 014, 015, 019, 020, 060, 061, 064) menulis skemanya di `shared` lebih dulu, atau satu task kecil membekukan semuanya.
- **G-3 Aturan kerja #1 vs CC-036**: `git diff --name-only` tidak ada di daftar yang diizinkan (Q-4).
- **G-4 Pesan galat zod berbahasa Inggris.** `details.fields[].message` memakai pesan bawaan zod. UI berbahasa ID/EN (CC-074); putuskan di CC-012 apakah memakai locale zod `id` atau pesan kustom per skema.

## 6. Task berikutnya

Yang sudah tidak terblokir (semua dependensinya selesai): **CC-010** (lihat G-1), **CC-011**, **CC-012**, **CC-016**, **CC-034**, **CC-072**, **CC-075**. Urutan gelombang di backlog:

- **G2** (berikutnya): CC-010 – CC-015 (git adapter, path, API projects/repos, siap-check, refs/fetch) dan CC-072 – CC-075 (komponen M3, app shell, i18n, klien API+SSE).
  - CC-010 butuh git adapter di atas `runCommand`; ingat `git -C <repo>`, `maxBuffer` besar untuk `show`, dan `git status` repo fixture tidak boleh berubah.
  - CC-011 murni (tanpa git); `util/home.ts` `expandHome` sudah ada untuk dipakai ulang.
  - CC-012 pertama kali memakai `registerRoutes`, `validated`, dan `WorkspaceStore.removeProjectData` (butuh `checkIds` milik project dari DB). Slug: huruf kecil, spasi jadi `-`, simpan di `projects.slug`.
  - CC-013: validasi `name` repo (D-7), `UNIQUE(project_id, local_path)` sudah ada di skema (tangkap `SQLITE_CONSTRAINT_UNIQUE` -> 409).
- **G3**: CC-016 – CC-020, CC-090 dan layar CC-076 – CC-078. Seterusnya mengikuti tabel "Urutan eksekusi" di backlog.
- Pertanyaan terbuka untuk pemilik (lockfile FastAPI, `spec_cmd` kantor, versi `oasdiff`, model dan batas biaya) belum dijawab. Tidak memblokir sampai CC-031 / CC-034 / CC-041; sebelum mengerjakan ketiganya, tanyakan dulu, jangan menebak (aturan kerja #9).

## 7. Hal teknis yang menjebak

- **Windows**: `rename` yang menimpa file yang sedang dibuka proses lain gagal `EPERM`; `WorkspaceStore` mengulang sampai 10 kali. Biner yang hilang **tidak** dilaporkan sebagai `ENOENT` oleh execa di Windows (exit 1 + pesan cmd.exe sesuai bahasa OS), karena itu `proc/executable.ts` mencari di `PATH`/`PATHEXT` sendiri sebelum menjalankan.
- **Express 5**: callback `app.listen` menerima galat (mis. `EADDRINUSE`); `req.query` hanya-baca; handler async yang ditolak otomatis diteruskan ke error handler.
- **Vitest**: konfigurasi per paket (`projects`); server/web butuh `resolve.conditions: ['source']` agar `@cc/shared` terbaca dari sumber. Di env jsdom `import.meta.url` bukan URL `file:`; pakai `import.meta.dirname`. Jalankan satu paket: `npx vitest run --project server`.
- **`@cc/shared`** diekspor dengan kondisi `source` (dev/test/typecheck membaca `src`) dan `default` ke `dist` (runtime produksi). `npm run build` membangun `shared` lebih dulu; jangan mengubah urutannya.
- **Jangan menghentikan proses berdasarkan pola nama** (`vite`, `tsx`, `node`): milik proses lain bisa ikut. Hentikan lewat PID atau port yang Anda mulai sendiri. Proses uji yang ditinggalkan `timeout` di Git Bash tidak ikut mati.
- **`better-sqlite3`** native: npm 11 menampilkan peringatan `allow-scripts`, tetapi binding terpasang normal di mesin ini dan di Docker. Jika di mesin baru muncul "Could not locate the bindings file", jalankan `npm rebuild better-sqlite3`.
- Verifikasi Node 20 (dari root repo, Git Bash). Langkah yang sama (`npm ci` -> `verify` -> `build`, lewat skrip `sh` terpisah) sudah lolos dua kali di `node:20` v20.20.2, terakhir dengan 314 test. Bentuk satu baris di bawah ini **belum dijalankan persis begitu**, karena Docker Desktop berhenti di akhir sesi; jalankan sekali untuk memastikan:
  ```bash
  MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd -W):/src:ro" node:20 sh -c '
    mkdir /work && tar -C /src --exclude=node_modules --exclude=dist --exclude=.git -cf - . | tar -xf - -C /work
    cd /work && npm ci && npm run verify && npm run build'
  ```
- Docker: kontainer `amazing_curran` (`alpine/sqlite`) ternyata berstatus **Exited**, bukan berjalan. Belum dibutuhkan karena SQLite dipakai lewat `better-sqlite3` (tertanam). Hanya image `node:20` yang dipakai untuk verifikasi di atas.

## 8. Mencentang backlog (Claude Docs)

Hanya `attrs.checked` pada `listItem` yang diubah; teks tidak boleh disentuh. Dengan tool Claude Docs:

1. `read` Doc `43418ba4-ee4d-48f2-bc4a-f1cfe8da3299` -> tab body `4c17ae55-6c69`. Mulai sesi dengan `payload {"kind":"view","sinceRev":23}` untuk melihat apakah ada yang mengubah dokumen.
2. Ambil id `listItem` AC dengan `{"kind":"view","parentId":"<id list>"}` (atau `view` seluruh tab dan simpan ke file bila terlalu besar). Id berbentuk `mmz53254xvt.<angka>`.
3. `update` (`engine: "prose"`, `container: {"kind":"project","id":"43418ba4-..."}`), `payload.ops` berisi `{"op":"set","target":{"kind":"blocks","ids":["mmz53254xvt.8804"]},"attrs":{"checked":true}}`; banyak op dalam satu panggilan boleh.
4. Daftar "Tahap 1 disebut selesai bila ..." di akhir Doc dan bagian "Yang masih perlu jawaban Anda" **belum disentuh**.

Catatan: pengujian akses tulis di awal sesi mencentang lalu membatalkan satu item CC-001 (rev 21 -> 22), hash blok kembali identik; tidak ada sisa perubahan.
