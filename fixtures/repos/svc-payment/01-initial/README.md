# svc-payment

Layanan pembayaran (Go). Spesifikasi API ada di `docs/swagger.json` (Swagger 2, hasil `swag init -o docs`)
dan di-commit; repo ini tidak punya perintah generator di profilnya.

Memanggil svc-order lewat `internal/clients/order_client.go`; alamatnya dari `ORDER_SERVICE_URL`.
