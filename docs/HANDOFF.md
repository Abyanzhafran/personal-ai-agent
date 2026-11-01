# HANDOFF — Contract Check Tahap 1

Catatan untuk agent yang melanjutkan. Riwayat per task ada di `git log` dan kartu backlog; di sini hanya yang tidak terbaca dari kode.

## 1. Status

- **Sesi terakhir**: 2026-11-01.
- **Selesai**: CC-001–006, 070, 071 (G1); CC-090, 010–015, 072, 074 (G2). Sisa 48 task. CC-074: AC 1 (teks shell dari kamus) **belum dicentang**, hanya terbukti untuk nav sementara; centang saat CC-073 memasang breadcrumb dan header lewat `useT()`.
- **`npm run verify`**: hijau terakhir di CC-074 (28 file, 566 test).
- **Node**: lokal v24. Node 20 belum diuji ulang sejak CC-090 (terakhir lolos 314 test di Docker, lihat bagian 7).
- **Commit**: pemilik repo yang commit. Pesan Inggris `CC-0xx: <judul task>`, tanpa trailer `Co-Authored-By`. Cek `git status -sb` untuk yang belum di-push.
- **Backlog** (Claude Docs, rev 81): AC task selesai sudah dicentang. Baca ulang kartu sebelum mulai.
  - Backlog: `https://claude.ai/artifact/9JhEHyYAfGbdEspd7yGmdi` (id `43418ba4-ee4d-48f2-bc4a-f1cfe8da3299`)
  - Arsitektur: `https://claude.ai/artifact/Wi1pbDYivJM7MkPeF8ctno` (id `f0930578-8d3d-418a-81f1-589fc8622f74`)
  - Mockup v2: `https://claude.ai/artifact/WXBabwcVKiWBchD2sGfsHC` (artifact biasa, `list_files` / `read_file`)

## 2. Cara melanjutkan

1. `npm install`; salin `.env.example` ke `.env` dan isi `ANTHROPIC_MODEL` (nilai apa saja cukup tanpa Claude). `ANTHROPIC_API_KEY` boleh kosong sampai Claude dipanggil.
2. `npm run verify` harus hijau sebelum menyentuh apa pun.
3. Pilih task dari bagian 6, kerjakan sesuai kartu, **tulis test yang membuktikan tiap AC**, lalu `npm run verify`.
4. Centang AC di backlog hanya setelah terbukti (bagian 8).
5. Perbarui `docs/README.md` bila perintah atau env berubah, dan file ini di akhir sesi.
6. Jangan commit atau buat PR kecuali diminta.

Aturan kerja backlog (10 butir) tetap berlaku. Yang sering terlupa: tanpa panggilan Claude di unit test, kontrak API hanya berubah lewat `packages/shared`, tanpa string UI hardcode di layar produk, tanpa tabel SQLite baru, angka konfigurasi dari `config.ts`.

## 3. Peta kode

- `server/src/bootstrap.ts` `startApp(config, {logger, webDist?})`: siapkan workspace, buka `app.db`, migrasi, buat runner, `listen`. `AppContext` (`config, logger, db, workspace, runner, git`) adalah tempat menambah dependensi. **Pemulihan check (CC-063) disisipkan antara `migrate` dan `listen`.**
- `http/app.ts` `createApp({logger, webDist?, registerRoutes?})`. `registerRoutes` hanya menerima satu fungsi, jadi `bootstrap.ts` menggabungkan `[projectRoutes(ctx), repoRoutes(ctx)]`; fitur baru = satu entri di daftar itu. Pakai `validated({body, query, params}, handler)` dan `HttpError(status, code, message, details)`. Semua respons non-2xx berbentuk `{ error: { code, message, details } }`.
- `proc/run-command.ts` `createCommandRunner`: satu-satunya pintu ke child process. Mengembalikan `{exitCode, stdout, stderr}` untuk exit code apa pun; melempar error bertipe untuk tidak diizinkan, tidak ditemukan, timeout, abort, keluaran terlalu besar. `assertSuccess()` bila exit != 0 berarti gagal.
- `git/adapter.ts` `createGitAdapter(runner)` (= `AppContext.git`): operasi git read-only sebagai nilai bertipe, error di `git/errors.ts`. `git/paths.ts` `normalizeLocalPath`.
- `projects/` dan `repos/` adalah pola fitur untuk ditiru: skema + pesan galat Indonesia di `shared/src/<fitur>.ts`, SQL di `<fitur>/repository.ts` (query baru ke sini, bukan ke rute), rute di `<fitur>/routes.ts` berbentuk `(deps) => (api: Router) => void`. Test: `createApp` + `supertest` + DB `:memory:` + workspace di folder sementara. `bootstrap.test.ts` membuktikan rute terpasang dan data bertahan setelah restart.
- `workspace/layout.ts` hanya menghitung path (selalu di dalam root); `workspace/store.ts` melakukan I/O (tulis atomic, baca cache, hapus data project/repo).
- `shared/src`: `domain.ts` (enum), `api.ts` (amplop galat, `ERROR_CODES`, `ValidationDetails`, health), `projects.ts`, `repos.ts`. Skema endpoint lain belum ada (G-2).
- `fixtures/make-fixtures.ts` `makeFixtures(dir)` → `{root, repos}`; tiap repo `{name, role, path, remote, defaultBranch, specPath?, specCmd?, commits}` (`path` = nilai `local_path` untuk mendaftarkan repo). Test server mengimpornya dari `../../../../fixtures/make-fixtures.js` tanpa konfigurasi tambahan. Satu generasi ~2,5 dtk di Windows: bangkitkan sekali per berkas test (`beforeAll`, timeout 120 dtk). Pola `git/adapter.test.ts`: snapshot `status`/`HEAD`/branch semua repo di awal, bandingkan di `afterAll` (bukti read-only).
- `web/src/components/ui/` (CC-072) + `/dev/ui` yang memperagakan semuanya. Gabung kelas lewat `cn()` dari `lib/cn.ts`. Test: `components/ui/ui.test.tsx`, `routes/dev.ui.test.tsx`.
- `lib/i18n.ts` (CC-074): semua teks UI lewat `const t = useT(); t('nav.checks')`, kunci datar dari `locales/id.ts`. Bahasa baru = `const en: Messages` + satu baris di `i18n.ts`, komponen tidak berubah.

## 4. Keputusan yang masih mengikat

Yang butuh konfirmasi arsitek ada di `docs/OPEN-QUESTIONS.md`. D-9 digabung ke D-8.

**Toolchain**

- **D-1 Runtime**: `engines >=20`, `.nvmrc` 20; diuji di Node 20.20 dan 24. `better-sqlite3@13` / `execa@10` butuh Node >= 22, jadi dipakai `better-sqlite3@12`, `execa@9`, `jsdom@26`. Jangan naikkan mayor tanpa cek `engines` (Q-1).
- **D-2 Versi**: TypeScript ~5.9, Vitest 4.1, ESLint 10, zod 4, Express 5.3, Tailwind 4, React 19. **Vite 6.4 dipaksa tunggal lewat `overrides` di root** (tanpa itu vitest menarik Vite 8 dan tipe plugin bentrok).
- **D-3** `.env` hanya di root repo, dibaca relatif terhadap lokasi modul (bukan cwd). Variabel proses > `.env`; `process.env` tidak dimutasi. Dokumen arsitektur menggambar `.env` di workspace, tetapi `WORKSPACE_DIR` sendiri ada di `.env`.
- **D-4 Env**: `ANTHROPIC_MODEL` wajib (Q-3). `ANTHROPIC_API_KEY` opsional saat start, divalidasi `requireAnthropicApiKey()` sebelum panggilan Claude pertama (R2) supaya `verify`, CC-092, dan e2e CC-093 jalan tanpa key. `PROMPT_VERSION` tidak ada di env (hash isi file prompt, CC-018/040). `WORKSPACE_DIR` absolut atau diawali `~`. `HOST` diabaikan.
- **D-11** `npm run dev -w @cc/server` memakai `node --watch --import tsx`, **bukan** `tsx watch`: di Windows di bawah `concurrently` server tidak pernah jalan, tanpa error. Jangan dikembalikan.
- **D-13** `routeTree.gen.ts` di-commit dan dikecualikan dari lint/prettier; `typecheck` dan `build` web menjalankan `tsr generate` dulu.

**Server**

- **D-5 Skema**: `projects.slug` UNIQUE, `UNIQUE(project_id, name)`, `profile_status` = `not_scanned, pending_review, approved`. `findings.consumer_repo_id/file/line/confidence` nullable (finding `spec_stale` tingkat provider). Versi di `PRAGMA user_version`: migrasi baru = entri baru di `loadMigrations()`, **jangan edit yang lama**. `app.db` dev lama dari sebelum R1 harus dihapus (`<WORKSPACE_DIR>/app.db*`). CASCADE pada repo: Q-2.
- **D-6 Cache** dikunci dengan **id repo** (`cache/specs/<repoId>/...`, `cache/extract/<repoId>/...`), bukan nama: nama repo bisa sama di dua project. `<pv>` untuk cache ekstraksi harus sudah aman sebagai nama file.
- **D-7** Helper workspace **menolak** nama berbahaya (separator, `..`, karakter terlarang Windows) dengan `WorkspacePathError`, tidak menyanitasi. Jadi `repos.name` divalidasi di CC-013 (profil ditulis ke `<name>.md`).
- **D-8 runCommand**: allowlist `git` + `OASDIFF_BIN`; subcommand git di-allowlist termasuk `diff` (Q-4); opsi berbahaya dan `-c` selain `core.quotepath` ditolak; env anak tanpa `ANTHROPIC_*`; shell hanya dengan `cwd` di bawah `runs/checks/`; kill = seluruh process group. Dijaga `guardrails.test.ts`. Test group-kill memakai proses Node, bukan `sleep` (AC), agar sama di tiga OS.
- **D-10 Penjaga loopback** (tambahan): `http/local-only.ts` menolak `Host` non-loopback (DNS rebinding) dan `Origin` non-loopback untuk method pengubah state, karena API akan menyimpan `spec_cmd` yang dijalankan lewat shell. Port tidak dibatasi (Vite 5173).
- **D-19 Adapter git**: tiap fungsi menerima path repo sebagai argumen pertama (`git -C`). Ref berawalan `-` ditolak sebagai `RefNotFoundError`. Exit 128 ambigu (ref hilang atau repo rusak), jadi saat gagal adapter memeriksa ref dulu. `show` pada path hilang → `PathNotFoundError` (CC-030 perlu membedakannya dari ref salah). Timeout dan `maxBuffer` adalah konstanta di `adapter.ts`, bukan `config.ts`.
- **D-20 `normalizeLocalPath`**: trim, `expandHome`, tolak non-absolut, `fs.realpath`, tolak bila bukan folder; tidak pernah menghitung dari cwd. Penolakan = `LocalPathError` (`local_path_*`). Tanda kutip di ujung path dibuang di rute (D-22), bukan di fungsi ini.
- **D-21 API projects** (pola untuk endpoint berikutnya): skema di `shared` dengan **pesan galat kustom Indonesia per isian**, bukan locale zod. Slug tidak pernah berubah (PATCH hanya `name`, `description`). Slug bentrok → 409 `project_slug_taken` dengan `details: { slug }`. DELETE menghapus berkas dulu, baru baris DB (cascade), supaya bisa diulang bila gagal di tengah.
- **D-22 API repos**: `PATCH /api/repos/:id` hanya `role`, `default_branch`, `spec_path`, `spec_cmd` (field lain dibuang diam-diam). Urutan POST: project ada → `normalizeLocalPath` → `name` aman (D-7) → `rev-parse` → branch → cek bentrok + INSERT sinkron (tanpa `await` di antaranya, jadi tidak ada balapan). Galat yang menunjuk satu isian, termasuk 409, membawa `details.fields` (`ValidationDetails`). **Bentrok nama tanpa membedakan huruf besar-kecil** (`COLLATE NOCASE` di pre-check, bukan di skema), karena `API.md` dan `api.md` adalah berkas yang sama di Windows dan macOS. DELETE menghapus berkas dulu (profil, cache, `runs/checks/<id>`), baru baris DB.
- **D-23 Siap check** (CC-014): hanya `GET /api/projects/:id` mengembalikan `ProjectDetail` (`Project` + `ready_for_check` + `not_ready_reason`). Aturan `projectReadiness(roles)`: ≥1 `service` dan `service + microfrontend` ≥ 2; e2e tidak dihitung. Kalimat alasan berbahasa Indonesia dari server; bila EN dipakai kelak, ubah jadi kode + terjemahan di web (itu mengubah kontrak). `GET` daftar repo per project belum ada; CC-076/077 yang menentukan bentuknya.
- **D-24 Ref dan fetch** (CC-015): `POST /api/projects/:id/fetch` mencakup **semua repo termasuk e2e**. Logika di `repos/fetch.ts` `createProjectFetcher({db, git, concurrency})` karena CC-065 memakainya sebagai langkah 1 check: tidak pernah melempar karena kegagalan satu repo (consumer gagal → lanjut, provider gagal → check failed). `last_fetch_at` hanya ditulis bila berhasil. Paralel lewat `util/concurrency.ts` `mapLimit` (pakai ulang untuk `LLM_CONCURRENCY`, CC-017/040). `GET /api/repos/:id/refs`: branch `origin` dulu (default paling atas), lalu tag; tag beranotasi dikupas ke commit-nya. Tanpa `--tags`; folder repo yang hilang → 409 `repo_not_git`.

**Web**

- **D-12 Tailwind 4 CSS-first**: token di `globals.css` blok `@theme static`; tidak ada `tailwind.config.ts` (backlog menyebutnya, itu gaya Tailwind 3). Palet bawaan dikosongkan (`--color-*: initial`), jadi `bg-red-500` dst. tidak ada.
- **D-14** `PlaceholderScreen` dan `__root.tsx` sementara; CC-073 menggantikan root, CC-076+ layar. Halaman `/dev/*` dikecualikan dari aturan i18n.
- **D-25 Komponen UI** (CC-072): "shadcn" dibaca sebagai pola, bukan CLI. Komponen tulis tangan dengan Radix + `class-variance-authority` + `cn()`; `twMerge` polos membuang `text-on-surface`, jadi skala `text-body/label/title/headline/code` didaftarkan di `lib/cn.ts`. Select = `<select>` native. `SeverityChip` memakai kosakata domain `@cc/shared` (`break, warn, info, clean, spec_stale, cancelled, failed`); teks lewat `children`. Fokus keyboard = **satu aturan global** di `globals.css`. "Tanpa teks" dijaga test (render kosong → `body.textContent === ''`); satu pengecualian: sonner menambah `alt+T` ke `aria-label`, jadi `Toaster` mewajibkan `containerAriaLabel`. Angka mockup hanya untuk Button, field, chip, progress, NavRail, dialog; Tabs, Checkbox, Table, Toast mengikuti pola M3 terdekat, jadi periksa saat CC-076+ memakainya. `<Toaster>` baru dipasang di `/dev/ui`; CC-073 harus memasangnya di akar.
- **D-26 i18n** (CC-074): satu bahasa (ID), tanpa library dan tanpa provider. `t(key)` belum mendukung `{param}`; task pertama yang butuh menambah `t(key, vars?)` di `i18n.ts` (kompatibel mundur). Nav sementara di `__root.tsx` dipasang ke kamus dengan **teks tampil yang sama** (`projects`, `checks`, `panduan`) agar `router.test.tsx` tidak berubah; teks akhir milik CC-073 (mockup: `Projects`, `Checks`, `aria-label` `Navigasi utama`, tanpa tombol bahasa).

**Fixture** (CC-090)

- **D-15** Default `<os.tmpdir()>/contract-check-fixtures` atau `npm run fixtures -- <dir>`; tidak pernah di dalam repo ini. Generator hanya menghapus folder yang berisi penanda `.contract-check-fixtures`. Entri `.fixtures/` di `.gitignore`, `eslint.config.js`, `.prettierignore` tidak dipakai; boleh dihapus.
- **D-16** `spec_cmd` fixture = `node scripts/export-openapi.mjs` (bukan Python) agar test tidak butuh Python/Go. svc-order tetap Python (FastAPI), svc-payment tetap Go. Skrip menulis `openapi.json` dengan format sengaja beda dari berkas ter-commit supaya CC-036 benar-benar menormalkan.
- **D-17** Bentuk fixture dikunci test: hop 1 (`git grep -F orders`) menemukan 4 berkas di mfe-dashboard dan 1 di svc-payment; `OrdersPage.tsx` hanya lewat simbol `useOrders` (hop 2); enam jangkar baris laporan #128. Mengedit template berarti menjaga nomor baris itu. Head svc-order menambah `limit` opsional untuk heuristik CC-047.
- **D-18** SHA stabil: env git dibersihkan dari `GIT_*`, config global kosong, author dan tanggal tetap, `core.autocrlf=false`. Pakai `gitEnv`/`git()` di `make-fixtures.ts` untuk apa pun yang menulis. Kestabilan lintas-OS **belum diverifikasi**.

## 5. Celah di backlog

G-1, G-3, G-4 sudah selesai.

- **G-2 "Kontrak API beku di akhir M0" belum benar.** `shared/src/api.ts` baru berisi amplop galat dan health; skema endpoint ditulis per task endpoint (CC-012–015 sudah). Frontend M5 (CC-075, 076+) bergantung pada skema CC-019, 020, 060, 061, 064 yang belum ada. Saran: tiap task endpoint menulis skemanya di `shared` lebih dulu.
- **G-5 CC-037 vs laporan #128.** AC "tiga file consumer fixture ditemukan", sedangkan enam finding #128 butuh lima file hop 1 plus satu hop 2. Mockup menyebut 11 file kandidat di 3 repo (laporan 12 file); fixture hanya punya 2 repo consumer. Fixture mengikuti laporan. Angka di CC-037, CC-091, dan golden "Salin ringkasan" perlu diselaraskan arsitek atau dihitung ulang dari fixture.
- **G-6 "5 perubahan breaking di 3 endpoint"** (CC-035, mockup) tidak cocok dengan tujuh kasus CC-090: penghapusan `cancel` adalah endpoint keempat, dan `quantity` integer → number breaking atau info belum bisa dicek (`oasdiff` belum terpasang). Fixture mengikuti tujuh kasus; golden CC-035 yang menentukan, bila beda ubah `specs.ts` atau teks AC.
- **G-7 DELETE project/repo belum menolak saat check berjalan.** CC-060 (registry job aktif) harus menambah 409 pada `DELETE /api/projects/:id` bila ada check `running`, dan pada `DELETE /api/repos/:id` bila repo itu provider/konsumen check `running`; kalau tidak, worktree terhapus di bawah check yang jalan.
- **G-8 Nama reservasi Windows** (`Con`, `Nul`, `Aux`, `Com1`, dst.) lolos `slugify`, `assertSafeSegment`, dan CC-013 (`repos.name`) tetapi tidak bisa jadi folder atau `<name>.md` di Windows. Ketahuan saat profil pertama ditulis (CC-020).

## 6. Task berikutnya

Tidak terblokir: **CC-016**, **CC-034**, **CC-073**, **CC-075**.

- **G2** sisa: CC-073, CC-075 (app shell, klien API+SSE). Urutan yang masuk akal: CC-073, lalu CC-075.
- **G3**: CC-016–020 dan layar CC-076–078. Seterusnya ikuti tabel "Urutan eksekusi" di backlog.
- Pertanyaan terbuka untuk pemilik (lockfile FastAPI, `spec_cmd` kantor, versi `oasdiff`, model dan batas biaya) belum dijawab. Tidak memblokir sampai CC-031 / CC-034 / CC-041; sebelum mengerjakan ketiganya, tanyakan dulu, jangan menebak (aturan kerja #9).

## 7. Hal teknis yang menjebak

- **Windows**: `rename` yang menimpa file yang dibuka proses lain gagal `EPERM`; `WorkspaceStore` mengulang sampai 10 kali. execa tidak melaporkan biner hilang sebagai `ENOENT` (exit 1 + pesan cmd.exe sesuai bahasa OS), jadi `proc/executable.ts` mencari di `PATH`/`PATHEXT` sendiri. Objek git read-only: hapus folder fixture dengan `fs.rm(..., {recursive, force, maxRetries})`.
- **Express 5**: callback `app.listen` menerima galat (mis. `EADDRINUSE`); `req.query` hanya-baca; handler async yang ditolak otomatis diteruskan ke error handler.
- **Vitest**: konfigurasi per paket (`projects`); server/web butuh `resolve.conditions: ['source']` agar `@cc/shared` terbaca dari sumber. Di jsdom `import.meta.url` bukan URL `file:`; pakai `import.meta.dirname`. Satu paket: `npx vitest run --project server`.
- **`@cc/shared`** diekspor dengan kondisi `source` (dev/test/typecheck) dan `default` ke `dist` (runtime produksi). `npm run build` membangun `shared` lebih dulu; jangan ubah urutannya.
- **Tailwind di jsdom**: test hanya membuktikan nama kelas, bukan hasilnya. Bukti kelas terbit ada di keluaran `vite build` (cek dengan skrip Node pada berkas CSS; `grep` dengan escape `\[` mudah salah). Tampilan `/dev/ui` **belum dinilai dengan mata** di sesi CC-072.
- **Jangan hentikan proses berdasarkan nama** (`vite`, `tsx`, `node`): milik proses lain bisa ikut. Pakai PID atau port yang Anda mulai sendiri. Proses sisa `timeout` di Git Bash tidak ikut mati.
- **`guardrails.test.ts` memindai teks**: kata polos `commit` (juga dalam backtick di komentar) di berkas yang memanggil git ditandai sebagai perintah penulis. Tulis ulang redaksinya; jangan longgarkan guardrail.
- **`better-sqlite3`**: bila muncul "Could not locate the bindings file", jalankan `npm rebuild better-sqlite3`.
- **Mesin dev** punya Python 3.12 dan Go 1.24 (bukan syarat; test tidak memakainya), tanpa `oasdiff`.
- **Verifikasi Node 20** (dari root repo, Git Bash). Langkah yang sama (`npm ci` → `verify` → `build`, lewat skrip `sh` terpisah) sudah lolos dua kali di `node:20` v20.20.2. Bentuk satu baris ini **belum dijalankan persis begitu**; jalankan sekali untuk memastikan:
  ```bash
  MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd -W):/src:ro" node:20 sh -c '
    mkdir /work && tar -C /src --exclude=node_modules --exclude=dist --exclude=.git -cf - . | tar -xf - -C /work
    cd /work && npm ci && npm run verify && npm run build'
  ```

## 8. Mencentang backlog (Claude Docs)

Hanya `attrs.checked` pada `listItem` yang diubah; teks tidak boleh disentuh.

1. `read` Doc `43418ba4-ee4d-48f2-bc4a-f1cfe8da3299` → tab body `4c17ae55-6c69`. Awali sesi dengan `{"kind":"view","sinceRev":81}` untuk melihat apakah ada yang mengubah dokumen.
2. **Jangan `view` seluruh tab**: di rev 79 (307 blok) panggilan itu time-out 300 dtk. Cari kartu dengan `{"kind":"search","text":"CC-0xx"}`, lalu `{"kind":"search","text":"dep: CC-0yy"}` untuk paragraf estimasi; daftar AC adalah `list kind=check` tepat setelah paragraf deskripsi, baca dengan `{"kind":"view","parentId":"<id list>"}`. Id `listItem` berbentuk `mmz53254xvt.<angka>`.
3. `update` (`engine: "prose"`, `container: {"kind":"project","id":"43418ba4-..."}`) dengan `payload.ops` berisi `{"op":"set","target":{"kind":"blocks","ids":["mmz53254xvt.8804"]},"attrs":{"checked":true}}`; banyak op dalam satu panggilan boleh.
4. Daftar "Tahap 1 disebut selesai bila ..." di akhir Doc dan bagian "Yang masih perlu jawaban Anda" **belum disentuh**.
