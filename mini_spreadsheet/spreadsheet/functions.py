"""Built-in functions.

A function receives the already-flattened list of numeric arguments, so
``SUM(B1:B10, 5, A1)`` and ``SUM(B1:B10)`` look identical from here.  Blank
cells inside a range are dropped before the call (see ``EvalContext.values_in``)
which is what makes ``AVG(C1:C20)`` average the cells that actually hold a
value rather than dividing by twenty.
"""

from __future__ import annotations

import math
from typing import Callable, Dict, List

from .errors import DIV_ZERO, ErrorValue, EvaluationError, ParseError

Function = Callable[[List[float]], float]


def _sum(values: List[float]) -> float:
    return math.fsum(values)  # fsum, not sum: no drift over long columns


def _avg(values: List[float]) -> float:
    if not values:
        raise EvaluationError(ErrorValue(DIV_ZERO, "AVG of an empty range"))
    return math.fsum(values) / len(values)


def _min(values: List[float]) -> float:
    return min(values) if values else 0.0


def _max(values: List[float]) -> float:
    return max(values) if values else 0.0


def _count(values: List[float]) -> float:
    return float(len(values))


_FUNCTIONS: Dict[str, Function] = {
    "SUM": _sum,
    "AVG": _avg,
    "AVERAGE": _avg,
    "MIN": _min,
    "MAX": _max,
    "COUNT": _count,
}


def lookup(name: str) -> Function:
    """Resolve a function at *parse* time, so a typo is a rejected command
    rather than a cell that quietly holds an error."""
    try:
        return _FUNCTIONS[name.upper()]
    except KeyError:
        raise ParseError(
            f"unknown function {name.upper()!r}; known functions: "
            + ", ".join(names())
        ) from None


def names() -> List[str]:
    return sorted(_FUNCTIONS)
