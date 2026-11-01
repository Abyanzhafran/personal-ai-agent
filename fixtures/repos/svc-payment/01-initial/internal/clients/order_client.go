package clients

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// OrderClient memanggil svc-order lewat HTTP.
type OrderClient struct {
	baseURL string
	http    *http.Client
}

// NewOrderClient membaca alamat svc-order dari ORDER_SERVICE_URL.
func NewOrderClient(baseURL string) *OrderClient {
	return &OrderClient{
		baseURL: baseURL,
		http:    &http.Client{Timeout: 5 * time.Second},
	}
}

// OrderItem satu baris pesanan.
type OrderItem struct {
	SKU      string `json:"sku"`
	Quantity int    `json:"quantity"`
}

// CreateOrderInput data dari pemanggil di svc-payment.
type CreateOrderInput struct {
	CustomerID string
	Items      []OrderItem
	Note       string
}

// CreateOrderReq badan request pembuatan pesanan di svc-order.
type CreateOrderReq struct {
	CustomerID string      `json:"customer_id"`
	Items      []OrderItem `json:"items"`
	Note       string      `json:"note,omitempty"`
}

// OrderCreated respons 201 dari svc-order.
type OrderCreated struct {
	ID     string `json:"id"`
	Status string `json:"status"`
}

// CreateOrder membuat pesanan baru untuk pembayaran yang sedang diproses.
// Galat jaringan dan status selain 201 dikembalikan apa adanya ke pemanggil.
func (c *OrderClient) CreateOrder(ctx context.Context, in CreateOrderInput) (*OrderCreated, error) {
	if len(in.Items) == 0 {
		return nil, fmt.Errorf("pesanan tanpa item")
	}

	endpoint := c.baseURL + "/orders"

	// Badan request mengikuti kontrak svc-order.

	body := CreateOrderReq{
		CustomerID: in.CustomerID,
		Items:      in.Items,
		Note:       in.Note,
	}

	payload, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	res, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()

	if res.StatusCode != http.StatusCreated {
		return nil, fmt.Errorf("svc-order membalas %d", res.StatusCode)
	}

	var created OrderCreated
	if err := json.NewDecoder(res.Body).Decode(&created); err != nil {
		return nil, err
	}
	return &created, nil
}
