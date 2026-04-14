import asyncpg
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    database_url: str
    jwt_secret: str = "change_me"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24
    cors_origins: str = "*"

    @property
    def cors_origins_list(self) -> list[str]:
        normalized = [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]
        return normalized or ["*"]


settings = Settings()
db_pool: asyncpg.Pool | None = None


async def init_db_pool() -> None:
    global db_pool
    db_pool = await asyncpg.create_pool(dsn=settings.database_url, min_size=1, max_size=10)


async def close_db_pool() -> None:
    global db_pool
    if db_pool is not None:
        await db_pool.close()
        db_pool = None


def get_pool() -> asyncpg.Pool:
    if db_pool is None:
        raise RuntimeError("Database pool is not initialized")
    return db_pool
