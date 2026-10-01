from functools import reduce

def fractional_to_decimal(frac: str) -> float:
    num, den = map(int, frac.split('/'))
    return num / den + 1


def place_decimal(frac: str, place_fraction: float = 0.2) -> float:
    num, den = map(int, frac.split('/'))
    return (num * place_fraction) / den + 1


def accumulator_decimal(odds_list: list[float]) -> float:
    if not odds_list:
        return 0.0
    return reduce(lambda a, b: a * b, odds_list)


def ew_250_return(win_decimal: float, place_decimal_val: float) -> float:
    stake_each = 2.50
    win_return = stake_each * win_decimal
    place_return = stake_each * place_decimal_val
    return win_return + place_return
