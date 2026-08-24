#!/usr/bin/env python3
"""VeerPath level authoring tool: generate, validate, preview, emit.

Model
-----
Board is a lattice of points (x, y), y DOWN. An arrow is a polyline of
axis-aligned segments from tail to head; its arrowhead points along the last
segment. Tapping a free arrow makes the whole path stream out along its own
track and leave through the straight ray in front of the head. An arrow is
FREE iff that ray crosses no other remaining path.

Guaranteed solvability by construction
--------------------------------------
Arrows are placed one at a time. Each new arrow's exit ray must be clear of
every ALREADY-PLACED arrow. Then the reverse of the placement order is a
valid removal order:

    place  p1, p2, ..., pN      (each pi's ray avoids p1..p(i-1))
    remove pN, p(N-1), ..., p1  (when pi is removed, only p1..p(i-1) remain,
                                 and pi's ray was built to avoid exactly those)

Later-placed arrows may sit on earlier ones' rays, which is what creates the
blocking dependencies - so density and difficulty come for free, and every
generated board is solvable. An independent greedy solver re-verifies.

Usage
-----
    python3 tools/design_levels.py            # regenerate + verify + emit Kotlin
    python3 tools/design_levels.py --preview  # also write PNG previews
    python3 tools/design_levels.py --stats    # print design metrics only
"""
from __future__ import annotations

import argparse
import os
import random
import sys

DIRS = [(1, 0), (-1, 0), (0, 1), (0, -1)]
DIR_NAME = {(1, 0): "RIGHT", (-1, 0): "LEFT", (0, 1): "DOWN", (0, -1): "UP"}

HERE = os.path.dirname(os.path.abspath(__file__))
KOTLIN_OUT = os.path.join(
    HERE, "..", "app", "src", "main", "java", "com", "veergames", "veer", "core", "Levels.kt")
PREVIEW_DIR = os.path.join(HERE, "..", "build", "level_previews")


# --------------------------------------------------------------------------
# model
# --------------------------------------------------------------------------

class Arrow:
    __slots__ = ("pts", "cells", "head_dir", "aid", "ray_cache")

    def __init__(self, pts, aid=None):
        self.pts = [tuple(p) for p in pts]
        self.aid = aid
        self.head_dir = _unit(self.pts[-2], self.pts[-1])
        self.cells = _cells(self.pts)
        self.ray_cache = ()

    @property
    def body_len(self):
        return len(self.cells) - 1

    @property
    def bends(self):
        return len(self.pts) - 2

    def ray(self, cols, rows):
        dx, dy = self.head_dir
        x, y = self.pts[-1]
        out = []
        x += dx; y += dy
        while 0 <= x < cols and 0 <= y < rows:
            out.append((x, y))
            x += dx; y += dy
        return out


def _unit(a, b):
    return ((b[0] > a[0]) - (b[0] < a[0]), (b[1] > a[1]) - (b[1] < a[1]))


def _cells(pts):
    out = []
    for a, b in zip(pts, pts[1:]):
        d = _unit(a, b)
        p = a
        while p != b:
            out.append(p)
            p = (p[0] + d[0], p[1] + d[1])
    out.append(pts[-1])
    return out


class Level:
    def __init__(self, num, title, difficulty, cols, rows, arrows):
        self.num = num
        self.title = title
        self.difficulty = difficulty
        self.cols = cols
        self.rows = rows
        self.arrows = [a if isinstance(a, Arrow) else Arrow(a) for a in arrows]
        for i, a in enumerate(self.arrows):
            a.aid = i

    # -- validation -------------------------------------------------------

    def check_structure(self):
        seen = {}
        for a in self.arrows:
            if len(a.pts) < 2:
                raise ValueError(f"L{self.num} arrow {a.aid}: needs 2+ points")
            prev = None
            for p, q in zip(a.pts, a.pts[1:]):
                if (p[0] == q[0]) == (p[1] == q[1]):
                    raise ValueError(f"L{self.num} arrow {a.aid}: bad segment {p}->{q}")
                d = _unit(p, q)
                if prev is not None:
                    if d == prev:
                        raise ValueError(f"L{self.num} arrow {a.aid}: colinear join at {p}")
                    if d == (-prev[0], -prev[1]):
                        raise ValueError(f"L{self.num} arrow {a.aid}: 180 turn at {p}")
                prev = d
            if len(set(a.cells)) != len(a.cells):
                raise ValueError(f"L{self.num} arrow {a.aid}: self-overlap")
            for c in a.cells:
                if not (0 <= c[0] < self.cols and 0 <= c[1] < self.rows):
                    raise ValueError(f"L{self.num} arrow {a.aid}: {c} out of bounds")
                if c in seen:
                    raise ValueError(f"L{self.num}: arrows {seen[c]} and {a.aid} overlap at {c}")
                seen[c] = a.aid
        # streaming rule: the head may pass over a cell its own tail has
        # already vacated, but never one the body still occupies
        for a in self.arrows:
            if _self_blocks(a, a.ray(self.cols, self.rows)):
                raise ValueError(f"L{self.num} arrow {a.aid}: head blocked by own body")

    def blockers(self, arrow, remaining):
        occupied = set()
        for o in remaining:
            if o is arrow:
                continue
            occupied |= set(o.cells)
        return [c for c in arrow.ray(self.cols, self.rows) if c in occupied]

    def is_free(self, arrow, remaining):
        ray = arrow.ray(self.cols, self.rows)
        if _self_blocks(arrow, ray):
            return False
        occupied = set()
        for o in remaining:
            if o is not arrow:
                occupied.update(o.cells)
        return not any(c in occupied for c in ray)

    def solve_rounds(self):
        """Greedy: repeatedly remove every currently-free arrow."""
        remaining = list(self.arrows)
        rounds = []
        while remaining:
            occupied = {}
            for o in remaining:
                for c in o.cells:
                    occupied[c] = o
            free = []
            for a in remaining:
                ray = a.ray(self.cols, self.rows)
                blocked = _self_blocks(a, ray)
                if not blocked:
                    for c in ray:
                        o = occupied.get(c)
                        if o is not None and o is not a:
                            blocked = True
                            break
                if not blocked:
                    free.append(a)
            if not free:
                return rounds, remaining
            rounds.append([a.aid for a in free])
            fs = set(id(a) for a in free)
            remaining = [a for a in remaining if id(a) not in fs]
        return rounds, []

    def validate(self):
        self.check_structure()
        rounds, stuck = self.solve_rounds()
        if stuck:
            raise ValueError(f"L{self.num} UNSOLVABLE: stuck with {[a.aid for a in stuck]}")
        return rounds

    def stats(self):
        rounds = self.validate()
        lens = [a.body_len for a in self.arrows]
        bends = [a.bends for a in self.arrows]
        occupancy = sum(len(a.cells) for a in self.arrows) / (self.cols * self.rows)
        always_free = sum(1 for a in self.arrows if not a.ray(self.cols, self.rows))
        stubs = sum(1 for a in self.arrows if a.body_len < 2)
        return {
            "always_free": always_free,
            "stubs": stubs,
            "long": sum(1 for a in self.arrows if a.body_len >= 4),
            "multibend": sum(1 for a in self.arrows if a.bends >= 2),
            "arrows": len(self.arrows),
            "grid": f"{self.cols}x{self.rows}",
            "free0": len(rounds[0]),
            "depth": len(rounds),
            "len_avg": round(sum(lens) / len(lens), 1),
            "len_max": max(lens),
            "bends_avg": round(sum(bends) / len(bends), 2),
            "straight_pct": round(100 * bends.count(0) / len(bends)),
            "occupancy": round(occupancy, 2),
            "rounds": rounds,
        }


# --------------------------------------------------------------------------
# generator
# --------------------------------------------------------------------------

class Spec:
    """Design brief for one level."""

    def __init__(self, num, title, difficulty, cols, rows, target,
                 seg_range=(1, 4), bend_weights=(0.30, 0.38, 0.22, 0.10),
                 min_depth=2, max_free_start=None, seed=None,
                 long_arrows=0, edge_bias=0.5, ideal_len=3, free_forever_max=0):
        self.ideal_len = ideal_len
        self.free_forever_max = free_forever_max
        self.num = num
        self.title = title
        self.difficulty = difficulty
        self.cols = cols
        self.rows = rows
        self.target = target
        self.seg_range = seg_range
        self.bend_weights = bend_weights   # P(0 bends), P(1), P(2), P(3)
        self.min_depth = min_depth
        self.max_free_start = max_free_start
        self.seed = seed
        self.long_arrows = long_arrows     # how many extra-long paths to force early
        self.edge_bias = edge_bias


def _random_shape(rnd, spec, force_long=False):
    """Return (bends, segment lengths) for a candidate arrow."""
    r = rnd.random()
    acc = 0.0
    bends = len(spec.bend_weights) - 1
    for i, w in enumerate(spec.bend_weights):
        acc += w
        if r <= acc:
            bends = i
            break
    lo, hi = spec.seg_range
    if force_long:
        bends = max(bends, 2)
        segs = [rnd.randint(max(2, lo + 1), hi + 2) for _ in range(bends + 1)]
    else:
        segs = [rnd.randint(lo, hi) for _ in range(bends + 1)]
    return bends, segs


def _build_candidate(rnd, spec, occupied, force_long=False, free_cells=None,
                     allow_border_head=False):
    """Lay one arrow on free cells, growing the longest prefix that fits.

    Rather than discarding a shape the moment a step is blocked, the walk
    stops at the last completed corner and keeps what it has - that is what
    lets long multi-bend snakes survive on a board that is already 85% full.
    """
    cols, rows = spec.cols, spec.rows
    bends, segs = _random_shape(rnd, spec, force_long)
    if free_cells:
        start = free_cells[rnd.randrange(len(free_cells))]
    else:
        start = (rnd.randrange(cols), rnd.randrange(rows))
    if start in occupied:
        return None
    d = DIRS[rnd.randrange(4)]
    pts = [start]
    cells = [start]
    cur = start
    for si, seglen in enumerate(segs):
        if si > 0:
            # alternate turn direction most of the time: an alternating
            # polyline cannot fold back onto itself, so long shapes survive
            turn_sign = 1 if rnd.random() < 0.75 else -1
            if si > 1:
                turn_sign *= (-1) ** si
            if d[0] != 0:
                d = (0, turn_sign)
            else:
                d = (turn_sign, 0)
        stepped = 0
        for _ in range(seglen):
            nxt = (cur[0] + d[0], cur[1] + d[1])
            if not (0 <= nxt[0] < cols and 0 <= nxt[1] < rows):
                break
            if nxt in occupied or nxt in cells:
                break
            cells.append(nxt)
            cur = nxt
            stepped += 1
        if stepped == 0:
            break                      # this leg could not start: keep the prefix
        pts.append(cur)
    if len(pts) < 2:
        return None
    arrow = Arrow(pts)
    if arrow.body_len < 2:
        return None                    # no lonely one-cell stubs
    ray = arrow.ray(cols, rows)
    if not ray and not allow_border_head:
        return None                    # a head on the border can never be blocked
    if _self_blocks(arrow, ray):
        return None
    return arrow


def _self_blocks(arrow, ray):
    """True if the arrow's own body still occupies its exit ray when it gets
    there. Streaming semantics: by the time the head reaches ray step j the
    body has advanced j cells, so own cell index k is clear iff k < j."""
    index = {c: k for k, c in enumerate(arrow.cells)}
    for j, c in enumerate(ray, start=1):
        k = index.get(c)
        if k is not None and k >= j:
            return True
    return False


def _ray_clear(arrow, spec, placed_cells):
    for c in arrow.ray(spec.cols, spec.rows):
        if c in placed_cells:
            return False
    return True


def _blocks_count(arrow, placed):
    """How many already-placed arrows this new arrow would block."""
    body = set(arrow.cells)
    n = 0
    for o in placed:
        if any(c in body for c in o.ray_cache):
            n += 1
    return n


def generate(spec, tries_per_arrow=2600, candidates=40):
    """Place arrows one at a time, each with an exit ray clear of everything
    already placed. Scoring adapts as the board fills: early arrows are long,
    bendy and cross the board (they become the deep, late-removed ones);
    late arrows are short with quick exits (they become the free openers)."""
    rnd = random.Random(spec.seed if spec.seed is not None else spec.num * 7919)
    placed = []
    placed_cells = set()
    long_left = spec.long_arrows
    border_left = max(spec.free_forever_max, spec.target // 3)
    keep_free = max(1, spec.max_free_start or 3)
    all_cells = [(x, y) for x in range(spec.cols) for y in range(spec.rows)]

    stalls = 0
    while len(placed) < spec.target and stalls < 6:
        free_cells = [c for c in all_cells if c not in placed_cells]
        if not free_cells:
            break
        fill = len(placed_cells) / float(spec.cols * spec.rows)
        # how much a long escape ray is worth right now: valuable while the
        # board is open, actively harmful once it is crowded
        ray_weight = spec.edge_bias * 0.30 * (1.0 - 2.2 * fill)
        ideal_len = spec.ideal_len
        # currently-free arrows are the giveaway openings; covering their rays
        # is what turns a scatter into a puzzle, so it dominates the score
        open_arrows = _free_now(placed)
        open_rays = [set(a.ray_cache) for a in open_arrows]
        surplus = max(0, len(open_arrows) - keep_free)
        cover_weight = 4.5 if surplus > 0 else 1.2
        shortlist = []
        found = 0
        for _ in range(tries_per_arrow):
            if found >= candidates:
                break
            force_long = long_left > 0 and found == 0
            cand = _build_candidate(rnd, spec, placed_cells, force_long, free_cells,
                                    allow_border_head=border_left > 0)
            if cand is None:
                continue
            cand.ray_cache = tuple(cand.ray(spec.cols, spec.rows))
            safe = _ray_clear(cand, spec, placed_cells)
            found += 1
            body = set(cand.cells)
            covers = sum(1 for ray in open_rays if body & ray)
            blocks = _blocks_count(cand, placed)
            ray_len = len(cand.ray(spec.cols, spec.rows))
            score = (covers * cover_weight
                     + blocks * 1.1
                     - abs(cand.body_len - ideal_len) * (1.1 + 2.6 * fill)
                     + cand.bends * 1.5
                     + ray_len * ray_weight
                     + rnd.random() * 0.8)
            if force_long:
                score += cand.body_len * 1.2
            shortlist.append((score, cand, safe))
        # take the best candidate whose board the solver can still finish;
        # ray-clear ones are accepted immediately, the rest are verified
        shortlist.sort(key=lambda t: -t[0])
        best = None
        for _score, cand, safe in shortlist[:6]:
            if safe:
                best = cand
                break
            trial = placed + [cand]
            if _solvable(trial, spec.cols, spec.rows):
                best = cand
                break
        if best is None:
            stalls += 1
            continue
        stalls = 0
        best.ray_cache = tuple(best.ray(spec.cols, spec.rows))
        if not best.ray_cache:
            border_left -= 1
        placed.append(best)
        placed_cells.update(best.cells)
        if long_left > 0 and best.body_len >= ideal_len + 2:
            long_left -= 1

    level = Level(spec.num, spec.title, spec.difficulty, spec.cols, spec.rows, placed)
    _degift(level, spec)
    # de-gifting frees cells, so pack once more and re-cap the new openings
    placed_cells = set()
    for a in level.arrows:
        a.ray_cache = tuple(a.ray(spec.cols, spec.rows))
        placed_cells.update(a.cells)
    _cap_free_arrows(rnd, spec, level.arrows, placed_cells, all_cells)
    return Level(spec.num, spec.title, spec.difficulty, spec.cols, spec.rows, level.arrows)


def _free_now(placed):
    """Arrows whose exit ray is clear of every other placed arrow."""
    occupied = {}
    for o in placed:
        for c in o.cells:
            occupied[c] = o
    free = []
    for a in placed:
        if _self_blocks(a, a.ray_cache):
            continue
        if not any((occupied.get(c) not in (None, a)) for c in a.ray_cache):
            free.append(a)
    return free


def _cap_free_arrows(rnd, spec, placed, placed_cells, all_cells, rounds=260):
    """Place extra arrows that sit on the exit rays of currently-free arrows.

    Each capper is placed last, so it is removed first - the construction
    invariant still holds - but it takes several giveaway openings off the
    board. This is what turns a loose scatter into a puzzle: density rises
    and the player must find the one or two real starting moves.
    """
    keep = max(1, spec.max_free_start or 3)
    # cappers must fit the leftover gaps, so they use their own tiny shapes
    small = Spec(spec.num, spec.title, spec.difficulty, spec.cols, spec.rows,
                 spec.target, seg_range=(1, 2),
                 bend_weights=(0.45, 0.45, 0.10, 0.0), ideal_len=2)
    for _ in range(rounds):
        free = _free_now(placed)
        if len(free) <= keep and len(placed) >= spec.target:
            break
        free_rays = [(a, set(a.ray_cache)) for a in free]
        free_cells = [c for c in all_cells if c not in placed_cells]
        if not free_cells:
            break
        best = None
        best_score = -1
        for _ in range(2400):
            cand = _build_candidate(rnd, small, placed_cells, False, free_cells,
                                    allow_border_head=False)
            if cand is None or not _ray_clear(cand, small, placed_cells):
                continue
            body = set(cand.cells)
            blocks = sum(1 for a, ray in free_rays if body & ray)
            if blocks == 0 and len(placed) >= spec.target:
                continue
            score = blocks * 3.0 - abs(cand.body_len - 2) * 0.6 \
                + cand.bends * 1.0 + rnd.random() * 0.5
            if score > best_score:
                best_score = score
                best = cand
        if best is None:
            break
        best.ray_cache = best.ray(spec.cols, spec.rows)
        placed.append(best)
        placed_cells.update(best.cells)


def _solvable(arrows, cols, rows):
    """Greedy solve over a candidate arrow list. Fast path used by the
    generator: the reverse-placement invariant is *sufficient* for
    solvability but not necessary, so the generator proposes denser boards
    and asks this oracle whether they still come apart."""
    owner = {}
    for i, a in enumerate(arrows):
        for c in a.cells:
            if c in owner:
                return False                      # bodies overlap
            owner[c] = i
    rays = [a.ray_cache or tuple(a.ray(cols, rows)) for a in arrows]
    for i, a in enumerate(arrows):
        if _self_blocks(a, rays[i]):
            return False
    alive = [True] * len(arrows)
    left = len(arrows)
    while left:
        moved = False
        for i, a in enumerate(arrows):
            if not alive[i]:
                continue
            blocked = False
            for c in rays[i]:
                o = owner.get(c)
                if o is not None and o != i and alive[o]:
                    blocked = True
                    break
            if not blocked:
                alive[i] = False
                left -= 1
                moved = True
        if not moved:
            return False
    return True


def _shorten(arrow):
    """Pull an arrow's head back one cell, returning new points or None.

    A head sitting on the border has an empty exit ray and can never be
    blocked, so it is a permanent giveaway. Retreating it one cell gives the
    ray something to pass through - and frees a cell for another arrow.
    """
    pts = list(arrow.pts)
    a, b = pts[-2], pts[-1]
    d = _unit(a, b)
    nb = (b[0] - d[0], b[1] - d[1])
    if nb == a:
        # that leg is gone; drop it and inherit the previous direction
        if len(pts) < 3:
            return None
        pts = pts[:-1]
    else:
        pts[-1] = nb
    trial = Arrow(pts)
    if trial.body_len < 2:
        return None
    return pts


def _degift(level, spec, rounds=40):
    """Shorten permanent-giveaway arrows while the board still solves."""
    for _ in range(rounds):
        gifts = [a for a in level.arrows if not a.ray(level.cols, level.rows)]
        if len(gifts) <= spec.free_forever_max:
            break
        progress = False
        for a in gifts:
            pts = _shorten(a)
            if pts is None:
                continue
            keep = a.pts
            a.pts = [tuple(p) for p in pts]
            a.head_dir = _unit(a.pts[-2], a.pts[-1])
            a.cells = _cells(a.pts)
            a.ray_cache = tuple(a.ray(level.cols, level.rows))
            try:
                level.validate()
                progress = True
            except ValueError:
                a.pts = keep                       # revert
                a.head_dir = _unit(a.pts[-2], a.pts[-1])
                a.cells = _cells(a.pts)
                a.ray_cache = tuple(a.ray(level.cols, level.rows))
        if not progress:
            break
    return level


def generate_tuned(spec, attempts=90):
    """Generate repeatedly and keep the board that best meets the brief.

    Quality bars are preferences, not hard gates - a level is always produced,
    ranked by: hitting the arrow target, then dependency depth, then a healthy
    mix of bends and lengths, then fewer giveaway free arrows at the start.
    """
    best = None
    best_key = None
    base_seed = spec.seed if spec.seed is not None else spec.num * 7919
    for i in range(attempts):
        s = Spec(spec.num, spec.title, spec.difficulty, spec.cols, spec.rows,
                 spec.target, spec.seg_range, spec.bend_weights, spec.min_depth,
                 spec.max_free_start, seed=base_seed + i * 101,
                 long_arrows=spec.long_arrows, edge_bias=spec.edge_bias,
                 ideal_len=spec.ideal_len)
        lv = generate(s)
        if not lv.arrows:
            continue
        try:
            st = lv.stats()
        except ValueError as e:
            print(f"    (attempt {i} rejected: {e})")
            continue
        key = (
            -max(0, st["always_free"] - spec.free_forever_max),   # no permanent gifts
            -max(0, st["free0"] - (spec.max_free_start or 99)),   # few openings
            min(st["arrows"], spec.target),                        # density target
            st["depth"] >= spec.min_depth,
            st["multibend"],
            st["depth"],
            -abs(st["len_avg"] - spec.ideal_len),
        )
        if best_key is None or key > best_key:
            best_key = key
            best = lv
        if (st["arrows"] >= spec.target and st["depth"] >= spec.min_depth
                and st["stubs"] == 0 and st["always_free"] <= spec.free_forever_max
                and st["multibend"] >= st["arrows"] // 4
                and (not spec.max_free_start or st["free0"] <= spec.max_free_start)):
            break
    if best is None:
        raise RuntimeError(f"L{spec.num}: could not generate a valid board")
    return best


# --------------------------------------------------------------------------
# the 10-level brief
# --------------------------------------------------------------------------

BRIEF = [
    #    n  title            diff       cols rows target segs   bend weights (0,1,2,3,4)      depth freeMax long edge ideal borderQuota
    Spec(1, "First Flight",  "EASY",     5,  6,   5, (2, 3), (0.40, 0.60, 0.00, 0.00, 0.00), 3, 2, 1, 0.5, 3, 1),
    Spec(2, "Twin Bends",    "EASY",     5,  7,   7, (1, 3), (0.25, 0.50, 0.25, 0.00, 0.00), 3, 2, 1, 0.5, 3, 1),
    Spec(3, "Interlock",     "EASY",     6,  8,   9, (1, 3), (0.20, 0.42, 0.30, 0.08, 0.00), 4, 2, 2, 0.5, 3, 1),
    Spec(4, "Decoys",        "NORMAL",   6,  9,  11, (1, 3), (0.18, 0.40, 0.30, 0.12, 0.00), 5, 2, 2, 0.5, 3, 0),
    Spec(5, "Crossroads",    "NORMAL",   7,  9,  14, (1, 3), (0.15, 0.38, 0.32, 0.15, 0.00), 6, 3, 3, 0.5, 3, 0),
    Spec(6, "Combs",         "NORMAL",   8, 11,  17, (1, 3), (0.12, 0.34, 0.34, 0.18, 0.02), 7, 3, 3, 0.4, 3, 0),
    Spec(7, "Serpents",      "HARD",     8, 12,  20, (1, 4), (0.10, 0.30, 0.34, 0.22, 0.04), 8, 3, 4, 0.4, 3, 0),
    Spec(8, "Gridlock",      "HARD",     8, 14,  24, (1, 3), (0.10, 0.30, 0.34, 0.22, 0.04), 9, 4, 4, 0.4, 3, 0),
    Spec(9, "Weave",         "EXPERT",   9, 14,  28, (1, 3), (0.10, 0.28, 0.34, 0.24, 0.04), 10, 4, 4, 0.4, 3, 0),
    Spec(10, "Grand Escape", "EXPERT",   9, 16,  33, (1, 4), (0.08, 0.28, 0.34, 0.24, 0.06), 11, 5, 5, 0.4, 3, 0),
]


# --------------------------------------------------------------------------
# emit
# --------------------------------------------------------------------------

def emit_kotlin(levels, path=KOTLIN_OUT):
    out = [
        "package com.veergames.veer.core",
        "",
        "/**",
        " * The 10 demo levels.",
        " *",
        " * GENERATED by tools/design_levels.py - do not hand-edit. Adjust the BRIEF",
        " * in that tool and re-run it; it regenerates, proves every board solvable",
        " * and rewrites this file. Adding levels is a one-line change to the brief.",
        " */",
        "object Levels {",
        "",
        "    private fun a(vararg p: Int) = p",
        "",
        "    val all: List<LevelSpec> = listOf(",
    ]
    for lv in levels:
        out.append(f'        LevelSpec({lv.num}, "{lv.title}", Difficulty.{lv.difficulty}, '
                   f'{lv.cols}, {lv.rows}, listOf(')
        for a in lv.arrows:
            flat = ", ".join(f"{x}, {y}" for x, y in a.pts)
            out.append(f"            a({flat}),")
        out.append("        )),")
    out += ["    )", "}", ""]
    with open(path, "w") as f:
        f.write("\n".join(out))
    return path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--preview", action="store_true", help="write PNG previews")
    ap.add_argument("--stats", action="store_true", help="print stats only")
    ap.add_argument("--skin", default="classic", help="preview skin")
    args = ap.parse_args()

    levels = []
    print("generating levels (guaranteed-solvable construction)...")
    for spec in BRIEF:
        lv = generate_tuned(spec)
        st = lv.stats()
        levels.append(lv)
        print(f"  L{lv.num:<2} {lv.title:<13} {st['grid']:>6} n={st['arrows']:<3} "
              f"depth={st['depth']:<2} free0={st['free0']:<2} gift={st['always_free']} "
              f"stub={st['stubs']} len={st['len_avg']}/{st['len_max']:<2} "
              f"bend={st['bends_avg']} 2bend={st['multibend']:<2} fill={st['occupancy']}")

    targets = [(1, 4, 5), (2, 6, 7), (3, 8, 10), (4, 10, 12), (5, 12, 15),
               (6, 15, 18), (7, 18, 22), (8, 22, 26), (9, 25, 30), (10, 30, 99)]
    ok = True
    for (n, lo, hi), lv in zip(targets, levels):
        c = len(lv.arrows)
        if not (lo <= c <= hi):
            print(f"  !! L{n} arrow count {c} outside requested {lo}-{hi}")
            ok = False
    if args.stats:
        return 0 if ok else 1

    p = emit_kotlin(levels)
    print(f"wrote {os.path.relpath(p, os.path.join(HERE, '..'))}")

    if args.preview:
        sys.path.insert(0, HERE)
        from preview import render_level
        os.makedirs(PREVIEW_DIR, exist_ok=True)
        for lv in levels:
            render_level(lv, os.path.join(PREVIEW_DIR, f"level{lv.num:02d}.png"),
                         skin=args.skin)
        print(f"previews in {PREVIEW_DIR}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
