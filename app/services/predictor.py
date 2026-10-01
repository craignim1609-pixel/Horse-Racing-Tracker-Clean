"""Predictor maths: odds -> chances, and jockey/trainer win records.

Everything here works from what is in the database, so it does not matter
whether the runners were typed in by hand or loaded from a data feed.
"""
import re
from typing import Optional

from sqlalchemy.orm import Session

from app import models

# A jockey/trainer combo is only called "formidable" with a real sample behind it:
# a few wins from a handful of rides is luck, not a pattern.
COMBO_MIN_RUNS = 20
COMBO_MIN_STRIKE_RATE = 0.25      # 25% - roughly double a typical flat strike rate

_FRACTION = re.compile(r"^(\d+(?:\.\d+)?)\s*/\s*(\d+(?:\.\d+)?)$")


def normalise_odds(text: Optional[str]) -> Optional[str]:
    """Return odds as a tidy fraction string ('5/2'), or None if blank.
    Accepts '5/2', 'evens'/'evs', or decimal odds like '3.5'. Raises ValueError otherwise."""
    if text is None:
        return None
    t = text.strip().lower()
    if not t:
        return None
    if t in ("evens", "evs", "even"):
        return "1/1"
    m = _FRACTION.match(t)
    if m:
        a, b = float(m.group(1)), float(m.group(2))
        if b == 0 or a <= 0:
            raise ValueError("Odds must be above zero, e.g. 5/2")
        return f"{m.group(1)}/{m.group(2)}"
    try:
        dec = float(t)
    except ValueError:
        raise ValueError("Odds must look like 5/2, evens or 3.5")
    if dec <= 1.0:
        raise ValueError("Decimal odds must be above 1.00")
    # store decimal as an equivalent fraction string
    frac = dec - 1.0
    return f"{frac:.2f}".rstrip("0").rstrip(".") + "/1"


def odds_to_decimal(fraction: Optional[str]) -> Optional[float]:
    """'5/2' -> 3.5.  None if blank/invalid."""
    if not fraction:
        return None
    m = _FRACTION.match(fraction.strip())
    if not m:
        return None
    a, b = float(m.group(1)), float(m.group(2))
    if b == 0:
        return None
    return a / b + 1.0


def clean_name(name: Optional[str]) -> str:
    return re.sub(r"\s+", " ", (name or "").strip().lower())


def stat_key(kind: str, jockey: Optional[str], trainer: Optional[str]) -> str:
    if kind == "jockey":
        return f"j:{clean_name(jockey)}"
    if kind == "trainer":
        return f"t:{clean_name(trainer)}"
    return f"c:{clean_name(jockey)}|{clean_name(trainer)}"


def _record(stat: Optional[models.ConnectionStat]):
    if not stat or stat.runs <= 0:
        return None
    return {"runs": stat.runs, "wins": stat.wins, "strike_rate": round(stat.wins / stat.runs, 4)}


def build_race_view(db: Session, race: models.PredictorRace) -> dict:
    """The race plus every runner with chances and win records filled in."""
    # one query for every stat we might need
    keys = set()
    for r in race.runners:
        if r.jockey:
            keys.add(stat_key("jockey", r.jockey, None))
        if r.trainer:
            keys.add(stat_key("trainer", None, r.trainer))
        if r.jockey and r.trainer:
            keys.add(stat_key("combo", r.jockey, r.trainer))
    stats = {}
    if keys:
        for s in db.query(models.ConnectionStat).filter(models.ConnectionStat.key.in_(keys)).all():
            stats[s.key] = s

    # market: strip the bookmaker's margin so the chances add up to 100%
    raw = {}
    for r in race.runners:
        dec = odds_to_decimal(r.sky_odds)
        if dec:
            raw[r.id] = 1.0 / dec
    book = sum(raw.values())
    overround = round((book - 1.0) * 100, 1) if len(raw) >= 2 else None

    runners = []
    for r in race.runners:
        combo = _record(stats.get(stat_key("combo", r.jockey, r.trainer))) if r.jockey and r.trainer else None
        formidable = bool(
            combo and combo["runs"] >= COMBO_MIN_RUNS and combo["strike_rate"] >= COMBO_MIN_STRIKE_RATE
        )
        chance = None
        if r.id in raw:
            chance = round((raw[r.id] / book if len(raw) >= 2 else raw[r.id]) * 100, 1)
        runners.append({
            "id": r.id,
            "horse_name": r.horse_name,
            "form": r.form,
            "jockey": r.jockey,
            "trainer": r.trainer,
            "sky_odds": r.sky_odds,
            "chance": chance,
            "jockey_record": _record(stats.get(stat_key("jockey", r.jockey, None))) if r.jockey else None,
            "trainer_record": _record(stats.get(stat_key("trainer", None, r.trainer))) if r.trainer else None,
            "combo_record": combo,
            "formidable_combo": formidable,
        })

    return {
        "id": race.id,
        "date": race.race_date.isoformat(),
        "course": race.course,
        "race_time": race.race_time,
        "name": race.name,
        "distance": race.distance,
        "overround": overround,
        "priced_runners": len(raw),
        "combo_min_runs": COMBO_MIN_RUNS,
        "combo_min_strike_rate": COMBO_MIN_STRIKE_RATE,
        "runners": runners,
    }
