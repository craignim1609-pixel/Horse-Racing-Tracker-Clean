from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.database import get_db
from app import models

router = APIRouter(prefix="/players", tags=["Players"])


@router.get("/")
def list_players(db: Session = Depends(get_db)):
    """
    Return all players in the database.
    Used by the Race Day dropdown and other frontend features.
    """
    return db.query(models.Player).all()
