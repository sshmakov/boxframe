from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from boxframe.config import settings

engine = create_async_engine(settings.database_url, echo=settings.debug)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with async_session() as session:
        try:
            yield session
        finally:
            await session.close()


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(_migrate_layouts_size_nullable)
        await conn.run_sync(Base.metadata.create_all)


def _migrate_layouts_size_nullable(conn) -> None:
    """One-off migration: layouts.width/height became nullable.

    SQLite cannot drop NOT NULL in place, so the table is rebuilt when the
    old (non-nullable) schema is detected. Existing data is preserved.
    """
    result = conn.exec_driver_sql("PRAGMA table_info(layouts)")
    cols = {row[1]: row for row in result.fetchall()}
    if not cols:
        return  # table does not exist yet — create_all will make it
    # PRAGMA table_info row: (cid, name, type, notnull, dflt_value, pk)
    if not cols["width"][3] and not cols["height"][3]:
        return  # already nullable
    conn.exec_driver_sql(
        """
        CREATE TABLE layouts_migrated (
            id VARCHAR(36) PRIMARY KEY,
            project_id VARCHAR(36) NOT NULL REFERENCES projects(id),
            name VARCHAR(255) NOT NULL,
            width INTEGER,
            height INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    conn.exec_driver_sql(
        "INSERT INTO layouts_migrated "
        "(id, project_id, name, width, height, created_at, updated_at) "
        "SELECT id, project_id, name, width, height, created_at, updated_at FROM layouts"
    )
    conn.exec_driver_sql("DROP TABLE layouts")
    conn.exec_driver_sql("ALTER TABLE layouts_migrated RENAME TO layouts")
