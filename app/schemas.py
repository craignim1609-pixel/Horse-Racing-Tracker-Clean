from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


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


class PickCreate(PickBase):
    player_id: int
    status: str   # REQUIRED for New Pick form


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
class MonthlyStats(BaseModel):
    player: str
    wins: int
    places: int
    loses: int
    nr: int


# -----------------------------
# PLAYER PROFILE
# -----------------------------
class PlayerProfileOut(BaseModel):
    player: str
    wins: int
    places: int
    loses: int
    nr: int
    win_rate: float
    profit: float
    recent_form: List[str]
    biggest_winner: Optional[PickOut]

    class Config:
        orm_mode = True


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
