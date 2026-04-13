from collections.abc import AsyncIterator

from fastapi import HTTPException, WebSocket, WebSocketDisconnect
from jose import JWTError, jwt

from database import get_pool, settings
from schemas import MessageOut, WsMessageIn


class ConnectionManager:
    def __init__(self) -> None:
        self.active_connections: set[WebSocket] = set()

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self.active_connections.add(websocket)

    def disconnect(self, websocket: WebSocket) -> None:
        self.active_connections.discard(websocket)

    async def broadcast(self, payload: dict) -> None:
        disconnected: list[WebSocket] = []
        for connection in self.active_connections:
            try:
                await connection.send_json(payload)
            except RuntimeError:
                disconnected.append(connection)
        for connection in disconnected:
            self.disconnect(connection)


manager = ConnectionManager()


def parse_ws_token(token: str | None) -> dict:
    if not token:
        raise HTTPException(status_code=401, detail="Missing token")
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except JWTError as exc:
        raise HTTPException(status_code=401, detail="Invalid token") from exc


async def ws_messages(websocket: WebSocket) -> AsyncIterator[dict]:
    while True:
        raw_payload = await websocket.receive_json()
        message = WsMessageIn(**raw_payload)
        yield {"message": message.message}


async def handle_chat_socket(websocket: WebSocket, token: str | None) -> None:
    try:
        claims = parse_ws_token(token)
    except HTTPException:
        await websocket.close(code=1008)
        return

    user_id = int(claims["sub"])
    username = claims["username"]

    await manager.connect(websocket)
    try:
        async for payload in ws_messages(websocket):
            pool = get_pool()
            async with pool.acquire() as conn:
                row = await conn.fetchrow(
                    """
                    INSERT INTO messages (sender_id, message)
                    VALUES ($1, $2)
                    RETURNING id, message, created_at
                    """,
                    user_id,
                    payload["message"],
                )

            message_out = MessageOut(
                id=row["id"],
                sender=username,
                message=row["message"],
                created_at=row["created_at"],
            )
            await manager.broadcast(message_out.model_dump(mode="json"))
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception:
        manager.disconnect(websocket)
        await websocket.close(code=1011)

