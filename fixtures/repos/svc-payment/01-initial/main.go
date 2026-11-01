package main

import (
	"log"
	"net/http"
	"os"

	"example.com/svc-payment/internal/clients"
	"example.com/svc-payment/internal/handlers"
)

func main() {
	orderClient := clients.NewOrderClient(os.Getenv("ORDER_SERVICE_URL"))
	payments := handlers.NewPayments(orderClient)

	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/v1/payments", payments.Create)
	mux.HandleFunc("GET /api/v1/payments/{id}", payments.Get)

	log.Fatal(http.ListenAndServe(":8081", mux))
}
