from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
import os

DATABASE_URL = os.getenv("DATABASE_URL")

# Fallback to a local sqlite file for easy local development when
# DATABASE_URL is not provided. In production, set DATABASE_URL to
# your Postgres/other DB connection string.
if not DATABASE_URL:
    DATABASE_URL = "sqlite:///./dev.db"
    engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
else:
    # For Postgres / external DBs (e.g. Railway) we require SSL
    engine = create_engine(DATABASE_URL, connect_args={"sslmode": "require"})

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine
)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
