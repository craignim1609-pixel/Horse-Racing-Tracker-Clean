from functools import reduce
from typing import Union


def fractional_to_decimal(frac: Union[str, float]) -> float:
    """Convert a fractional odds string (eg '3/1') or numeric string to decimal odds.
    Returns 1.0 on any parsing error or when input is falsy.
    """
    if not frac and frac != 0:
        return 1.0

    try:
        if isinstance(frac, (int, float)):
            return float(frac)

        frac_str = str(frac)
        if "/" in frac_str:
            a, b = frac_str.split("/")
            return (float(a) / float(b)) + 1

        return float(frac_str)
    except Exception:
        return 1.0


def place_decimal(decimal_odds: float, place_fraction: float = 0.25) -> float:
    """Calculate place decimal from a decimal odd using the provided place fraction.
    Default place_fraction=0.25 implements the 1/4 rule used for accumulators.
    """
    try:
        return ((decimal_odds - 1) * place_fraction) + 1
    except Exception:
        return 1.0


def accumulator_decimal(odds_list: list[float]) -> float:
    if not odds_list:
        return 0.0
    return reduce(lambda a, b: a * b, odds_list)


def ew_250_return(win_decimal: float, place_decimal_val: float) -> float:
    stake_each = 2.50
    win_return = stake_each * win_decimal
    place_return = stake_each * place_decimal_val
    return win_return + place_return
