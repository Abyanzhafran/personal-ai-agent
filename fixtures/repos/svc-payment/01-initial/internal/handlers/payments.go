package handlers

import (
	"encoding/json"
	"net/http"

	"example.com/svc-payment/internal/clients"
)

// Payments menangani endpoint /payments.
type Payments struct {
	orderClient *clients.OrderClient
}

// NewPayments membuat handler dengan klien svc-order.
func NewPayments(orderClient *clients.OrderClient) *Payments {
	return &Payments{orderClient: orderClient}
}

// PaymentRequest badan request pembuatan pembayaran.
type PaymentRequest struct {
	OrderID  string  `json:"order_id"`
	Amount   float64 `json:"amount"`
	Currency string  `json:"currency"`
}

// Payment resource pembayaran.
type Payment struct {
	ID       string  `json:"id"`
	OrderID  string  `json:"order_id"`
	Amount   float64 `json:"amount"`
	Currency string  `json:"currency"`
	Status   string  `json:"status"`
}

// Create membuat pembayaran baru.
//
//	@Summary	Buat pembayaran
//	@ID			createPayment
//	@Param		body	body		PaymentRequest	true	"Data pembayaran"
//	@Success	201		{object}	Payment
//	@Router		/payments [post]
func (p *Payments) Create(w http.ResponseWriter, r *http.Request) {
	var in PaymentRequest
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(Payment{ID: "pay-1", OrderID: in.OrderID, Amount: in.Amount, Currency: in.Currency, Status: "pending"})
}

// Get mengambil satu pembayaran.
//
//	@Summary	Ambil pembayaran
//	@ID			getPayment
//	@Param		id	path		string	true	"Nomor pembayaran"
//	@Success	200	{object}	Payment
//	@Router		/payments/{id} [get]
func (p *Payments) Get(w http.ResponseWriter, r *http.Request) {
	_ = json.NewEncoder(w).Encode(Payment{ID: r.PathValue("id"), Status: "pending"})
}
