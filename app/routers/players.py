from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.database import get_db
from app import models

def seed_players():
    from app.database import SessionLocal
    db = SessionLocal()

    default_players = [
        "Craig",
        "Donald",
        "Miller",
        "Nick",
        "Josh"
    ]

    for name in default_players:
        exists = db.query(models.Player).filter(models.Player.name == name).first()
        if not exists:
            db.add(models.Player(name=name))

    db.commit()
    db.close()

router = APIRouter(prefix="/players", tags=["Players"])

@router.get("/")
def list_players(db: Session = Depends(get_db)):
    """
    Return all players in the database.
    Used by the Race Day dropdown and other frontend features.
    """
    return db.query(models.Player).all()
