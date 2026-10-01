from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
import tempfile
from app.database import get_db
from app import models
from app.utils.excel import export_to_excel

router = APIRouter(prefix="/export", tags=["Export"])


@router.get("/month/{month}")
def export_month(month: int, year: int, db: Session = Depends(get_db)):
    picks = (
        db.query(models.Pick)
        .filter(models.Pick.month == month, models.Pick.year == year)
        .all()
    )
    data = [
        {
            "player_id": p.player_id,
            "course": p.course,
            "horse_name": p.horse_name,
            "horse_number": p.horse_number,
            "odds_fraction": p.odds_fraction,
            "race_time": p.race_time,
            "status": p.status,
            "month": p.month,
            "year": p.year,
        }
        for p in picks
    ]

    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".xlsx")
    export_to_excel(data, tmp.name)
    return FileResponse(tmp.name, filename=f"month_{month}_{year}.xlsx")
