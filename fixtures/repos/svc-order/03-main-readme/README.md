# svc-order

Layanan pesanan (FastAPI). Spesifikasi OpenAPI dihasilkan dari kode lewat `scripts/export-openapi.mjs`
dan ikut di-commit sebagai `openapi.json`.

```bash
pip install -r requirements.txt
node scripts/export-openapi.mjs   # menulis openapi.json
```

## Rilis

Cabang `main` adalah sumber rilis; fitur dikerjakan di cabang `feature/*` lalu di-merge setelah check kontrak lolos.
