from datetime import datetime
from typing import Literal

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


class UserProfile(BaseModel):
    id: int
    username: str
    avatar_url: str | None = None
    bio: str = ""
    status: str = "offline"
    last_seen_at: datetime | None = None


class ProfileUpdateRequest(BaseModel):
    avatar_url: str | None = None
    bio: str = Field(default="", max_length=400)


class ConversationCreateDmRequest(BaseModel):
    username: str


class ConversationCreateGroupRequest(BaseModel):
    title: str = Field(min_length=2, max_length=120)
    member_ids: list[int] = Field(default_factory=list)


class ConversationOut(BaseModel):
    id: int
    type: Literal["dm", "group"]
    title: str | None = None
    created_at: datetime
    last_message_preview: str | None = None
    last_message_at: datetime | None = None
    unread_count: int = 0


class MessageOut(BaseModel):
    id: int
    conversation_id: int
    sender_id: int
    sender: str
    content: str
    created_at: datetime
    edited_at: datetime | None = None
    deleted_at: datetime | None = None
    attachment_url: str | None = None
    attachment_name: str | None = None
    delivered_to: list[int] = Field(default_factory=list)
    read_by: list[int] = Field(default_factory=list)


class MessageCreateRequest(BaseModel):
    content: str = Field(min_length=1, max_length=4000)
    attachment_url: str | None = None
    attachment_name: str | None = None


class MessageEditRequest(BaseModel):
    content: str = Field(min_length=1, max_length=4000)


class NotificationCountOut(BaseModel):
    unread_count: int


class WsEnvelopeIn(BaseModel):
    event: str
    conversation_id: int | None = None
    message_id: int | None = None
    content: str | None = None


class WsEnvelopeOut(BaseModel):
    event: str
    data: dict

