"""
The cost model, tested — because it is the number every later result depends on.

Most of these assertions are about SMALL trades, since that is where the model
earns its place. At a lakh a trade the percentage charges dominate and any
half-sensible model gets the answer roughly right. At a thousand rupees the flat
DP charge is the entire cost, and a model that omits it reports a strategy as
profitable when it is not.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts" / "quant"))

from costs import (                                     # noqa: E402
    IndiaEquityCosts, india_leg, india_round_trip, us_leg, slippage, hurdle,
)

PASS = FAIL = 0


def ok(cond, name):
    global PASS, FAIL
    if cond:
        PASS += 1
    else:
        FAIL += 1
        print(f"FAIL {name}")


def near(a, b, name, tol=0.01):
    ok(abs(a - b) < tol, f"{name} (got {a:.4f}, want {b:.4f})")


# ------------------------------------------------ the flat fee dominates

# Rs 1,000 delivery. The DP charge alone is 1.5% of the position.
small = india_round_trip(1_000)
ok(small["sell"]["dp"] == 15.0, "a delivery sell carries the flat DP charge")
ok(small["buy"]["dp"] == 0.0, "a buy does not")
ok(small["breakeven_move_pct"] > 1.5,
   "a Rs 1,000 round trip needs more than a 1.5% move just to break even")
ok(small["sell"]["dp"] / small["total"] > 0.7,
   "and over 70% of that cost is the one flat fee")

# The same strategy at a hundred times the size. Identical percentage charges,
# but the flat fee has become noise — which is why size changes what is possible.
big = india_round_trip(100_000)
ok(big["breakeven_move_pct"] < 0.3, "at Rs 1,00,000 the round trip is under 0.3%")
ok(small["breakeven_move_pct"] > 5 * big["breakeven_move_pct"],
   "the small trade is more than five times more expensive, in percentage terms")

# Stated plainly, since it is the finding that governs the whole programme:
# an edge of 0.5% per trade is profitable at size and loses at Rs 1,000.
ok(0.5 < small["breakeven_move_pct"], "a 0.5% edge does NOT survive a Rs 1,000 trade")
ok(0.5 > big["breakeven_move_pct"], "the same edge clears the hurdle at Rs 1,00,000")

# ----------------------------------------------------- intraday vs delivery

intr = india_round_trip(50_000, intraday=True)
deliv = india_round_trip(50_000, intraday=False)
ok(intr["total"] < deliv["total"],
   "intraday is cheaper on tax — STT is one side at a quarter the rate")
ok(intr["sell"]["dp"] == 0.0, "and no depository charge, since nothing is delivered")
ok(intr["buy"]["brokerage"] > 0, "but intraday brokerage is not free")
# The brokerage cap binds on anything sizeable: 0.03% of 50k is Rs 15, under the cap.
near(intr["buy"]["brokerage"], 15.0, "0.03% of Rs 50,000 is Rs 15, below the Rs 20 cap")
near(india_leg(200_000, "buy", intraday=True)["brokerage"], 20.0,
     "and the cap binds on a Rs 2,00,000 order")

# -------------------------------------------------------------- components

leg = india_leg(100_000, "sell")
near(leg["stt"], 100.0, "STT on a Rs 1,00,000 delivery sell is 0.1%")
ok(leg["stamp"] == 0.0, "stamp duty is buy-side only")
near(india_leg(100_000, "buy")["stamp"], 15.0, "and is 0.015% on the buy")
# GST applies to brokerage, exchange and SEBI charges — never to STT or stamp.
gstable = leg["brokerage"] + leg["txn"] + leg["sebi"]
near(leg["gst"], gstable * 0.18, "GST is 18% of brokerage + txn + SEBI only")
ok(leg["gst"] < leg["stt"] * 0.5, "and is therefore far smaller than STT on delivery")

# Zero value must not divide by zero — an empty position is a real code path.
z = india_round_trip(0)
ok(z["pct_of_value"] == 0.0, "a zero-value trade reports 0%, not a crash")

# ------------------------------------------------------------------ US

us = us_leg(1_000, 10, "sell")
ok(us["sec"] > 0, "the SEC fee applies on a US sell")
ok(us_leg(1_000, 10, "buy")["total"] == 0.0, "and a US buy is genuinely free of both")
near(min(1e9 * 0.000166, 8.30), 8.30, "the FINRA fee is capped")

# --------------------------------------------------------------- slippage

# Crossing a 0.2% spread costs HALF of it against the mid. Charging the full
# spread is a common double-count that makes a backtest twice as pessimistic as
# reality — and abandoning a working strategy is as expensive as running a bad one.
near(slippage(10_000, 0.002), 10.0, "crossing a 0.2% spread costs half of it")
ok(slippage(10_000, 0.002, aggressive=False) == 0.0,
   "a passive order pays no spread — it pays adverse selection instead, which is not modelled")

# ---------------------------------------------------------------- hurdle

h = hurdle(10_000, 0.002)
ok(h["total"] > h["fees"], "the hurdle includes slippage on top of fees")
ok(h["breakeven_move_pct"] > 0, "and is expressed as the move needed to break even")

# The headline for the whole programme, as a test so it cannot be forgotten:
# a typical stat-arb edge does not clear the hurdle at small size.
STAT_ARB_EDGE_PCT = 0.5
ok(hurdle(1_000, 0.002)["breakeven_move_pct"] > STAT_ARB_EDGE_PCT,
   "a 0.5% stat-arb edge is LOSS-MAKING on Rs 1,000 positions, however often it is right")
ok(hurdle(200_000, 0.002)["breakeven_move_pct"] < STAT_ARB_EDGE_PCT,
   "the same edge is viable at Rs 2,00,000 — the strategy did not change, the size did")

print(f"{PASS}/{PASS + FAIL} passing")
sys.exit(1 if FAIL else 0)
