from collections import defaultdict

from fastapi import HTTPException, WebSocket, WebSocketDisconnect

from auth import decode_access_token
from database import get_pool
from schemas import WsEnvelopeIn


class ConnectionManager:
    def __init__(self) -> None:
        self.user_connections: dict[int, set[WebSocket]] = defaultdict(set)

    async def connect(self, user_id: int, websocket: WebSocket) -> None:
        await websocket.accept()
        self.user_connections[user_id].add(websocket)

    def disconnect(self, user_id: int, websocket: WebSocket) -> None:
        sockets = self.user_connections.get(user_id)
        if sockets:
            sockets.discard(websocket)
            if not sockets:
                self.user_connections.pop(user_id, None)

    async def send_to_users(self, user_ids: set[int], payload: dict) -> None:
        stale: list[tuple[int, WebSocket]] = []
        for uid in user_ids:
            for ws in self.user_connections.get(uid, set()):
                try:
                    await ws.send_json(payload)
                except Exception:
                    stale.append((uid, ws))
        for uid, ws in stale:
            self.disconnect(uid, ws)


manager = ConnectionManager()


def parse_ws_token(token: str | None) -> dict:
    if not token:
        raise HTTPException(status_code=401, detail="Missing token")
    return decode_access_token(token)


async def is_conversation_member(user_id: int, conversation_id: int) -> bool:
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT 1
            FROM conversation_members
            WHERE conversation_id = $1 AND user_id = $2
            """,
            conversation_id,
            user_id,
        )
    return row is not None


async def conversation_member_ids(conversation_id: int) -> set[int]:
    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT user_id
            FROM conversation_members
            WHERE conversation_id = $1
            """,
            conversation_id,
        )
    return {int(row["user_id"]) for row in rows}


async def broadcast_event_to_conversation(
    conversation_id: int,
    payload: dict,
    *,
    exclude_user_ids: set[int] | None = None,
) -> None:
    members = await conversation_member_ids(conversation_id)
    if exclude_user_ids:
        members -= exclude_user_ids
    if members:
        await manager.send_to_users(members, payload)


async def _create_message(conversation_id: int, user_id: int, content: str) -> dict:
    pool = get_pool()
    async with pool.acquire() as conn:
        allowed = await conn.fetchrow(
            """
            SELECT 1 FROM conversation_members
            WHERE conversation_id = $1 AND user_id = $2
            """,
            conversation_id,
            user_id,
        )
        if not allowed:
            raise HTTPException(status_code=403, detail="Not a conversation member")

        row = await conn.fetchrow(
            """
            INSERT INTO messages (conversation_id, sender_id, content)
            VALUES ($1, $2, $3)
            RETURNING id, conversation_id, sender_id, content, created_at, edited_at, deleted_at, attachment_url, attachment_name
            """,
            conversation_id,
            user_id,
            content,
        )
        sender = await conn.fetchrow("SELECT username FROM users WHERE id = $1", user_id)

    return {
        "id": row["id"],
        "conversation_id": row["conversation_id"],
        "sender_id": row["sender_id"],
        "sender": sender["username"],
        "content": row["content"],
        "created_at": row["created_at"].isoformat(),
        "edited_at": row["edited_at"],
        "deleted_at": row["deleted_at"],
        "attachment_url": row["attachment_url"],
        "attachment_name": row["attachment_name"],
    }


async def _message_belongs_to_conversation(message_id: int, conversation_id: int) -> bool:
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT 1
            FROM messages
            WHERE id = $1 AND conversation_id = $2
            """,
            message_id,
            conversation_id,
        )
    return row is not None


async def _mark_message(message_id: int, user_id: int, kind: str) -> None:
    table_name = {
        "read": "message_reads",
        "delivered": "message_deliveries",
    }.get(kind)
    if table_name is None:
        raise ValueError(f"Unsupported marker kind: {kind}")

    pool = get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            f"""
            INSERT INTO {table_name} (message_id, user_id)
            VALUES ($1, $2)
            ON CONFLICT (message_id, user_id) DO NOTHING
            """,
            message_id,
            user_id,
        )


async def _send_forbidden_event(websocket: WebSocket) -> None:
    await websocket.send_json({"event": "error", "data": {"detail": "Not a conversation member"}})


async def handle_chat_socket(websocket: WebSocket, token: str | None) -> None:
    try:
        claims = parse_ws_token(token)
    except HTTPException:
        await websocket.close(code=1008)
        return

    user_id = int(claims["sub"])
    username = claims["username"]
    await manager.connect(user_id, websocket)

    try:
        await websocket.send_json({"event": "presence:update", "data": {"user_id": user_id, "status": "online"}})
        while True:
            envelope = WsEnvelopeIn(**(await websocket.receive_json()))
            if envelope.event == "ping":
                await websocket.send_json({"event": "pong", "data": {}})
                continue

            if envelope.event == "typing:start" and envelope.conversation_id:
                if not await is_conversation_member(user_id, envelope.conversation_id):
                    await _send_forbidden_event(websocket)
                    continue
                await broadcast_event_to_conversation(
                    envelope.conversation_id,
                    {
                        "event": "typing:start",
                        "data": {"conversation_id": envelope.conversation_id, "user_id": user_id, "username": username},
                    },
                    exclude_user_ids={user_id},
                )
                continue

            if envelope.event == "typing:stop" and envelope.conversation_id:
                if not await is_conversation_member(user_id, envelope.conversation_id):
                    await _send_forbidden_event(websocket)
                    continue
                await broadcast_event_to_conversation(
                    envelope.conversation_id,
                    {
                        "event": "typing:stop",
                        "data": {"conversation_id": envelope.conversation_id, "user_id": user_id, "username": username},
                    },
                    exclude_user_ids={user_id},
                )
                continue

            if envelope.event == "message:new" and envelope.conversation_id and envelope.content:
                try:
                    message = await _create_message(envelope.conversation_id, user_id, envelope.content)
                except HTTPException as exc:
                    await websocket.send_json({"event": "error", "data": {"detail": exc.detail}})
                    continue
                await broadcast_event_to_conversation(
                    envelope.conversation_id,
                    {"event": "message:new", "data": message},
                )
                continue

            if envelope.event == "message:read" and envelope.message_id and envelope.conversation_id:
                if not await is_conversation_member(user_id, envelope.conversation_id):
                    await _send_forbidden_event(websocket)
                    continue
                if not await _message_belongs_to_conversation(envelope.message_id, envelope.conversation_id):
                    await websocket.send_json({"event": "error", "data": {"detail": "Message/conversation mismatch"}})
                    continue
                await _mark_message(envelope.message_id, user_id, "read")
                await broadcast_event_to_conversation(
                    envelope.conversation_id,
                    {
                        "event": "message:read",
                        "data": {"message_id": envelope.message_id, "conversation_id": envelope.conversation_id, "user_id": user_id},
                    },
                )
                continue

            if envelope.event == "message:delivered" and envelope.message_id and envelope.conversation_id:
                if not await is_conversation_member(user_id, envelope.conversation_id):
                    await _send_forbidden_event(websocket)
                    continue
                if not await _message_belongs_to_conversation(envelope.message_id, envelope.conversation_id):
                    await websocket.send_json({"event": "error", "data": {"detail": "Message/conversation mismatch"}})
                    continue
                await _mark_message(envelope.message_id, user_id, "delivered")
                await broadcast_event_to_conversation(
                    envelope.conversation_id,
                    {
                        "event": "message:delivered",
                        "data": {"message_id": envelope.message_id, "conversation_id": envelope.conversation_id, "user_id": user_id},
                    },
                )
                continue
    except WebSocketDisconnect:
        manager.disconnect(user_id, websocket)
    except Exception:
        manager.disconnect(user_id, websocket)
        await websocket.close(code=1011)
