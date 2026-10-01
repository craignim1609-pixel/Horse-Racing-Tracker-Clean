from sqlalchemy import Column, Integer, String, Float, ForeignKey, Boolean, DateTime
from sqlalchemy.orm import relationship
from sqlalchemy.dialects.postgresql import JSON
from app.database import Base
from datetime import datetime


# -----------------------------
# PLAYER
# -----------------------------
class Player(Base):
    __tablename__ = "players"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)

    # Relationships
    picks = relationship("Pick", back_populates="player")
    racedays = relationship("RaceDay", back_populates="player")


# -----------------------------
# PICK (Accumulator + Current Picks)
# -----------------------------
class Pick(Base):
    __tablename__ = "picks"

    id = Column(Integer, primary_key=True, index=True)

    player_id = Column(Integer, ForeignKey("players.id"))
    course = Column(String)
    horse_name = Column(String)
    horse_number = Column(Integer, nullable=True)
    odds_fraction = Column(String)
    race_time = Column(String)
    status = Column(String, default="Pending")  # Pending / Win / Place / Lose / NR

    # Relationship
    player = relationship("Player", back_populates="picks")


# -----------------------------
# RACE DAY BETS
# -----------------------------
class RaceDay(Base):
    __tablename__ = "raceday"

    id = Column(Integer, primary_key=True, index=True)

    player_id = Column(Integer, ForeignKey("players.id"))
    course = Column(String)
    horse_name = Column(String)
    horse_number = Column(Integer, nullable=True)
    odds_fraction = Column(String)
    race_time = Column(String)
    amount_bet = Column(Float)

    each_way = Column(Boolean, default=False)
    result = Column(String, default="Pending")  # Win / Place / Lose / NR / Pending

    # NEW FIELDS REQUIRED FOR E/W LOGIC
    total_stake = Column(Float, default=0)      # stake * 2 if E/W
    return_amount = Column(Float, default=0)    # calculated after result

    # Relationship
    player = relationship("Player", back_populates="racedays")


# ------------------------------------
# ACCA HISTORY (Completed Accumulators)
# ------------------------------------
class AccaHistory(Base):
    __tablename__ = "acca_history"

    id = Column(Integer, primary_key=True, index=True)

    # When the acca was completed
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    # Summary fields
    stake = Column(Float, nullable=False)                 # e.g. 5.0 (E/W total)
    combined_decimal_odds = Column(Float, nullable=False)
    total_return = Column(Float, nullable=False)
    status = Column(String, nullable=False)               # win / place / lose

    # Full pick list stored as JSON
    picks_json = Column(JSON, nullable=False)
# ------------------------------------
# COMPLETED RACE DAY (History)
# ------------------------------------
class CompletedRaceDay(Base):
    __tablename__ = "completed_racedays"

    id = Column(Integer, primary_key=True, index=True)

    # The date the Race Day occurred
    date = Column(DateTime, default=datetime.utcnow)

    # Summary fields
    total_stake = Column(Float, default=0)
    total_return = Column(Float, default=0)
    profit = Column(Float, default=0)

    # Optional JSON summary (per-player stats, totals, etc.)
    summary_json = Column(JSON, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationship
    bets = relationship(
        "CompletedRaceDayBet",
        back_populates="raceday",
        cascade="all, delete-orphan"
    )


# ------------------------------------
# COMPLETED RACE DAY BETS (History)
# ------------------------------------
class CompletedRaceDayBet(Base):
    __tablename__ = "completed_raceday_bets"

    id = Column(Integer, primary_key=True, index=True)

    raceday_id = Column(Integer, ForeignKey("completed_racedays.id"))
    raceday = relationship("CompletedRaceDay", back_populates="bets")

    # Player info
    player_id = Column(Integer)
    player_name = Column(String)

    # Bet info
    course = Column(String)
    race_time = Column(String)
    horse_name = Column(String)
    horse_number = Column(Integer, nullable=True)
    odds_fraction = Column(String)
    result = Column(String)

    # Money
    stake = Column(Float)
    winnings = Column(Float)
