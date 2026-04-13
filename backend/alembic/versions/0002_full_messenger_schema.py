"""expand schema for full messenger

Revision ID: 0002_full_messenger_schema
Revises: 0001_create_users_messages
Create Date: 2026-04-14
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "0002_full_messenger_schema"
down_revision = "0001_create_users_messages"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;")
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT NOT NULL DEFAULT '';")
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(16) NOT NULL DEFAULT 'offline';")
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;")

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS conversations (
            id BIGSERIAL PRIMARY KEY,
            type VARCHAR(12) NOT NULL CHECK (type IN ('dm', 'group')),
            title VARCHAR(120),
            creator_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS conversation_members (
            conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
            user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            role VARCHAR(16) NOT NULL DEFAULT 'member',
            joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (conversation_id, user_id)
        );
        """
    )

    op.execute("ALTER TABLE messages ADD COLUMN IF NOT EXISTS conversation_id BIGINT;")
    op.execute("ALTER TABLE messages ADD COLUMN IF NOT EXISTS content TEXT;")
    op.execute("ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_url TEXT;")
    op.execute("ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_name TEXT;")
    op.execute("ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;")
    op.execute("ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;")

    op.execute("UPDATE messages SET content = message WHERE content IS NULL;")
    op.execute("ALTER TABLE messages ALTER COLUMN content SET NOT NULL;")

    op.execute(
        """
        DO $$
        DECLARE
            conv_id BIGINT;
        BEGIN
            IF EXISTS(SELECT 1 FROM messages WHERE conversation_id IS NULL) THEN
                IF NOT EXISTS (
                    SELECT 1 FROM conversations c
                    WHERE c.type = 'group' AND c.title = 'general'
                ) THEN
                    INSERT INTO conversations(type, title, creator_id)
                    SELECT 'group', 'general', COALESCE((SELECT id FROM users ORDER BY id LIMIT 1), 1)
                    RETURNING id INTO conv_id;
                ELSE
                    SELECT id INTO conv_id
                    FROM conversations
                    WHERE type = 'group' AND title = 'general'
                    LIMIT 1;
                END IF;

                INSERT INTO conversation_members(conversation_id, user_id, role)
                SELECT conv_id, u.id, 'admin'
                FROM users u
                ON CONFLICT (conversation_id, user_id) DO NOTHING;

                UPDATE messages SET conversation_id = conv_id WHERE conversation_id IS NULL;
            END IF;
        END$$;
        """
    )

    op.execute("ALTER TABLE messages ALTER COLUMN conversation_id SET NOT NULL;")
    op.execute(
        """
        ALTER TABLE messages
        ADD CONSTRAINT fk_messages_conversation
        FOREIGN KEY (conversation_id)
        REFERENCES conversations(id)
        ON DELETE CASCADE;
        """
    )

    op.execute("ALTER TABLE messages DROP COLUMN IF EXISTS message;")

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS message_reads (
            message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
            user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (message_id, user_id)
        );
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS message_deliveries (
            message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
            user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            delivered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (message_id, user_id)
        );
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS notifications (
            id BIGSERIAL PRIMARY KEY,
            user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            kind VARCHAR(24) NOT NULL,
            payload JSONB NOT NULL DEFAULT '{}'::jsonb,
            is_read BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        """
    )

    op.execute("CREATE INDEX IF NOT EXISTS idx_conversation_members_user_id ON conversation_members (user_id);")
    op.execute("CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages (conversation_id);")
    op.execute("CREATE INDEX IF NOT EXISTS idx_messages_created_at_v2 ON messages (created_at);")
    op.execute("CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications (user_id, is_read);")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS notifications;")
    op.execute("DROP TABLE IF EXISTS message_deliveries;")
    op.execute("DROP TABLE IF EXISTS message_reads;")
    op.execute("ALTER TABLE messages ADD COLUMN IF NOT EXISTS message TEXT;")
    op.execute("UPDATE messages SET message = content WHERE message IS NULL;")
    op.execute("ALTER TABLE messages DROP COLUMN IF EXISTS deleted_at;")
    op.execute("ALTER TABLE messages DROP COLUMN IF EXISTS edited_at;")
    op.execute("ALTER TABLE messages DROP COLUMN IF EXISTS attachment_name;")
    op.execute("ALTER TABLE messages DROP COLUMN IF EXISTS attachment_url;")
    op.execute("ALTER TABLE messages DROP COLUMN IF EXISTS content;")
    op.execute("ALTER TABLE messages DROP COLUMN IF EXISTS conversation_id;")
    op.execute("DROP TABLE IF EXISTS conversation_members;")
    op.execute("DROP TABLE IF EXISTS conversations;")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS last_seen_at;")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS status;")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS bio;")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS avatar_url;")
