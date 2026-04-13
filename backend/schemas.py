from datetime import datetime

from pydantic import BaseModel, Field


class RegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=32)
    password: str = Field(min_length=6, max_length=128)


class LoginRequest(BaseModel):
    username: str
    password: str


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class MessageOut(BaseModel):
    id: int
    sender: str
    message: str
    created_at: datetime


class WsMessageIn(BaseModel):
    message: str = Field(min_length=1, max_length=4000)

