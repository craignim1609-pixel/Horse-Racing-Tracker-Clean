from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload
from typing import List
from datetime import datetime

from app.database import get_db
from app import models, schemas
from app.utils.odds import fractional_to_decimal, place_decimal, ew_250_return

router = APIRouter(prefix="/accumulator", tags=["Accumulator"])


# ------------------------------------------------------------
# Helper: compute acca (reusable)
# ------------------------------------------------------------
def compute_acca(active_picks, place_fraction: float = 0.25):
    win_acca = 1.0
    place_acca = 1.0

    for p in active_picks:
        dec = fractional_to_decimal(p.odds_fraction)
        place_dec = place_decimal(dec, place_fraction)

        if p.status == "Win":
            win_acca *= dec
            place_acca *= place_dec

        elif p.status == "Place":
            win_acca = 0
            place_acca *= place_dec

        elif p.status == "Lose":
            win_acca = 0
            place_acca = 0
            break

        elif p.status == "Pending":
            win_acca *= dec
            place_acca *= place_dec

    # determine status
    if win_acca == 0 and place_acca == 0:
        status = "lose"
    elif all(p.status == "Win" for p in active_picks):
        status = "win"
    elif any(p.status == "Place" for p in active_picks):
        status = "place"
    else:
        status = "live"

    return win_acca, place_acca, status


# ------------------------------------------------------------
# GET ACCUMULATOR STATUS + ODDS (READ‑ONLY)
# ------------------------------------------------------------
@router.get("/", response_model=schemas.AccumulatorOut)
def get_accumulator(db: Session = Depends(get_db)):

    picks = (
        db.query(models.Pick)
        .options(joinedload(models.Pick.player))
        .filter(models.Pick.status.in_(["Pending", "Win", "Place", "Lose", "NR"]))
        .all()
    )

    if not picks:
        return schemas.AccumulatorOut(
            picks=[],
            combined_decimal_odds=None,
            ew_250_potential_return=None,
            win_acca_odds=None,
            place_acca_odds=None,
            status="no picks",
        )

    active = [p for p in picks if p.status != "NR"]

    if not active:
        return schemas.AccumulatorOut(
            picks=picks,
            combined_decimal_odds=None,
            ew_250_potential_return=None,
            win_acca_odds=None,
            place_acca_odds=None,
            status="all non runners",
        )

    win_acca, place_acca, status = compute_acca(active, place_fraction=0.25)
    ew_total = ew_250_return(win_acca, place_acca)
    return schemas.AccumulatorOut(
        picks=picks,
        combined_decimal_odds=win_acca,
        ew_250_potential_return=ew_total,
        win_acca_odds=win_acca,
        place_acca_odds=place_acca,
        status=status,
    )


# ------------------------------------------------------------
# UPDATE PICK STATUS (PATCH)
# ------------------------------------------------------------
@router.patch("/{pick_id}/status", response_model=schemas.PickOut)
def update_acca_pick_status(
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
# COMPLETE ACCA → ARCHIVE TO HISTORY
# ------------------------------------------------------------
@router.post("/complete", response_model=schemas.AccaHistoryOut)
def complete_acca(db: Session = Depends(get_db)):
    picks = (
        db.query(models.Pick)
        .options(joinedload(models.Pick.player))
        .filter(models.Pick.status.in_(["Pending", "Win", "Place", "Lose", "NR"]))
        .all()
    )

    if not picks:
        raise HTTPException(status_code=400, detail="No picks to complete")

    active = [p for p in picks if p.status != "NR"]
    if not active:
        raise HTTPException(status_code=400, detail="All picks are NR")

    win_acca, place_acca, status = compute_acca(active, place_fraction=0.25)
    # stake: £2.50 win + £2.50 place = £5.00 total
    stake_total = 5.0
    ew_total = ew_250_return(win_acca, place_acca)

    # build picks JSON for the card
    picks_payload = []
    for p in picks:
        picks_payload.append(
    {
        "player": p.player.name if p.player else "Unknown",
        "course": p.course,
        "race_time": p.race_time,
        "horse_name": p.horse_name,
        "horse_number": p.horse_number,
        "odds_fraction": p.odds_fraction,
        "result": p.status,
    }
)

    history_row = models.AccaHistory(
        created_at=datetime.utcnow(),
        stake=stake_total,
        combined_decimal_odds=win_acca,
        total_return=ew_total,
        status=status,
        picks_json=picks_payload,
    )

    db.add(history_row)
    db.commit()
    db.refresh(history_row)

    # clear current acca
    db.query(models.Pick).delete()
    db.commit()

    return schemas.AccaHistoryOut(
        id=history_row.id,
        created_at=history_row.created_at,
        stake=history_row.stake,
        combined_decimal_odds=history_row.combined_decimal_odds,
        total_return=history_row.total_return,
        status=history_row.status,
        picks=[schemas.AccaHistoryPick(**p) for p in history_row.picks_json],
    )


# ------------------------------------------------------------
# COMPLETED ACCAS HISTORY
# ------------------------------------------------------------
@router.get("/history", response_model=List[schemas.AccaHistoryOut])
def get_acca_history(db: Session = Depends(get_db)):
    rows = (
        db.query(models.AccaHistory)
        .order_by(models.AccaHistory.created_at.desc())
        .all()
    )

    result: List[schemas.AccaHistoryOut] = []
    for h in rows:
        result.append(
            schemas.AccaHistoryOut(
                id=h.id,
                created_at=h.created_at,
                stake=h.stake,
                combined_decimal_odds=h.combined_decimal_odds,
                total_return=h.total_return,
                status=h.status,
                picks=[schemas.AccaHistoryPick(**p) for p in h.picks_json],
            )
        )
    return result


# ------------------------------------------------------------
# RESET ALL PICKS (CURRENT ACCA ONLY)
# ------------------------------------------------------------
@router.delete("/reset-all")
def reset_all(db: Session = Depends(get_db)):
    db.query(models.Pick).delete()
    db.commit()
    return {"message": "All picks reset"}


# ------------------------------------------------------------
# DELETE SINGLE PICK
# ------------------------------------------------------------
@router.delete("/{pick_id}")
def delete_acca_pick(pick_id: int, db: Session = Depends(get_db)):
    pick = db.query(models.Pick).filter(models.Pick.id == pick_id).first()
    if not pick:
        raise HTTPException(status_code=404, detail="Pick not found")

    db.delete(pick)
    db.commit()

    return {"message": "Pick deleted"}


# ------------------------------------------------------------
# GROUP STANDINGS
# ------------------------------------------------------------
@router.get("/standings")
def get_standings(db: Session = Depends(get_db)):
    picks = (
        db.query(models.Pick)
        .options(joinedload(models.Pick.player))
        .all()
    )

    standings = [
        {
            "player": p.player.name if p.player else "Unknown",
            "status": p.status,
        }
        for p in picks
    ]

    return standings
