from fastapi import APIRouter, Depends, HTTPException, Form
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session, joinedload
from typing import List
from app.database import get_db
from app import models, schemas

router = APIRouter(prefix="/picks", tags=["Picks"])


# ------------------------------------------------------------
# CREATE PICK (FORM SUBMISSION)
# ------------------------------------------------------------
@router.post("/add")
def add_pick(
    player_id: int = Form(...),
    course: str = Form(...),
    horse_name: str = Form(...),
    horse_number: int = Form(...),
    odds_fraction: str = Form(...),
    race_time: str = Form(...),
    db: Session = Depends(get_db)
):
    # Validate player exists
    player = db.query(models.Player).filter(models.Player.id == player_id).first()
    if not player:
        raise HTTPException(status_code=400, detail="Player not found")

    pick = models.Pick(
        player_id=player_id,
        course=course,
        horse_name=horse_name,
        horse_number=horse_number,
        odds_fraction=odds_fraction,
        race_time=race_time,
        status="Pending"
    )

    db.add(pick)
    db.commit()

    # Redirect to ACCA page (no JSON output)
    return RedirectResponse(url="/acca?added=1", status_code=303)


# ------------------------------------------------------------
# GET CURRENT PICKS
# ------------------------------------------------------------
@router.get("/current", response_model=List[schemas.PickOut])
def get_current_picks(db: Session = Depends(get_db)):
    picks = (
        db.query(models.Pick)
        .options(joinedload(models.Pick.player))
        .filter(models.Pick.status.in_(["Pending", "Win", "Place", "Lose", "NR"]))
        .all()
    )
    return picks


# ------------------------------------------------------------
# UPDATE PICK RESULT
# ------------------------------------------------------------
@router.patch("/{pick_id}/result", response_model=schemas.PickOut)
def update_pick_result(
    pick_id: int,
    data: schemas.PickUpdateStatus,
    db: Session = Depends(get_db),
):
    pick = db.query(models.Pick).filter(models.Pick.id == pick_id).first()
    if not pick:
        raise HTTPException(status_code=404, detail="Pick not found")

    pick.status = data.status
    db.commit()

    pick = (
        db.query(models.Pick)
        .options(joinedload(models.Pick.player))
        .filter(models.Pick.id == pick_id)
        .first()
    )

    return pick


# ------------------------------------------------------------
# CANCEL PICK (NR)
# ------------------------------------------------------------
@router.patch("/{pick_id}/cancel", response_model=schemas.PickOut)
def cancel_pick(pick_id: int, db: Session = Depends(get_db)):
    pick = db.query(models.Pick).filter(models.Pick.id == pick_id).first()
    if not pick:
        raise HTTPException(status_code=404, detail="Pick not found")

    pick.status = "NR"
    db.commit()

    pick = (
        db.query(models.Pick)
        .options(joinedload(models.Pick.player))
        .filter(models.Pick.id == pick_id)
        .first()
    )

    return pick


# ------------------------------------------------------------
# DELETE PICK
# ------------------------------------------------------------
@router.delete("/{pick_id}")
def delete_pick(pick_id: int, db: Session = Depends(get_db)):
    pick = db.query(models.Pick).filter(models.Pick.id == pick_id).first()
    if not pick:
        raise HTTPException(status_code=404, detail="Pick not found")

    db.delete(pick)
    db.commit()

    return {"message": "Pick deleted"}
