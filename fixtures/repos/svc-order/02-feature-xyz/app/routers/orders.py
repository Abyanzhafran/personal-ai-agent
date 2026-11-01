from fastapi import APIRouter

from app import schemas

router = APIRouter(prefix="/orders", tags=["orders"])


@router.get("", response_model=schemas.OrderList, operation_id="listOrders")
def list_orders(limit: int = 20, status: schemas.OrderStatus | None = None):
    ...


@router.post("", response_model=schemas.OrderCreated, status_code=201, operation_id="createOrder")
def create_order(body: schemas.CreateOrderRequest):
    ...


@router.get("/{order_id}", response_model=schemas.OrderDetail, operation_id="getOrder")
def get_order(order_id: str):
    ...
