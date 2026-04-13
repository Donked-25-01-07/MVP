from collections import defaultdict

from fastapi import HTTPException, WebSocket, WebSocketDisconnect

from auth import decode_access_token
from database import get_pool
from schemas import WsEnvelopeIn


class ConnectionManager:
    def __init__(self) -> None:
        self.user_connections: dict[int, set[WebSocket]] = defaultdict(set)
        self.typing_presence: dict[int, set[int]] = defaultdict(set)

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
                except RuntimeError:
                    stale.append((uid, ws))
        for uid, ws in stale:
            self.disconnect(uid, ws)


manager = ConnectionManager()


def parse_ws_token(token: str | None) -> dict:
    if not token:
        raise HTTPException(status_code=401, detail="Missing token")
    return decode_access_token(token)


async def _conversation_member_ids(conversation_id: int) -> set[int]:
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


async def _mark_message(message_id: int, user_id: int, table: str) -> None:
    pool = get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            f"""
            INSERT INTO {table} (message_id, user_id)
            VALUES ($1, $2)
            ON CONFLICT (message_id, user_id) DO NOTHING
            """,
            message_id,
            user_id,
        )


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
                members = await _conversation_member_ids(envelope.conversation_id)
                await manager.send_to_users(
                    members - {user_id},
                    {
                        "event": "typing:start",
                        "data": {"conversation_id": envelope.conversation_id, "user_id": user_id, "username": username},
                    },
                )
                continue

            if envelope.event == "typing:stop" and envelope.conversation_id:
                members = await _conversation_member_ids(envelope.conversation_id)
                await manager.send_to_users(
                    members - {user_id},
                    {
                        "event": "typing:stop",
                        "data": {"conversation_id": envelope.conversation_id, "user_id": user_id},
                    },
                )
                continue

            if envelope.event == "message:new" and envelope.conversation_id and envelope.content:
                message = await _create_message(envelope.conversation_id, user_id, envelope.content)
                members = await _conversation_member_ids(envelope.conversation_id)
                await manager.send_to_users(members, {"event": "message:new", "data": message})
                continue

            if envelope.event == "message:read" and envelope.message_id and envelope.conversation_id:
                await _mark_message(envelope.message_id, user_id, "message_reads")
                members = await _conversation_member_ids(envelope.conversation_id)
                await manager.send_to_users(
                    members,
                    {
                        "event": "message:read",
                        "data": {"message_id": envelope.message_id, "conversation_id": envelope.conversation_id, "user_id": user_id},
                    },
                )
                continue

            if envelope.event == "message:delivered" and envelope.message_id and envelope.conversation_id:
                await _mark_message(envelope.message_id, user_id, "message_deliveries")
                members = await _conversation_member_ids(envelope.conversation_id)
                await manager.send_to_users(
                    members,
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

