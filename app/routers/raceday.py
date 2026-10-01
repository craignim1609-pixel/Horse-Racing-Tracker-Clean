from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload
from typing import List
from datetime import datetime

from app.database import get_db
from app import models, schemas

router = APIRouter(prefix="/api/raceday", tags=["Race Day"])


# ------------------------------------------------------------
# Helper: Convert fractional odds to decimal
# ------------------------------------------------------------
def fractional_to_decimal(frac: str) -> float:
    if not frac:
        return 1.0

    if "/" not in frac:
        try:
            return float(frac)
        except:
            return 1.0

    a, b = frac.split("/")
    try:
        return (float(a) / float(b)) + 1
    except:
        return 1.0


# ------------------------------------------------------------
# Helper: Calculate winnings (E/W with 1/5 odds)
# ------------------------------------------------------------
def calculate_winnings(bet: models.RaceDay) -> float:
    dec = fractional_to_decimal(bet.odds_fraction)
    stake = float(bet.amount_bet)

    # Place odds = 1/5
    place_dec = ((dec - 1) * 0.2) + 1

    # If NOT each-way
    if not bet.each_way:
        if bet.result == "Win":
            return stake * dec
        if bet.result == "Place":
            return stake * place_dec
        if bet.result == "NR":
            return stake
        return 0.0

    # EACH-WAY LOGIC
    win_stake = stake
    place_stake = stake

    if bet.result == "Win":
        win_return = win_stake * dec
        place_return = place_stake * place_dec
        return win_return + place_return

    if bet.result == "Place":
        return place_stake * place_dec

    if bet.result == "NR":
        return stake * 2  # refund both stakes

    return 0.0


# ------------------------------------------------------------
# CREATE RACE DAY BET
# ------------------------------------------------------------
@router.post("/", response_model=schemas.RaceDayOut)
def add_race_day_bet(data: schemas.RaceDayCreate, db: Session = Depends(get_db)):
    player = db.query(models.Player).filter(models.Player.id == data.player_id).first()
    if not player:
        raise HTTPException(status_code=400, detail="Player not found")

    total_stake = data.amount_bet * (2 if data.each_way else 1)

    bet = models.RaceDay(
        **data.dict(),
        total_stake=total_stake,
        return_amount=0,
        result="Pending"
    )

    db.add(bet)
    db.commit()
    db.refresh(bet)

    bet = (
        db.query(models.RaceDay)
        .options(joinedload(models.RaceDay.player))
        .filter(models.RaceDay.id == bet.id)
        .first()
    )

    return bet


# ------------------------------------------------------------
# LIST ALL RACE DAY BETS
# ------------------------------------------------------------
@router.get("/", response_model=List[schemas.RaceDayOut])
def list_race_day_bets(db: Session = Depends(get_db)):
    bets = (
        db.query(models.RaceDay)
        .options(joinedload(models.RaceDay.player))
        .all()
    )
    return bets


# ------------------------------------------------------------
# RECENT ACTIVITY (last 10 bets)
# ------------------------------------------------------------
@router.get("/recent", response_model=List[schemas.RaceDayOut])
def get_recent_activity(db: Session = Depends(get_db)):
    recent = (
        db.query(models.RaceDay)
        .options(joinedload(models.RaceDay.player))
        .order_by(models.RaceDay.id.desc())
        .limit(10)
        .all()
    )
    return recent


# ------------------------------------------------------------
# UPDATE RESULT (Win / Place / Lose / NR)
# ------------------------------------------------------------
@router.patch("/{bet_id}/result", response_model=schemas.RaceDayOut)
def update_race_result(
    bet_id: int,
    data: schemas.RaceDayResultUpdate,
    db: Session = Depends(get_db)
):
    bet = db.query(models.RaceDay).filter(models.RaceDay.id == bet_id).first()
    if not bet:
        raise HTTPException(status_code=404, detail="Bet not found")

    bet.result = data.result
    bet.return_amount = calculate_winnings(bet)

    db.commit()

    bet = (
        db.query(models.RaceDay)
        .options(joinedload(models.RaceDay.player))
        .filter(models.RaceDay.id == bet_id)
        .first()
    )

    return bet


# ------------------------------------------------------------
# CURRENT DAY STATS (KEEPING THIS)
# ------------------------------------------------------------
@router.get("/stats", response_model=schemas.RaceDayStatsOut)
def race_day_stats(db: Session = Depends(get_db)):
    players = db.query(models.Player).all()
    player_stats = []

    for p in players:
        bets = db.query(models.RaceDay).filter(models.RaceDay.player_id == p.id).all()

        total_stake = sum(float(b.total_stake) for b in bets)
        total_return = sum(float(b.return_amount) for b in bets)
        profit = total_return - total_stake

        player_stats.append({
            "player": {"name": p.name},
            "total_stake": total_stake,
            "total_return": total_return,
            "profit": profit,
        })

    group_stake = sum(p["total_stake"] for p in player_stats)
    group_return = sum(p["total_return"] for p in player_stats)
    group_profit = group_return - group_stake

    return {
        "players": player_stats,
        "group": {
            "total_stake": group_stake,
            "total_return": group_return,
            "profit": group_profit,
        }
    }


# ------------------------------------------------------------
# COMPLETE RACE DAY — SAVE HISTORY + RESET
# ------------------------------------------------------------
@router.post("/complete")
def complete_race_day(db: Session = Depends(get_db)):
    bets = db.query(models.RaceDay).all()
    if not bets:
        raise HTTPException(status_code=400, detail="No bets to complete")

    # Totals
    total_stake = sum(float(b.total_stake) for b in bets)
    total_return = sum(float(b.return_amount) for b in bets)
    profit = total_return - total_stake

    # Create CompletedRaceDay
    completed = models.CompletedRaceDay(
        date=datetime.utcnow(),
        total_stake=total_stake,
        total_return=total_return,
        profit=profit,
        summary_json=None
    )
    db.add(completed)
    db.commit()
    db.refresh(completed)

    # Save each bet
    for b in bets:
        player = db.query(models.Player).filter(models.Player.id == b.player_id).first()

        entry = models.CompletedRaceDayBet(
            raceday_id=completed.id,
            player_id=b.player_id,
            player_name=player.name if player else "Unknown",
            course=b.course,
            race_time=b.race_time,
            horse_name=b.horse_name,
            horse_number=b.horse_number,
            odds_fraction=b.odds_fraction,
            result=b.result,
            stake=b.total_stake,
            winnings=b.return_amount
        )
        db.add(entry)

    db.commit()

    # Reset Race Day
    db.query(models.RaceDay).delete()
    db.commit()

    return {
        "message": "Race Day completed and archived.",
        "raceday_id": completed.id,
        "summary": {
            "total_stake": total_stake,
            "total_return": total_return,
            "profit": profit
        }
    }


# ------------------------------------------------------------
# DELETE RACE DAY BET
# ------------------------------------------------------------
@router.delete("/{bet_id}")
def delete_race_day_bet(bet_id: int, db: Session = Depends(get_db)):
    bet = db.query(models.RaceDay).filter(models.RaceDay.id == bet_id).first()
    if not bet:
        raise HTTPException(status_code=404, detail="Bet not found")

    db.delete(bet)
    db.commit()

    return {"message": "Bet deleted"}
