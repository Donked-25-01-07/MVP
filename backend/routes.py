from fastapi import APIRouter, HTTPException, status

from auth import create_access_token, hash_password, verify_password
from database import get_pool
from schemas import AuthResponse, LoginRequest, MessageOut, RegisterRequest

router = APIRouter()


@router.post("/auth/register", response_model=AuthResponse)
async def register(payload: RegisterRequest) -> AuthResponse:
    pool = get_pool()
    async with pool.acquire() as conn:
        existing = await conn.fetchrow("SELECT id FROM users WHERE username = $1", payload.username)
        if existing:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already exists")

        user = await conn.fetchrow(
            """
            INSERT INTO users (username, password_hash)
            VALUES ($1, $2)
            RETURNING id, username
            """,
            payload.username,
            hash_password(payload.password),
        )

    token = create_access_token(user_id=user["id"], username=user["username"])
    return AuthResponse(access_token=token)


@router.post("/auth/login", response_model=AuthResponse)
async def login(payload: LoginRequest) -> AuthResponse:
    pool = get_pool()
    async with pool.acquire() as conn:
        user = await conn.fetchrow(
            "SELECT id, username, password_hash FROM users WHERE username = $1",
            payload.username,
        )

    if user is None or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    token = create_access_token(user_id=user["id"], username=user["username"])
    return AuthResponse(access_token=token)


@router.get("/messages", response_model=list[MessageOut])
async def get_messages() -> list[MessageOut]:
    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT m.id, u.username AS sender, m.message, m.created_at
            FROM messages m
            JOIN users u ON u.id = m.sender_id
            ORDER BY m.created_at ASC
            """
        )

    return [MessageOut(**dict(row)) for row in rows]

