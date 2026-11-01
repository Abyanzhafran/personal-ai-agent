from enum import Enum

from pydantic import BaseModel


class OrderStatus(str, Enum):
    pending = "pending"
    paid = "paid"
    shipped = "shipped"
    cancelled = "cancelled"


class OrderListItem(BaseModel):
    id: str
    status: OrderStatus


class OrderList(BaseModel):
    items: list[OrderListItem]


class OrderLine(BaseModel):
    id: str
    sku: str
    quantity: float


class OrderDetail(BaseModel):
    id: str
    status: OrderStatus
    grand_total: str
    items: list[OrderLine]


class CreateOrderLine(BaseModel):
    sku: str
    quantity: int


class CreateOrderRequest(BaseModel):
    customer_id: str
    items: list[CreateOrderLine]
    currency: str


class OrderCreated(BaseModel):
    id: str
    status: OrderStatus
