"""
Shared fixtures for all tests.
"""

import asyncio
import os
import tempfile
from collections.abc import AsyncGenerator, Generator
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from boxframe.database import Base
from boxframe.main import app


@pytest.fixture(scope="function")
def client():
    """FastAPI TestClient — uses a fresh SQLite temp file per test."""
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    db_url = f"sqlite+aiosqlite:///{tmp.name}"

    import boxframe.database as db_module
    original_engine = db_module.engine
    original_session = db_module.async_session
    original_url = db_module.settings.database_url

    try:
        fresh_engine = create_async_engine(db_url, echo=False)
        fresh_session = async_sessionmaker(fresh_engine, class_=AsyncSession, expire_on_commit=False)

        db_module.engine = fresh_engine
        db_module.async_session = fresh_session
        db_module.settings.database_url = db_url

        async def setup():
            async with fresh_engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)

        asyncio.get_event_loop().run_until_complete(setup())

        with TestClient(app) as c:
            yield c
    finally:
        db_module.engine = original_engine
        db_module.async_session = original_session
        db_module.settings.database_url = original_url
        os.unlink(tmp.name)


@pytest.fixture(scope="session")
def event_loop():
    """Create a session-scoped event loop."""
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture(scope="session")
def _engine():
    """Create a session-scoped async engine with test database."""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    yield engine


@pytest.fixture(scope="session")
async def db_session(_engine: AsyncSession) -> AsyncGenerator[AsyncSession, None]:
    """Create a session-scoped database session with tables created."""
    async with _engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async_session = async_sessionmaker(_engine, class_=AsyncSession, expire_on_commit=False)
    async with async_session() as session:
        yield session
        await session.rollback()

    async with _engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
