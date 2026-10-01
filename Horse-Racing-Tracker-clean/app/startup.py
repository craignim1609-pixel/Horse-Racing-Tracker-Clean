from app.database import SessionLocal, Base, engine
from app import models
from typing import Iterable


def seed_players(names: Iterable[str] | None = None) -> None:
    """Insert default players if they don't already exist."""
    db = SessionLocal()
    try:
        default_players = list(names or ["Craig", "Donald", "Miller", "Nick", "Josh"])

        for name in default_players:
            exists = db.query(models.Player).filter(models.Player.name == name).first()
            if not exists:
                db.add(models.Player(name=name))

        db.commit()
    finally:
        db.close()


def create_tables() -> None:
    """Create database tables using SQLAlchemy metadata."""
    Base.metadata.create_all(bind=engine)


def setup_database(names: Iterable[str] | None = None) -> None:
    """Create tables and seed default players."""
    create_tables()
    seed_players(names)


if __name__ == "__main__":
    # When run directly, perform a full setup.
    setup_database()
