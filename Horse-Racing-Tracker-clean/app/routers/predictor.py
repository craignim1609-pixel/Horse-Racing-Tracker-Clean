from datetime import date as date_type, datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app import models, schemas
from app.services.predictor import build_race_view, stat_key
from app.utils.courses import COURSES

router = APIRouter(prefix="/api/predictor", tags=["Predictor"])


def _get_race(db: Session, race_id: int) -> models.PredictorRace:
    race = (
        db.query(models.PredictorRace)
        .options(joinedload(models.PredictorRace.runners))
        .filter(models.PredictorRace.id == race_id)
        .first()
    )
    if not race:
        raise HTTPException(status_code=404, detail="Race not found")
    return race


# ------------------------------------------------------------
# COURSES (for the "add a race" picker)
# ------------------------------------------------------------
@router.get("/courses")
def list_courses():
    return COURSES


# ------------------------------------------------------------
# RACES FOR A DAY  (drives the course + race-time dropdowns)
# ------------------------------------------------------------
@router.get("/races")
def races_for_day(date: Optional[str] = None, db: Session = Depends(get_db)):
    try:
        day = datetime.strptime(date, "%Y-%m-%d").date() if date else date_type.today()
    except ValueError:
        raise HTTPException(status_code=422, detail="date must look like 2026-10-01")

    races = (
        db.query(models.PredictorRace)
        .options(joinedload(models.PredictorRace.runners))
        .filter(models.PredictorRace.race_date == day)
        .order_by(models.PredictorRace.course, models.PredictorRace.race_time)
        .all()
    )
    return [
        {
            "id": r.id,
            "course": r.course,
            "race_time": r.race_time,
            "name": r.name,
            "distance": r.distance,
            "runner_count": len(r.runners),
        }
        for r in races
    ]


@router.post("/races")
def add_race(data: schemas.PredictorRaceCreate, db: Session = Depends(get_db)):
    dupe = (
        db.query(models.PredictorRace)
        .filter(
            models.PredictorRace.race_date == data.race_date,
            models.PredictorRace.course == data.course,
            models.PredictorRace.race_time == data.race_time,
        )
        .first()
    )
    if dupe:
        raise HTTPException(status_code=409, detail="That race is already added")

    race = models.PredictorRace(
        race_date=data.race_date,
        course=data.course,
        race_time=data.race_time,
        name=data.name,
        distance=data.distance,
    )
    db.add(race)
    db.commit()
    db.refresh(race)
    return {"id": race.id}


@router.get("/races/{race_id}")
def get_race(race_id: int, db: Session = Depends(get_db)):
    return build_race_view(db, _get_race(db, race_id))


@router.delete("/races/{race_id}")
def delete_race(race_id: int, db: Session = Depends(get_db)):
    race = _get_race(db, race_id)
    db.delete(race)
    db.commit()
    return {"message": "Race deleted"}


# ------------------------------------------------------------
# RUNNERS
# ------------------------------------------------------------
@router.post("/races/{race_id}/runners")
def add_runner(race_id: int, data: schemas.PredictorRunnerCreate, db: Session = Depends(get_db)):
    race = _get_race(db, race_id)
    db.add(models.PredictorRunner(race_id=race.id, **data.dict()))
    db.commit()
    return build_race_view(db, _get_race(db, race_id))


@router.patch("/runners/{runner_id}")
def update_runner(runner_id: int, data: schemas.PredictorRunnerUpdate, db: Session = Depends(get_db)):
    runner = db.query(models.PredictorRunner).filter(models.PredictorRunner.id == runner_id).first()
    if not runner:
        raise HTTPException(status_code=404, detail="Runner not found")

    # only touch the fields the browser actually sent
    for field, value in data.dict(exclude_unset=True).items():
        if field == "horse_name" and not value:
            continue
        setattr(runner, field, value)
    db.commit()
    return build_race_view(db, _get_race(db, runner.race_id))


@router.delete("/runners/{runner_id}")
def delete_runner(runner_id: int, db: Session = Depends(get_db)):
    runner = db.query(models.PredictorRunner).filter(models.PredictorRunner.id == runner_id).first()
    if not runner:
        raise HTTPException(status_code=404, detail="Runner not found")
    race_id = runner.race_id
    db.delete(runner)
    db.commit()
    return build_race_view(db, _get_race(db, race_id))


# ------------------------------------------------------------
# JOCKEY / TRAINER / COMBO WIN RECORDS
# ------------------------------------------------------------
def _stat_out(s: models.ConnectionStat) -> dict:
    return {
        "id": s.id,
        "kind": s.kind,
        "jockey": s.jockey,
        "trainer": s.trainer,
        "runs": s.runs,
        "wins": s.wins,
        "strike_rate": round(s.wins / s.runs, 4) if s.runs else 0,
    }


@router.get("/stats")
def list_stats(db: Session = Depends(get_db)):
    rows = (
        db.query(models.ConnectionStat)
        .order_by(models.ConnectionStat.kind, models.ConnectionStat.jockey, models.ConnectionStat.trainer)
        .all()
    )
    return [_stat_out(s) for s in rows]


@router.post("/stats")
def save_stat(data: schemas.ConnectionStatIn, db: Session = Depends(get_db)):
    if data.kind in ("jockey", "combo") and not data.jockey:
        raise HTTPException(status_code=422, detail="Jockey name is required")
    if data.kind in ("trainer", "combo") and not data.trainer:
        raise HTTPException(status_code=422, detail="Trainer name is required")

    jockey = data.jockey if data.kind in ("jockey", "combo") else None
    trainer = data.trainer if data.kind in ("trainer", "combo") else None
    key = stat_key(data.kind, jockey, trainer)

    stat = db.query(models.ConnectionStat).filter(models.ConnectionStat.key == key).first()
    if stat:                                   # same person/combo again -> update the record
        stat.runs, stat.wins = data.runs, data.wins
        stat.jockey, stat.trainer = jockey, trainer
    else:
        stat = models.ConnectionStat(
            key=key, kind=data.kind, jockey=jockey, trainer=trainer, runs=data.runs, wins=data.wins
        )
        db.add(stat)
    db.commit()
    db.refresh(stat)
    return _stat_out(stat)


@router.delete("/stats/{stat_id}")
def delete_stat(stat_id: int, db: Session = Depends(get_db)):
    stat = db.query(models.ConnectionStat).filter(models.ConnectionStat.id == stat_id).first()
    if not stat:
        raise HTTPException(status_code=404, detail="Stat not found")
    db.delete(stat)
    db.commit()
    return {"message": "Stat deleted"}
