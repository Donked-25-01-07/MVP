from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Header, HTTPException, UploadFile, status

from auth import create_access_token, decode_access_token, hash_password, verify_password
from database import get_pool
from schemas import (
    AuthResponse,
    ConversationDetailsOut,
    ConversationCreateDmRequest,
    ConversationCreateGroupRequest,
    ConversationMediaOut,
    ConversationMemberOut,
    ConversationOut,
    ConversationSettingsUpdateRequest,
    LoginRequest,
    MessageCreateRequest,
    MessageEditRequest,
    MessageOut,
    NotificationCountOut,
    ProfileUpdateRequest,
    RegisterRequest,
    UserProfile,
)
from websocket import broadcast_event_to_conversation

router = APIRouter()
UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)
SAVED_MESSAGES_TITLE = "Saved Messages"


def _claims_to_user(claims: dict) -> dict:
    return {"id": int(claims["sub"]), "username": claims["username"]}


def get_current_user(authorization: str | None = Header(default=None)) -> dict:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")
    token = authorization.split(" ", 1)[1]
    return _claims_to_user(decode_access_token(token))


def _conversation_title(row: dict, current_username: str) -> str:
    if row["type"] == "group":
        return row["title"] or "Untitled Group"
    if row.get("title"):
        return row["title"]
    usernames = [name.strip() for name in (row.get("member_usernames") or "").split(",") if name.strip()]
    other = [name for name in usernames if name != current_username]
    return other[0] if other else current_username


def _can_manage_conversation(row: dict, current_user_id: int) -> bool:
    return row.get("role") == "admin" or int(row.get("creator_id") or 0) == int(current_user_id)


def _conversation_row_to_out(row: dict, current_user: dict) -> ConversationOut:
    return ConversationOut(
        id=row["id"],
        type=row["type"],
        title=_conversation_title(dict(row), current_user["username"]),
        created_at=row["created_at"],
        last_message_preview=row["last_message_preview"],
        last_message_at=row["last_message_at"],
        unread_count=row["unread_count"],
        is_pinned=bool(row["is_pinned"]),
        is_archived=bool(row["is_archived"]),
        mute_until=row["mute_until"],
        role=row["role"] or "member",
        can_manage=_can_manage_conversation(dict(row), current_user["id"]),
    )


async def _load_conversation_for_user(conn, conversation_id: int, current_user: dict) -> ConversationOut | None:
    row = await conn.fetchrow(
        """
        SELECT c.id, c.type, c.title, c.created_at, c.creator_id,
               cm.role,
               lm.content AS last_message_preview, lm.created_at AS last_message_at,
               COALESCE((
                   SELECT COUNT(*)
                   FROM messages m2
                   WHERE m2.conversation_id = c.id
                   AND m2.sender_id != $1
                   AND NOT EXISTS (
                       SELECT 1 FROM message_reads mr
                       WHERE mr.message_id = m2.id AND mr.user_id = $1
                   )
               ), 0) AS unread_count,
               (
                   SELECT string_agg(u.username, ',')
                   FROM conversation_members cm2
                   JOIN users u ON u.id = cm2.user_id
                   WHERE cm2.conversation_id = c.id
               ) AS member_usernames,
               COALESCE(cms.is_pinned, FALSE) AS is_pinned,
               COALESCE(cms.is_archived, FALSE) AS is_archived,
               cms.mute_until
        FROM conversations c
        JOIN conversation_members cm
            ON cm.conversation_id = c.id
            AND cm.user_id = $1
        LEFT JOIN conversation_member_settings cms
            ON cms.conversation_id = c.id
            AND cms.user_id = $1
        LEFT JOIN LATERAL (
            SELECT content, created_at
            FROM messages m
            WHERE m.conversation_id = c.id
            ORDER BY m.created_at DESC
            LIMIT 1
        ) lm ON TRUE
        WHERE c.id = $2
        """,
        current_user["id"],
        conversation_id,
    )
    if row is None:
        return None
    return _conversation_row_to_out(dict(row), current_user)


async def _load_messages(conn, conversation_id: int) -> list[MessageOut]:
    rows = await conn.fetch(
        """
        SELECT m.id, m.conversation_id, m.sender_id, u.username AS sender, m.content,
               m.created_at, m.edited_at, m.deleted_at, m.attachment_url, m.attachment_name,
               COALESCE(array_agg(DISTINCT md.user_id) FILTER (WHERE md.user_id IS NOT NULL), '{}') AS delivered_to,
               COALESCE(array_agg(DISTINCT mr.user_id) FILTER (WHERE mr.user_id IS NOT NULL), '{}') AS read_by
        FROM messages m
        JOIN users u ON u.id = m.sender_id
        LEFT JOIN message_deliveries md ON md.message_id = m.id
        LEFT JOIN message_reads mr ON mr.message_id = m.id
        WHERE m.conversation_id = $1
        GROUP BY m.id, u.username
        ORDER BY m.created_at ASC
        """,
        conversation_id,
    )
    return [MessageOut(**dict(row)) for row in rows]


@router.post("/auth/register", response_model=AuthResponse)
async def register(payload: RegisterRequest) -> AuthResponse:
    pool = get_pool()
    async with pool.acquire() as conn:
        existing = await conn.fetchrow("SELECT id FROM users WHERE username = $1", payload.username)
        if existing:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already exists")

        user = await conn.fetchrow(
            """
            INSERT INTO users (username, password_hash, status, last_seen_at)
            VALUES ($1, $2, 'online', NOW())
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

        await conn.execute(
            "UPDATE users SET status = 'online', last_seen_at = NOW() WHERE id = $1",
            user["id"],
        )

    token = create_access_token(user_id=user["id"], username=user["username"])
    return AuthResponse(access_token=token)


@router.get("/me", response_model=UserProfile)
async def get_me(current_user: dict = Depends(get_current_user)) -> UserProfile:
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT id, username, avatar_url, bio, status, last_seen_at
            FROM users
            WHERE id = $1
            """,
            current_user["id"],
        )
    return UserProfile(**dict(row))


@router.patch("/me", response_model=UserProfile)
async def patch_me(payload: ProfileUpdateRequest, current_user: dict = Depends(get_current_user)) -> UserProfile:
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            UPDATE users
            SET avatar_url = $1, bio = $2
            WHERE id = $3
            RETURNING id, username, avatar_url, bio, status, last_seen_at
            """,
            payload.avatar_url,
            payload.bio,
            current_user["id"],
        )
    return UserProfile(**dict(row))


@router.get("/users")
async def list_users(q: str = "", current_user: dict = Depends(get_current_user)) -> list[dict]:
    query = q.strip()
    if not query:
        return []
    pool = get_pool()
    pattern = f"%{query.lower()}%"
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, username, avatar_url, status, last_seen_at
            FROM users
            WHERE id != $1 AND LOWER(username) LIKE $2
            ORDER BY username ASC
            LIMIT 30
            """,
            current_user["id"],
            pattern,
        )
    return [dict(row) for row in rows]


@router.get("/conversations", response_model=list[ConversationOut])
async def list_conversations(
    include_archived: bool = False,
    current_user: dict = Depends(get_current_user),
) -> list[ConversationOut]:
    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT c.id, c.type, c.title, c.created_at, c.creator_id,
                   cm.role,
                   lm.content AS last_message_preview, lm.created_at AS last_message_at,
                   COALESCE((
                       SELECT COUNT(*)
                       FROM messages m2
                       WHERE m2.conversation_id = c.id
                       AND m2.sender_id != $1
                       AND NOT EXISTS (
                           SELECT 1 FROM message_reads mr
                           WHERE mr.message_id = m2.id AND mr.user_id = $1
                       )
                   ), 0) AS unread_count,
                   (
                       SELECT string_agg(u.username, ',')
                       FROM conversation_members cm2
                       JOIN users u ON u.id = cm2.user_id
                       WHERE cm2.conversation_id = c.id
                   ) AS member_usernames,
                   COALESCE(cms.is_pinned, FALSE) AS is_pinned,
                   COALESCE(cms.is_archived, FALSE) AS is_archived,
                   cms.mute_until
            FROM conversations c
            JOIN conversation_members cm
                ON cm.conversation_id = c.id
                AND cm.user_id = $1
            LEFT JOIN conversation_member_settings cms
                ON cms.conversation_id = c.id
                AND cms.user_id = $1
            LEFT JOIN LATERAL (
                SELECT content, created_at
                FROM messages m
                WHERE m.conversation_id = c.id
                ORDER BY m.created_at DESC
                LIMIT 1
            ) lm ON TRUE
            WHERE ($2::BOOLEAN OR COALESCE(cms.is_archived, FALSE) = FALSE)
            ORDER BY COALESCE(cms.is_pinned, FALSE) DESC, COALESCE(lm.created_at, c.created_at) DESC
            """,
            current_user["id"],
            include_archived,
        )
    return [_conversation_row_to_out(dict(row), current_user) for row in rows]


@router.post("/conversations/dm", response_model=ConversationOut)
async def create_dm(payload: ConversationCreateDmRequest, current_user: dict = Depends(get_current_user)) -> ConversationOut:
    pool = get_pool()
    async with pool.acquire() as conn:
        recipient = await conn.fetchrow(
            "SELECT id, username FROM users WHERE username = $1",
            payload.username,
        )
        if recipient is None:
            raise HTTPException(status_code=404, detail="User not found")
        if recipient["id"] == current_user["id"]:
            raise HTTPException(status_code=400, detail="Cannot create DM with yourself")

        existing = await conn.fetchrow(
            """
            SELECT c.id, c.type, c.title, c.created_at
            FROM conversations c
            JOIN conversation_members cm1 ON cm1.conversation_id = c.id AND cm1.user_id = $1
            JOIN conversation_members cm2 ON cm2.conversation_id = c.id AND cm2.user_id = $2
            WHERE c.type = 'dm'
            LIMIT 1
            """,
            current_user["id"],
            recipient["id"],
        )

        if existing:
            return ConversationOut(
                id=existing["id"],
                type=existing["type"],
                title=recipient["username"],
                created_at=existing["created_at"],
            )

        conversation = await conn.fetchrow(
            """
            INSERT INTO conversations (type, title, creator_id)
            VALUES ('dm', NULL, $1)
            RETURNING id, type, title, created_at
            """,
            current_user["id"],
        )
        await conn.execute(
            """
            INSERT INTO conversation_members (conversation_id, user_id, role)
            VALUES ($1, $2, 'member'), ($1, $3, 'member')
            """,
            conversation["id"],
            current_user["id"],
            recipient["id"],
        )

    return ConversationOut(
        id=conversation["id"],
        type="dm",
        title=recipient["username"],
        created_at=conversation["created_at"],
    )


@router.post("/conversations/group", response_model=ConversationOut)
async def create_group(
    payload: ConversationCreateGroupRequest,
    current_user: dict = Depends(get_current_user),
) -> ConversationOut:
    unique_member_ids = sorted(set(payload.member_ids + [current_user["id"]]))
    pool = get_pool()
    async with pool.acquire() as conn:
        existing_member_rows = await conn.fetch(
            """
            SELECT id
            FROM users
            WHERE id = ANY($1::BIGINT[])
            """,
            unique_member_ids,
        )
        existing_member_ids = {int(row["id"]) for row in existing_member_rows}
        missing_member_ids = sorted(set(unique_member_ids) - existing_member_ids)
        if missing_member_ids:
            missing_text = ",".join(str(member_id) for member_id in missing_member_ids)
            raise HTTPException(status_code=400, detail=f"Unknown member ids: {missing_text}")

        conversation = await conn.fetchrow(
            """
            INSERT INTO conversations (type, title, creator_id)
            VALUES ('group', $1, $2)
            RETURNING id, type, title, created_at
            """,
            payload.title,
            current_user["id"],
        )

        for member_id in unique_member_ids:
            role = "admin" if member_id == current_user["id"] else "member"
            await conn.execute(
                """
                INSERT INTO conversation_members (conversation_id, user_id, role)
                VALUES ($1, $2, $3)
                ON CONFLICT (conversation_id, user_id) DO NOTHING
                """,
                conversation["id"],
                member_id,
                role,
            )

    return ConversationOut(
        id=conversation["id"],
        type="group",
        title=conversation["title"],
        created_at=conversation["created_at"],
    )


@router.post("/conversations/saved", response_model=ConversationOut)
async def get_or_create_saved_messages(current_user: dict = Depends(get_current_user)) -> ConversationOut:
    pool = get_pool()
    async with pool.acquire() as conn:
        existing = await conn.fetchrow(
            """
            SELECT c.id
            FROM conversations c
            JOIN conversation_members cm
                ON cm.conversation_id = c.id
                AND cm.user_id = $1
            WHERE c.type = 'dm' AND c.title = $2
            LIMIT 1
            """,
            current_user["id"],
            SAVED_MESSAGES_TITLE,
        )
        if existing:
            conversation = await _load_conversation_for_user(conn, int(existing["id"]), current_user)
            if conversation:
                return conversation

        conversation_row = await conn.fetchrow(
            """
            INSERT INTO conversations (type, title, creator_id)
            VALUES ('dm', $1, $2)
            RETURNING id
            """,
            SAVED_MESSAGES_TITLE,
            current_user["id"],
        )
        await conn.execute(
            """
            INSERT INTO conversation_members (conversation_id, user_id, role)
            VALUES ($1, $2, 'admin')
            ON CONFLICT (conversation_id, user_id) DO NOTHING
            """,
            conversation_row["id"],
            current_user["id"],
        )
        conversation = await _load_conversation_for_user(conn, int(conversation_row["id"]), current_user)
    if conversation is None:
        raise HTTPException(status_code=500, detail="Could not initialize saved messages")
    return conversation


@router.get("/conversations/{conversation_id}", response_model=ConversationDetailsOut)
async def get_conversation_details(
    conversation_id: int,
    current_user: dict = Depends(get_current_user),
) -> ConversationDetailsOut:
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT c.id, c.type, c.title, c.creator_id,
                   cm.role,
                   (
                       SELECT string_agg(u.username, ',')
                       FROM conversation_members cm2
                       JOIN users u ON u.id = cm2.user_id
                       WHERE cm2.conversation_id = c.id
                   ) AS member_usernames,
                   COALESCE(cms.is_pinned, FALSE) AS is_pinned,
                   COALESCE(cms.is_archived, FALSE) AS is_archived,
                   cms.mute_until
            FROM conversations c
            JOIN conversation_members cm
                ON cm.conversation_id = c.id
                AND cm.user_id = $1
            LEFT JOIN conversation_member_settings cms
                ON cms.conversation_id = c.id
                AND cms.user_id = $1
            WHERE c.id = $2
            """,
            current_user["id"],
            conversation_id,
        )
        if row is None:
            raise HTTPException(status_code=404, detail="Conversation not found")

        member_rows = await conn.fetch(
            """
            SELECT u.id, u.username, u.avatar_url, u.status, cm.role
            FROM conversation_members cm
            JOIN users u ON u.id = cm.user_id
            WHERE cm.conversation_id = $1
            ORDER BY CASE cm.role WHEN 'admin' THEN 0 ELSE 1 END, u.username ASC
            """,
            conversation_id,
        )
        media_rows = await conn.fetch(
            """
            SELECT m.id AS message_id, m.attachment_url, m.attachment_name, u.username AS sender, m.created_at
            FROM messages m
            JOIN users u ON u.id = m.sender_id
            WHERE m.conversation_id = $1 AND m.attachment_url IS NOT NULL
            ORDER BY m.created_at DESC
            LIMIT 60
            """,
            conversation_id,
        )

    row_dict = dict(row)
    return ConversationDetailsOut(
        id=row_dict["id"],
        type=row_dict["type"],
        title=_conversation_title(row_dict, current_user["username"]),
        role=row_dict["role"] or "member",
        can_manage=_can_manage_conversation(row_dict, current_user["id"]),
        is_pinned=bool(row_dict["is_pinned"]),
        is_archived=bool(row_dict["is_archived"]),
        mute_until=row_dict["mute_until"],
        members=[
            ConversationMemberOut(
                id=member_row["id"],
                username=member_row["username"],
                avatar_url=member_row["avatar_url"],
                status=member_row["status"],
                role=member_row["role"],
            )
            for member_row in member_rows
        ],
        media=[
            ConversationMediaOut(
                message_id=media_row["message_id"],
                attachment_url=media_row["attachment_url"],
                attachment_name=media_row["attachment_name"],
                sender=media_row["sender"],
                created_at=media_row["created_at"],
            )
            for media_row in media_rows
        ],
    )


@router.patch("/conversations/{conversation_id}/settings", response_model=ConversationOut)
async def update_conversation_settings(
    conversation_id: int,
    payload: ConversationSettingsUpdateRequest,
    current_user: dict = Depends(get_current_user),
) -> ConversationOut:
    pool = get_pool()
    async with pool.acquire() as conn:
        membership = await conn.fetchrow(
            """
            SELECT c.id, c.type, c.creator_id, cm.role
            FROM conversations c
            JOIN conversation_members cm
                ON cm.conversation_id = c.id
                AND cm.user_id = $1
            WHERE c.id = $2
            """,
            current_user["id"],
            conversation_id,
        )
        if membership is None:
            raise HTTPException(status_code=404, detail="Conversation not found")

        if payload.title is not None:
            if membership["type"] != "group":
                raise HTTPException(status_code=400, detail="Only group title can be edited")
            if not _can_manage_conversation(dict(membership), current_user["id"]):
                raise HTTPException(status_code=403, detail="Insufficient permissions")
            await conn.execute(
                """
                UPDATE conversations
                SET title = $1
                WHERE id = $2
                """,
                payload.title.strip(),
                conversation_id,
            )

        existing_settings = await conn.fetchrow(
            """
            SELECT is_archived, is_pinned, mute_until
            FROM conversation_member_settings
            WHERE conversation_id = $1 AND user_id = $2
            """,
            conversation_id,
            current_user["id"],
        )

        if payload.is_archived is not None or payload.is_pinned is not None or payload.mute_hours is not None:
            current_archived = bool(existing_settings["is_archived"]) if existing_settings else False
            current_pinned = bool(existing_settings["is_pinned"]) if existing_settings else False
            current_mute_until = existing_settings["mute_until"] if existing_settings else None

            is_archived = payload.is_archived if payload.is_archived is not None else current_archived
            is_pinned = payload.is_pinned if payload.is_pinned is not None else current_pinned

            mute_until = current_mute_until
            if payload.mute_hours is not None:
                if payload.mute_hours < 0:
                    mute_until = datetime.now(timezone.utc) + timedelta(days=365 * 30)
                elif payload.mute_hours == 0:
                    mute_until = None
                else:
                    mute_until = datetime.now(timezone.utc) + timedelta(hours=payload.mute_hours)

            await conn.execute(
                """
                INSERT INTO conversation_member_settings (conversation_id, user_id, is_archived, is_pinned, mute_until)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (conversation_id, user_id)
                DO UPDATE SET
                    is_archived = EXCLUDED.is_archived,
                    is_pinned = EXCLUDED.is_pinned,
                    mute_until = EXCLUDED.mute_until
                """,
                conversation_id,
                current_user["id"],
                is_archived,
                is_pinned,
                mute_until,
            )

        conversation = await _load_conversation_for_user(conn, conversation_id, current_user)
        if conversation is None:
            raise HTTPException(status_code=404, detail="Conversation not found")
        return conversation


@router.delete("/conversations/{conversation_id}")
async def delete_conversation(
    conversation_id: int,
    for_everyone: bool = False,
    current_user: dict = Depends(get_current_user),
) -> dict:
    pool = get_pool()
    async with pool.acquire() as conn:
        membership = await conn.fetchrow(
            """
            SELECT c.id, c.creator_id, cm.role
            FROM conversations c
            JOIN conversation_members cm
                ON cm.conversation_id = c.id
                AND cm.user_id = $1
            WHERE c.id = $2
            """,
            current_user["id"],
            conversation_id,
        )
        if membership is None:
            raise HTTPException(status_code=404, detail="Conversation not found")

        if for_everyone:
            if not _can_manage_conversation(dict(membership), current_user["id"]):
                raise HTTPException(status_code=403, detail="Only admin can delete for everyone")
            await conn.execute("DELETE FROM conversations WHERE id = $1", conversation_id)
            return {"ok": True, "removed_for": "all"}

        await conn.execute(
            """
            DELETE FROM conversation_member_settings
            WHERE conversation_id = $1 AND user_id = $2
            """,
            conversation_id,
            current_user["id"],
        )
        await conn.execute(
            """
            DELETE FROM conversation_members
            WHERE conversation_id = $1 AND user_id = $2
            """,
            conversation_id,
            current_user["id"],
        )
        remaining_members = await conn.fetchval(
            "SELECT COUNT(*)::int FROM conversation_members WHERE conversation_id = $1",
            conversation_id,
        )
        if not remaining_members:
            await conn.execute("DELETE FROM conversations WHERE id = $1", conversation_id)
    return {"ok": True, "removed_for": "self"}


@router.get("/conversations/{conversation_id}/messages", response_model=list[MessageOut])
async def conversation_messages(conversation_id: int, current_user: dict = Depends(get_current_user)) -> list[MessageOut]:
    pool = get_pool()
    async with pool.acquire() as conn:
        membership = await conn.fetchrow(
            """
            SELECT 1 FROM conversation_members
            WHERE conversation_id = $1 AND user_id = $2
            """,
            conversation_id,
            current_user["id"],
        )
        if membership is None:
            raise HTTPException(status_code=403, detail="Not a member of this conversation")

        messages = await _load_messages(conn, conversation_id)
    return messages


@router.get("/conversations/{conversation_id}/search", response_model=list[MessageOut])
async def search_messages_in_conversation(
    conversation_id: int,
    q: str = "",
    current_user: dict = Depends(get_current_user),
) -> list[MessageOut]:
    query = q.strip().lower()
    if not query:
        return []

    pool = get_pool()
    async with pool.acquire() as conn:
        membership = await conn.fetchrow(
            """
            SELECT 1 FROM conversation_members
            WHERE conversation_id = $1 AND user_id = $2
            """,
            conversation_id,
            current_user["id"],
        )
        if membership is None:
            raise HTTPException(status_code=403, detail="Not a member of this conversation")

        rows = await conn.fetch(
            """
            SELECT m.id, m.conversation_id, m.sender_id, u.username AS sender, m.content,
                   m.created_at, m.edited_at, m.deleted_at, m.attachment_url, m.attachment_name,
                   COALESCE(array_agg(DISTINCT md.user_id) FILTER (WHERE md.user_id IS NOT NULL), '{}') AS delivered_to,
                   COALESCE(array_agg(DISTINCT mr.user_id) FILTER (WHERE mr.user_id IS NOT NULL), '{}') AS read_by
            FROM messages m
            JOIN users u ON u.id = m.sender_id
            LEFT JOIN message_deliveries md ON md.message_id = m.id
            LEFT JOIN message_reads mr ON mr.message_id = m.id
            WHERE m.conversation_id = $1
              AND (
                LOWER(m.content) LIKE $2
                OR LOWER(COALESCE(m.attachment_name, '')) LIKE $2
              )
            GROUP BY m.id, u.username
            ORDER BY m.created_at DESC
            LIMIT 40
            """,
            conversation_id,
            f"%{query}%",
        )
    return [MessageOut(**dict(row)) for row in rows]


@router.post("/conversations/{conversation_id}/messages", response_model=MessageOut)
async def create_message(
    conversation_id: int,
    payload: MessageCreateRequest,
    current_user: dict = Depends(get_current_user),
) -> MessageOut:
    pool = get_pool()
    async with pool.acquire() as conn:
        membership = await conn.fetchrow(
            "SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND user_id = $2",
            conversation_id,
            current_user["id"],
        )
        if membership is None:
            raise HTTPException(status_code=403, detail="Not a member of this conversation")

        row = await conn.fetchrow(
            """
            INSERT INTO messages (conversation_id, sender_id, content, attachment_url, attachment_name)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id, conversation_id, sender_id, content, created_at, edited_at, deleted_at, attachment_url, attachment_name
            """,
            conversation_id,
            current_user["id"],
            payload.content,
            payload.attachment_url,
            payload.attachment_name,
        )

    created = MessageOut(
        id=row["id"],
        conversation_id=row["conversation_id"],
        sender_id=row["sender_id"],
        sender=current_user["username"],
        content=row["content"],
        created_at=row["created_at"],
        edited_at=row["edited_at"],
        deleted_at=row["deleted_at"],
        attachment_url=row["attachment_url"],
        attachment_name=row["attachment_name"],
    )
    await broadcast_event_to_conversation(
        conversation_id,
        {"event": "message:new", "data": created.model_dump(mode="json")},
    )
    return created


@router.patch("/messages/{message_id}", response_model=MessageOut)
async def edit_message(
    message_id: int,
    payload: MessageEditRequest,
    current_user: dict = Depends(get_current_user),
) -> MessageOut:
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            UPDATE messages
            SET content = $1, edited_at = NOW()
            WHERE id = $2 AND sender_id = $3 AND deleted_at IS NULL
            RETURNING id, conversation_id, sender_id, content, created_at, edited_at, deleted_at, attachment_url, attachment_name
            """,
            payload.content,
            message_id,
            current_user["id"],
        )
        if row is None:
            raise HTTPException(status_code=404, detail="Message not found")
    return MessageOut(
        id=row["id"],
        conversation_id=row["conversation_id"],
        sender_id=row["sender_id"],
        sender=current_user["username"],
        content=row["content"],
        created_at=row["created_at"],
        edited_at=row["edited_at"],
        deleted_at=row["deleted_at"],
        attachment_url=row["attachment_url"],
        attachment_name=row["attachment_name"],
    )


@router.delete("/messages/{message_id}")
async def delete_message(message_id: int, current_user: dict = Depends(get_current_user)) -> dict:
    pool = get_pool()
    async with pool.acquire() as conn:
        result = await conn.execute(
            """
            UPDATE messages
            SET deleted_at = NOW(), content = '[deleted]'
            WHERE id = $1 AND sender_id = $2 AND deleted_at IS NULL
            """,
            message_id,
            current_user["id"],
        )
    return {"ok": result.endswith("1")}


@router.post("/messages/{message_id}/read")
async def mark_message_read(message_id: int, current_user: dict = Depends(get_current_user)) -> dict:
    pool = get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO message_reads (message_id, user_id, read_at)
            VALUES ($1, $2, NOW())
            ON CONFLICT (message_id, user_id) DO UPDATE SET read_at = EXCLUDED.read_at
            """,
            message_id,
            current_user["id"],
        )
    return {"ok": True}


@router.post("/messages/{message_id}/delivered")
async def mark_message_delivered(message_id: int, current_user: dict = Depends(get_current_user)) -> dict:
    pool = get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO message_deliveries (message_id, user_id, delivered_at)
            VALUES ($1, $2, NOW())
            ON CONFLICT (message_id, user_id) DO UPDATE SET delivered_at = EXCLUDED.delivered_at
            """,
            message_id,
            current_user["id"],
        )
    return {"ok": True}


@router.get("/notifications/unread-count", response_model=NotificationCountOut)
async def unread_count(current_user: dict = Depends(get_current_user)) -> NotificationCountOut:
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT COUNT(*)::int AS unread_count
            FROM notifications
            WHERE user_id = $1 AND is_read = FALSE
            """,
            current_user["id"],
        )
    return NotificationCountOut(unread_count=row["unread_count"])


@router.post("/attachments")
async def upload_attachment(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
) -> dict:
    max_size_bytes = 25 * 1024 * 1024

    suffix = Path(file.filename or "file.bin").suffix
    safe_name = f"{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}_{uuid4().hex}{suffix}"
    filepath = UPLOAD_DIR / safe_name
    written_bytes = 0
    chunk_size = 1024 * 1024
    try:
        with filepath.open("wb") as destination:
            while True:
                chunk = await file.read(chunk_size)
                if not chunk:
                    break
                written_bytes += len(chunk)
                if written_bytes > max_size_bytes:
                    raise HTTPException(status_code=413, detail="File too large (max 25MB)")
                destination.write(chunk)
    except HTTPException:
        filepath.unlink(missing_ok=True)
        raise
    except Exception:
        filepath.unlink(missing_ok=True)
        raise
    finally:
        await file.close()

    return {
        "url": f"/uploads/{safe_name}",
        "name": file.filename or safe_name,
        "uploader_id": current_user["id"],
    }


@router.get("/messages", response_model=list[MessageOut])
async def get_messages(current_user: dict = Depends(get_current_user)) -> list[MessageOut]:
    # Backward-compat endpoint for MVP consumers.
    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT m.id, m.conversation_id, m.sender_id, u.username AS sender, m.content,
                   m.created_at, m.edited_at, m.deleted_at, m.attachment_url, m.attachment_name
            FROM messages m
            JOIN users u ON u.id = m.sender_id
            JOIN conversation_members cm ON cm.conversation_id = m.conversation_id
            WHERE cm.user_id = $1
            ORDER BY m.created_at ASC
            LIMIT 200
            """,
            current_user["id"],
        )
    return [
        MessageOut(
            id=row["id"],
            conversation_id=row["conversation_id"],
            sender_id=row["sender_id"],
            sender=row["sender"],
            content=row["content"],
            created_at=row["created_at"],
            edited_at=row["edited_at"],
            deleted_at=row["deleted_at"],
            attachment_url=row["attachment_url"],
            attachment_name=row["attachment_name"],
        )
        for row in rows
    ]
