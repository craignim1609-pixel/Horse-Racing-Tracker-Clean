from pydantic import BaseModel, validator
from typing import Optional, List
from datetime import datetime, date
import re

from app.services.predictor import normalise_odds


# -----------------------------
# PLAYER
# -----------------------------
class PlayerBase(BaseModel):
    name: str


class PlayerOut(PlayerBase):
    id: int

    class Config:
        orm_mode = True


# -----------------------------
# PICK (Accumulator + Current Picks)
# -----------------------------
class PickBase(BaseModel):
    course: str
    horse_name: str
    horse_number: Optional[int]
    odds_fraction: str
    race_time: str




class PickUpdateStatus(BaseModel):
    status: str


class PickOut(PickBase):
    id: int
    status: str
    player: PlayerOut

    class Config:
        orm_mode = True


# -----------------------------
# ACCUMULATOR OUTPUT
# -----------------------------
class AccaPickOut(BaseModel):
    id: int
    status: str
    horse_name: str
    horse_number: Optional[int]
    odds_fraction: str
    course: str
    race_time: str
    player: PlayerOut

    class Config:
        orm_mode = True


class AccumulatorOut(BaseModel):
    picks: List[AccaPickOut]
    combined_decimal_odds: Optional[float]
    ew_250_potential_return: Optional[float]

    win_acca_odds: Optional[float]
    place_acca_odds: Optional[float]

    status: str

    class Config:
        orm_mode = True


# -----------------------------
# RACE DAY BETS
# -----------------------------
class RaceDayBase(BaseModel):
    player_id: int
    course: str
    horse_name: str
    horse_number: Optional[int]
    odds_fraction: str
    race_time: str
    amount_bet: float
    each_way: bool = False


class RaceDayCreate(RaceDayBase):
    pass


class RaceDayResultUpdate(BaseModel):
    result: str


class RaceDayOut(RaceDayBase):
    id: int
    result: str
    total_stake: float
    return_amount: float
    player: PlayerOut

    class Config:
        orm_mode = True


# -----------------------------
# RACE DAY STATS
# -----------------------------

class RaceDayPlayerName(BaseModel):
    name: str


class RaceDayPlayerStats(BaseModel):
    player: RaceDayPlayerName   # <-- FIXED (was str)
    total_stake: float
    total_return: float
    profit: float


class RaceDayGroupStats(BaseModel):
    total_stake: float
    total_return: float
    profit: float


class RaceDayStatsOut(BaseModel):
    group: RaceDayGroupStats
    players: List[RaceDayPlayerStats]


# -----------------------------
# MONTHLY STATS
# -----------------------------


# -----------------------------
# PLAYER PROFILE
# -----------------------------


# -----------------------------
# ACCA HISTORY (Completed Accas)
# -----------------------------
class AccaHistoryPick(BaseModel):
    player: str
    course: str
    race_time: str
    horse_name: str
    horse_number: int | None
    odds_fraction: str
    result: str


class AccaHistoryOut(BaseModel):
    id: int
    created_at: datetime
    stake: float
    combined_decimal_odds: float
    total_return: float
    status: str
    picks: List[AccaHistoryPick]

    class Config:
        orm_mode = True


# -----------------------------
# PREDICTOR
# -----------------------------
_TIME = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def _blank_to_none(v):
    """Trim text; an empty box becomes None."""
    if isinstance(v, str):
        v = re.sub(r"\s+", " ", v.strip())
        return v or None
    return v


class PredictorRaceCreate(BaseModel):
    race_date: date
    course: Optional[str] = None        # required - checked below so a blank box gets a clear message
    race_time: Optional[str] = None     # required - checked below
    name: Optional[str] = None
    distance: Optional[str] = None

    _clean = validator("course", "race_time", "name", "distance", pre=True, allow_reuse=True)(_blank_to_none)

    @validator("course", always=True)
    def course_required(cls, v):
        if not v:
            raise ValueError("Course is required")
        return v

    @validator("race_time", always=True)
    def time_format(cls, v):
        if not v or not _TIME.match(v):
            raise ValueError("Time must look like 14:05")
        return v


class PredictorRunnerUpdate(BaseModel):
    horse_name: Optional[str] = None
    form: Optional[str] = None
    jockey: Optional[str] = None
    trainer: Optional[str] = None
    sky_odds: Optional[str] = None

    _clean = validator("horse_name", "form", "jockey", "trainer", "sky_odds", pre=True, allow_reuse=True)(_blank_to_none)

    @validator("sky_odds")
    def odds_format(cls, v):
        return normalise_odds(v)


class PredictorRunnerCreate(PredictorRunnerUpdate):
    @validator("horse_name", always=True)
    def horse_required(cls, v):
        if not v:
            raise ValueError("Horse name is required")
        return v


class ConnectionStatIn(BaseModel):
    kind: str
    jockey: Optional[str] = None
    trainer: Optional[str] = None
    runs: int
    wins: int

    _clean = validator("jockey", "trainer", pre=True, allow_reuse=True)(_blank_to_none)

    @validator("kind")
    def kind_valid(cls, v):
        if v not in ("jockey", "trainer", "combo"):
            raise ValueError("Type must be jockey, trainer or combo")
        return v

    @validator("runs")
    def runs_positive(cls, v):
        if v < 1:
            raise ValueError("Runs must be at least 1")
        return v

    @validator("wins")
    def wins_valid(cls, v, values):
        if v < 0:
            raise ValueError("Wins can't be negative")
        if "runs" in values and v > values["runs"]:
            raise ValueError("Wins can't be more than runs")
        return v
