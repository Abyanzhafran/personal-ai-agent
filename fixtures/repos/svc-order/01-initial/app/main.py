from fastapi import FastAPI

from app.routers import orders

app = FastAPI(title="Order Service", version="1.0.0")
app.include_router(orders.router)
