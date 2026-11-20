"""Database engine and session handling (PostgreSQL in production, SQLite locally)."""
import logging
from contextlib import contextmanager
from typing import Iterator, List, Optional

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker


log = logging.getLogger("makon.db")


class Base(DeclarativeBase):
    pass


_engine: Optional[Engine] = None
SessionLocal = sessionmaker(autoflush=False, expire_on_commit=False)


def init_engine(url: str) -> Engine:
    global _engine
    if url.startswith("sqlite"):
        engine = create_engine(url, connect_args={"check_same_thread": False, "timeout": 15})

        @event.listens_for(engine, "connect")
        def _sqlite_pragmas(dbapi_conn, _record):  # pragma: no cover - trivial
            cur = dbapi_conn.cursor()
            cur.execute("PRAGMA foreign_keys=ON")
            cur.execute("PRAGMA journal_mode=WAL")
            cur.execute("PRAGMA busy_timeout=15000")
            cur.close()
    else:
        engine = create_engine(
            url,
            pool_pre_ping=True,
            pool_size=5,
            max_overflow=5,
            pool_recycle=300,
            # Works with poolers (Supabase/Neon) that do not support prepared statements.
            connect_args={"prepare_threshold": None},
        )
    SessionLocal.configure(bind=engine)
    _engine = engine
    return engine


def get_engine() -> Engine:
    if _engine is None:
        raise RuntimeError("Database is not initialised")
    return _engine


def create_tables() -> None:
    from . import models  # noqa: F401  (registers models)

    engine = get_engine()
    Base.metadata.create_all(engine)
    add_missing_columns(engine)


def add_missing_columns(engine: Engine) -> List[str]:
    """Tiny forward-only migration: add columns that exist in the models but not yet in the database.

    create_all() creates new tables but never alters existing ones, so databases made by an older
    version would miss new fields. Only nullable columns or columns with a scalar default are added.
    """
    from sqlalchemy import inspect, text

    added: List[str] = []
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    with engine.begin() as conn:
        for table in Base.metadata.sorted_tables:
            if table.name not in existing_tables:
                continue
            have = {c["name"] for c in inspector.get_columns(table.name)}
            for column in table.columns:
                if column.name in have:
                    continue
                col_type = column.type.compile(dialect=engine.dialect)
                ddl = f'ALTER TABLE "{table.name}" ADD COLUMN "{column.name}" {col_type}'
                default = column.default.arg if column.default is not None and column.default.is_scalar else None
                if default is not None:
                    if isinstance(default, bool):
                        literal = ("TRUE" if default else "FALSE") if engine.dialect.name == "postgresql" else str(int(default))
                    elif isinstance(default, (int, float)):
                        literal = str(default)
                    else:
                        literal = "'" + str(default).replace("'", "''") + "'"
                    ddl += f" DEFAULT {literal}"
                    if not column.nullable:
                        ddl += " NOT NULL"
                conn.execute(text(ddl))
                added.append(f"{table.name}.{column.name}")
    if added:
        log.info("database columns added: %s", ", ".join(added))
    return added


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@contextmanager
def session_scope() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
