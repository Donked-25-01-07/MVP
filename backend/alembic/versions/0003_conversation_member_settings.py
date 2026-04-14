"""add per-user conversation settings

Revision ID: 0003_conv_member_settings
Revises: 0002_full_messenger_schema
Create Date: 2026-04-14
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "0003_conv_member_settings"
down_revision = "0002_full_messenger_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS conversation_member_settings (
            conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
            user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            is_archived BOOLEAN NOT NULL DEFAULT FALSE,
            is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
            mute_until TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (conversation_id, user_id)
        );
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_conversation_member_settings_user
        ON conversation_member_settings (user_id, is_archived, is_pinned);
        """
    )
    op.execute(
        """
        CREATE OR REPLACE FUNCTION set_conversation_member_settings_updated_at()
        RETURNS TRIGGER AS $$
        BEGIN
            NEW.updated_at = NOW();
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        DROP TRIGGER IF EXISTS trg_conversation_member_settings_updated_at
        ON conversation_member_settings;
        CREATE TRIGGER trg_conversation_member_settings_updated_at
        BEFORE UPDATE ON conversation_member_settings
        FOR EACH ROW
        EXECUTE FUNCTION set_conversation_member_settings_updated_at();
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP TRIGGER IF EXISTS trg_conversation_member_settings_updated_at
        ON conversation_member_settings;
        """
    )
    op.execute("DROP FUNCTION IF EXISTS set_conversation_member_settings_updated_at;")
    op.execute("DROP TABLE IF EXISTS conversation_member_settings;")
