# Runbook

Panduan saat ada yang tidak jalan. Dijaga test (`packages/server/src/docs.test.ts`): tiap kode galat API punya satu baris di tabel, tiap kelas galat bertipe punya satu judul, dan tiap perintah `npm run ...` di sini ada di `package.json`. Pengaturan awal ada di [README.md](./README.md).

Log server tercetak di konsol tempat `npm run dev` berjalan. Penyebab galat yang tidak dikenali hampir selalu ada di sana.

## Masalah umum

### oasdiff tidak ada atau terlalu lama

- **Gejala**: "Jalankan check" ditolak dengan pesan yang menyebut `oasdiff` (kode `oasdiff_unavailable`). Server tetap hidup dan mencatat peringatan saat start; hanya check yang ditolak.
- **Cek**: `oasdiff --version`. Versi minimum `1.11.0` (angka dari README; belum dicocokkan dengan binary asli, lihat `OPEN-QUESTIONS.md`).
- **Tindakan**: pasang atau perbarui `oasdiff` (cara di README), pastikan ada di `PATH`, atau isi `OASDIFF_BIN` di `.env` dengan path penuh. Lalu **restart server**: hasil cek disimpan selama proses hidup.

### spec_cmd melewati batas waktu

- **Gejala**: check Gagal dengan pesan "Perintah melewati batas waktu 180000 ms: ..." diikuti `spec_cmd` repo provider.
- **Penyebab**: generator spec lambat (instal dependensi, kompilasi) atau menunggu masukan.
- **Tindakan**: jalankan `spec_cmd` yang sama sendiri di folder repo dan lihat berapa lama. Bila memang lama, naikkan `SPEC_CMD_TIMEOUT_MS` di `.env` lalu restart server. Perintah dijalankan di worktree sementara `runs/checks/<id>/wt-<sha>/` tanpa variabel `ANTHROPIC_*`. Hasil yang sukses disimpan per (repo, SHA, perintah), jadi percobaan berikutnya cepat.

### Repo provider tanpa lockfile

- **Gejala**: `spec_unpinned` bernilai `true` di `summary_json` check (kolom di tabel `checks` pada `app.db`; belum ditampilkan di layar laporan). Artinya spec dihasilkan tanpa lockfile ter-commit, jadi hasilnya bisa berbeda antar waktu.
- **Terkunci** berarti di akar repo ada salah satu `uv.lock`, `poetry.lock`, `go.sum`, `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, atau `requirements.txt` yang setiap barisnya (selain komentar) memuat `==`.
- **Tindakan**: commit lockfile. Versi tool yang dipakai tercatat di `summary_json.tool_versions`.

### Check nyangkut setelah server mati

- **Gejala**: check berstatus Berjalan padahal server sudah mati.
- **Yang terjadi sendiri**: saat server start, semua check Berjalan diubah menjadi Gagal dengan alasan "server berhenti saat check berjalan", folder `wt-*` di `runs/checks/` dihapus, dan `git worktree prune` dijalankan di repo provider yang tersentuh. Folder repo yang hilang hanya menghasilkan peringatan di log.
- **Tindakan**: start ulang server, lalu "Jalankan ulang" di laporan. Bila `git worktree list` di repo provider masih menampilkan `wt-*`, jalankan `git worktree prune` di sana.

### Membaca artefak sebuah check

Semua ada di `<WORKSPACE_DIR>/runs/checks/<id>/` (`WORKSPACE_DIR` default `~/.contract-check`):

| Berkas                         | Isi                                                               |
| ------------------------------ | ----------------------------------------------------------------- |
| `spec-base.json`               | Spec provider di base (Swagger 2 sudah dikonversi ke OpenAPI 3)   |
| `spec-head.json`               | Spec provider di head                                             |
| `changelog.json`               | Keluaran `oasdiff` apa adanya: dasar daftar endpoint yang berubah |
| `extract/<repoId>-<hash>.json` | Hasil ekstraksi Claude per berkas consumer yang dipakai check ini |

Diff dapat dijalankan ulang dengan `oasdiff changelog spec-base.json spec-head.json`. Cache lintas check ada di `cache/specs/<repoId>/` dan `cache/extract/<repoId>/`; menghapus berkas di sana aman (dihitung ulang pada check berikutnya).

## Kode galat API

Semua respons non-2xx dari `/api` berbentuk `{ "error": { "code", "message", "details" } }`. UI menampilkan `message` sebagai pemberitahuan, atau di isian yang bersangkutan bila `details.fields` ada.

| Kode                       | Penyebab                                                                    | Tindakan                                                                                                  |
| -------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `validation_failed`        | Isian request tidak lolos validasi; `details.fields` menyebut isiannya      | Perbaiki isian yang ditandai                                                                              |
| `invalid_json`             | Body request bukan JSON yang sah (hanya bila API dipanggil langsung)        | Kirim JSON yang sah                                                                                       |
| `payload_too_large`        | Body request melewati batas ukuran server                                   | Perkecil isi yang dikirim                                                                                 |
| `not_found`                | Rute atau metode `/api/...` tidak ada                                       | Periksa URL; dari UI berarti web dan server beda versi, jalankan `npm run build` ulang                    |
| `forbidden_host`           | Header `Host` bukan loopback (pertahanan DNS rebinding)                     | Buka lewat `127.0.0.1` atau `localhost`, bukan nama host lain                                             |
| `forbidden_origin`         | `Origin` bukan loopback pada request pengubah data                          | Buka UI dari `http://127.0.0.1:...` atau `http://localhost:...`                                           |
| `web_not_built`            | Hasil build web (`packages/web/dist`) tidak ditemukan                       | Jalankan `npm run build`, atau pakai `npm run dev`                                                        |
| `internal_error`           | Galat tak terduga di server                                                 | Lihat log server; sertakan potongan lognya saat melapor                                                   |
| `project_not_found`        | Id project tidak ada (mungkin sudah dihapus)                                | Muat ulang halaman                                                                                        |
| `project_slug_taken`       | Nama menghasilkan slug yang sudah dipakai project lain (`details.slug`)     | Pakai nama lain                                                                                           |
| `repo_not_found`           | Id repo tidak ada                                                           | Muat ulang halaman                                                                                        |
| `repo_not_git`             | Folder bukan repo git, atau folder repo hilang                              | Periksa path; `git rev-parse --is-inside-work-tree` harus mencetak `true`                                 |
| `branch_not_found`         | `origin/<default_branch>` tidak ada                                         | Jalankan `git fetch` di repo itu atau isi default branch yang benar                                       |
| `repo_path_taken`          | Path itu sudah terdaftar di project yang sama                               | Buka repo yang sudah ada                                                                                  |
| `repo_name_taken`          | Nama repo sudah dipakai repo lain di project (huruf besar-kecil sama saja)  | Pakai nama lain                                                                                           |
| `local_path_empty`         | Path lokal kosong                                                           | Isi path folder repo                                                                                      |
| `local_path_not_absolute`  | Path bukan path absolut                                                     | Tulis path lengkap (diawali `/` atau huruf drive)                                                         |
| `local_path_missing`       | Folder pada path itu tidak ada                                              | Periksa ejaan path                                                                                        |
| `local_path_not_directory` | Path menunjuk berkas, bukan folder                                          | Tunjuk folder repo                                                                                        |
| `discovery_in_progress`    | Discovery repo ini sedang berjalan                                          | Tunggu sampai status "Sedang dipindai" selesai                                                            |
| `discovery_not_applicable` | Repo e2e tidak pernah dipindai                                              | Tidak perlu tindakan                                                                                      |
| `profile_not_ready`        | Profil disimpan sebelum ada draf discovery                                  | Jalankan discovery dulu (butuh `ANTHROPIC_API_KEY`) dan tunggu selesai                                    |
| `check_already_running`    | Project sudah punya check berjalan (`details.check_id`)                     | Tunggu atau batalkan check itu; UI otomatis membukanya                                                    |
| `check_in_progress`        | Project atau repo dihapus selagi check memakainya                           | Batalkan atau tunggu check selesai, lalu hapus                                                            |
| `oasdiff_unavailable`      | `oasdiff` tidak ada, terlalu lama, atau versinya tak terbaca                | Lihat "oasdiff tidak ada atau terlalu lama"                                                               |
| `check_not_found`          | Id check tidak ada                                                          | Buka dari daftar Checks                                                                                   |
| `check_not_running`        | Membatalkan check yang sudah selesai atau tidak berjalan                    | Muat ulang; statusnya sudah final                                                                         |
| `ref_not_found`            | Branch, tag, atau SHA tidak ada, atau riwayat base dan head tak berhubungan | Jalankan "Fetch sekarang", periksa ejaan; branch lokal tidak dipakai, hanya `origin/<ref>`, tag, atau SHA |

## Galat bertipe

Galat ini muncul sebagai alasan di layar check Gagal (kolom `checks.error`), sebagai pesan `message` API, atau di log server. Kelas dasar (`CommandError`, `GitError`) tidak punya entri sendiri.

### CheckAlreadyRunningError

Memulai check saat project sudah punya check berjalan. Dipetakan ke `check_already_running`. Satu check per project: tunggu atau batalkan yang berjalan.

### CheckFailure

Penyebab Gagal yang sudah dijelaskan ke pengguna; pesannya langsung menjadi alasan di layar. Contoh: "Repo X belum punya spec_path. Isi spec_path di pengaturan repo, lalu ulangi check." Ikuti petunjuk di pesan itu.

### CheckNotRunningError

Membatalkan check yang tidak sedang berjalan. Dipetakan ke `check_not_running`.

### CommandAbortedError

Perintah dihentikan karena check dibatalkan atau server berhenti. Bukan kerusakan: check berstatus Dibatalkan.

### CommandFailedError

Perintah (biasanya `git`) keluar dengan kode bukan nol. Pesannya memuat 20 baris terakhir stderr; jalankan perintah yang sama sendiri di folder repo untuk melihat penyebabnya.

### CommandNotAllowedError

Perintah di luar allowlist (binary selain `git` dan `OASDIFF_BIN`, subcommand git terlarang, atau shell di luar `runs/checks/`). Perintah tidak pernah dijalankan; ini bug di aplikasi, laporkan dengan pesannya.

### CommandNotFoundError

Binary tidak ada di `PATH`: `git`, `oasdiff`, atau tool yang dipanggil `spec_cmd`. Pasang tool itu atau perbaiki `PATH` (untuk `oasdiff`: `OASDIFF_BIN`), lalu restart server.

### CommandOutputTooLargeError

Keluaran sebuah perintah melewati batas buffer, biasanya pencarian `git grep` yang terlalu umum atau `spec_cmd` yang mencetak berlebihan. Persempit pola atau kurangi keluaran perintah.

### CommandTimeoutError

Perintah melewati batas waktu. Untuk `spec_cmd`, lihat "spec_cmd melewati batas waktu".

### ConfigError

`.env` atau variabel lingkungan salah; server berhenti saat start dengan daftar "variabel: masalah". Perbaiki variabel yang disebut (tabel di README) lalu jalankan ulang.

### LlmSchemaError

Claude membalas JSON yang tidak sesuai skema, juga setelah satu giliran perbaikan. Discovery ditandai gagal (pesan di profil repo) atau satu berkas dilewati saat ekstraksi. Ulangi; bila terus berulang, periksa `ANTHROPIC_MODEL` (model baru kadang menolak parameter tertentu) dan log server.

### LocalPathError

Path repo yang diketik tidak bisa dipakai. Kodenya `local_path_empty`, `local_path_not_absolute`, `local_path_missing`, atau `local_path_not_directory`; tindakannya ada di tabel kode galat API.

### OasdiffOutputError

Keluaran JSON `oasdiff` tidak bisa dibaca, biasanya karena versi yang bentuk keluarannya berbeda. Cek `oasdiff --version` (minimum `1.11.0`) dan jalankan `oasdiff changelog` pada `spec-base.json` dan `spec-head.json` untuk melihat keluarannya.

### OasdiffUnavailableError

`oasdiff` tidak bisa dipakai. Alasannya `missing` (tidak ditemukan), `too_old` (di bawah versi minimum, pesan menyebut versinya), atau `unreadable` (versi tidak bisa dibaca). Dipetakan ke `oasdiff_unavailable`; lihat "oasdiff tidak ada atau terlalu lama".

### PathNotFoundError

Ref ada, tetapi berkasnya tidak ada di commit itu (mis. `spec_path`). Periksa `spec_path` repo dan ref yang dipilih.

### RefNotFoundError

Branch, tag, atau SHA tidak ada di repo. Dipetakan ke `ref_not_found`; lihat tindakannya di tabel.

### SpecConvertError

Spec Swagger 2 tidak bisa dikonversi ke OpenAPI 3. Pesannya menyebut masalahnya; perbaiki spec (konverter tidak memperbaiki diam-diam).

### SpecGenError

`spec_cmd` keluar dengan kode bukan nol. Pesannya memuat perintah, SHA, dan 20 baris terakhir stderr. Jalankan perintah itu sendiri pada commit yang sama untuk melihat penyebabnya.

### SpecMissing

`spec_path` tidak ada di ref yang diminta dan repo tidak punya `spec_cmd`. Commit spec ke repo, atau isi `spec_cmd` agar spec dibangkitkan.

### SpecParseError

Isi spec bukan YAML atau JSON yang sah, atau akarnya bukan objek. Perbaiki berkas spec di ref yang disebut pesan.

### WorkspacePathError

Nama (mis. nama repo) mengandung pemisah path, `..`, atau karakter yang dilarang di sistem berkas, sehingga tidak bisa dibuat menjadi nama folder. Ganti nama repo.
