"""
What a trade actually costs.

This is phase one, before any strategy, because it decides whether the rest of
the programme is worth writing. A backtest reporting gross returns is not
evidence of anything — it is a description of a market that does not charge you
to participate in it.

THE FLAT FEE IS THE WHOLE STORY AT SMALL SIZE.

Percentage charges scale with the trade, so they hurt equally at every size.
The DP charge does not: it is roughly Rs 15 per scrip per SELL, whatever the
position is worth. On Rs 1,00,000 that is 0.015% and invisible. On Rs 1,000 it
is 1.5% and it is the entire trade. Every retail strategy that "works in
backtest and loses live" at small capital dies here, and it dies quietly,
because the backtest was measuring a different game.

So: this module exists to be called on every simulated fill, and every result
in this programme is reported net. There is no gross-return mode. Adding one
would be adding a way to be wrong.

RATES CHANGE. Everything below is a parameter with a dated default, not a
constant. STT rates, stamp duty and exchange charges are set by regulation and
have all moved in the last few years — check them against a real contract note
before trusting a number this produces. The structure is the durable part.
"""

from dataclasses import dataclass, replace


# ---------------------------------------------------------------- India

@dataclass(frozen=True)
class IndiaEquityCosts:
    """Charges on Indian cash-segment equity, as of August 2026.

    Defaults follow the common discount-broker structure. Verify against your
    own contract note — INDmoney, Zerodha and Groww differ on brokerage and on
    whether DP charges are levied per scrip or per transaction.
    """

    # Brokerage. Delivery is free at most discount brokers; intraday is the
    # lower of a percentage and a flat cap, which matters enormously at small
    # size — a Rs 20 cap on a Rs 1,000 trade is 2%.
    delivery_brokerage_pct: float = 0.0
    intraday_brokerage_pct: float = 0.0003        # 0.03%
    intraday_brokerage_cap: float = 20.0          # rupees per executed order

    # Securities Transaction Tax. Delivery: both sides. Intraday: SELL only.
    stt_delivery_pct: float = 0.001               # 0.1% each side
    stt_intraday_sell_pct: float = 0.00025        # 0.025% on sell

    # Exchange transaction charge and SEBI turnover fee, both sides.
    exchange_txn_pct: float = 0.0000297           # NSE ~0.00297%
    sebi_pct: float = 0.000001                    # Rs 10 per crore

    # Stamp duty, BUY side only.
    stamp_delivery_pct: float = 0.00015           # 0.015%
    stamp_intraday_pct: float = 0.00003           # 0.003%

    # GST on brokerage + exchange + SEBI (not on STT or stamp).
    gst_pct: float = 0.18

    # The one that ruins small trades. Charged per scrip on the SELL leg of a
    # delivery trade, regardless of quantity or value.
    dp_charge_flat: float = 15.0


def india_leg(value: float, side: str, *, intraday: bool = False,
              c: IndiaEquityCosts = IndiaEquityCosts()) -> dict:
    """Cost of ONE leg (a buy or a sell) on an Indian equity trade.

    `value` is quantity x price in rupees. Returns every component separately,
    because a total tells you what you paid and a breakdown tells you what to
    change — and at small size the answer is almost always the flat fee.
    """
    side = side.lower()
    if side not in ("buy", "sell"):
        raise ValueError("side must be 'buy' or 'sell'")
    if value < 0:
        raise ValueError("value cannot be negative")

    if intraday:
        brokerage = min(value * c.intraday_brokerage_pct, c.intraday_brokerage_cap)
        stt = value * c.stt_intraday_sell_pct if side == "sell" else 0.0
        stamp = value * c.stamp_intraday_pct if side == "buy" else 0.0
        dp = 0.0
    else:
        brokerage = value * c.delivery_brokerage_pct
        stt = value * c.stt_delivery_pct
        stamp = value * c.stamp_delivery_pct if side == "buy" else 0.0
        # Delivery sells attract the depository charge. Buys do not.
        dp = c.dp_charge_flat if side == "sell" else 0.0

    txn = value * c.exchange_txn_pct
    sebi = value * c.sebi_pct
    gst = (brokerage + txn + sebi) * c.gst_pct

    total = brokerage + stt + txn + sebi + stamp + gst + dp
    return {
        "brokerage": brokerage, "stt": stt, "txn": txn, "sebi": sebi,
        "stamp": stamp, "gst": gst, "dp": dp,
        "total": total,
        "pct_of_value": (total / value) if value else 0.0,
    }


def india_round_trip(value: float, *, intraday: bool = False,
                     c: IndiaEquityCosts = IndiaEquityCosts()) -> dict:
    """Buy and sell the same value. The number a strategy must beat.

    Reported as a percentage as well as rupees, because the percentage is the
    hurdle rate: an edge smaller than this loses money on every trade no matter
    how often it is right.
    """
    buy = india_leg(value, "buy", intraday=intraday, c=c)
    sell = india_leg(value, "sell", intraday=intraday, c=c)
    total = buy["total"] + sell["total"]
    return {
        "buy": buy, "sell": sell, "total": total,
        "pct_of_value": (total / value) if value else 0.0,
        # The move required just to return to flat, before any profit.
        "breakeven_move_pct": (total / value * 100) if value else 0.0,
    }


# ------------------------------------------------------------------ US

@dataclass(frozen=True)
class USEquityCosts:
    """US equities held from India, the INDmoney route.

    Brokerage is typically zero, which makes this look cheap and it is not: the
    cost is the currency conversion on the way in, and it is charged on the
    REMITTANCE rather than the trade. A strategy that turns over frequently
    inside the US account pays it once; one that funds each trade separately
    pays it every time.

    TCS is not a cost at all — it is tax collected at source, creditable against
    your return. Counting it as a fee overstates the drag, so it is tracked
    separately and excluded from `total`.
    """
    brokerage_per_trade: float = 0.0
    sec_fee_sell_pct: float = 0.0000278           # SEC fee, sell side
    finra_taf_per_share: float = 0.000166         # capped per order
    finra_taf_cap: float = 8.30
    fx_markup_pct: float = 0.005                  # on remittance, not per trade
    tcs_pct: float = 0.20                         # >Rs 10L/yr, creditable


def us_leg(value_usd: float, shares: float, side: str,
           c: USEquityCosts = USEquityCosts()) -> dict:
    side = side.lower()
    brokerage = c.brokerage_per_trade
    sec = value_usd * c.sec_fee_sell_pct if side == "sell" else 0.0
    taf = min(shares * c.finra_taf_per_share, c.finra_taf_cap) if side == "sell" else 0.0
    total = brokerage + sec + taf
    return {
        "brokerage": brokerage, "sec": sec, "taf": taf, "total": total,
        "pct_of_value": (total / value_usd) if value_usd else 0.0,
    }


# ------------------------------------------------------------- slippage

def slippage(value: float, spread_pct: float, *, aggressive: bool = True,
             impact_coeff: float = 0.0) -> float:
    """What the fill costs beyond the fees.

    Crossing the spread costs HALF of it against the mid, not the whole spread —
    a common double-count that makes backtests twice as pessimistic as reality
    and leads to abandoning strategies that would have worked.

    A passive order pays no spread and takes a different risk: it may not fill,
    and it fills preferentially when the market is moving against you. That is
    adverse selection, it is not a cost you can put in a spreadsheet, and it is
    the reason the market-making idea was dropped. Modelled here as zero, with
    the caveat that zero is optimistic.
    """
    if spread_pct < 0:
        raise ValueError("spread cannot be negative")
    cross = value * spread_pct / 2 if aggressive else 0.0
    # Square-root impact: doubling size costs about 1.41x, not 2x. Zero by
    # default because at retail size on a liquid scrip it genuinely is.
    impact = impact_coeff * (value ** 0.5) if impact_coeff else 0.0
    return cross + impact


def hurdle(value: float, spread_pct: float, *, intraday: bool = False,
           c: IndiaEquityCosts = IndiaEquityCosts()) -> dict:
    """Everything a round trip costs, as the percentage move needed to break even.

    This is the number to put next to a strategy's average edge per trade. If
    the edge is smaller, the strategy loses money while being right, and no
    amount of accuracy fixes it.
    """
    fees = india_round_trip(value, intraday=intraday, c=c)
    slip = slippage(value, spread_pct) * 2      # both legs
    total = fees["total"] + slip
    return {
        "fees": fees["total"],
        "slippage": slip,
        "total": total,
        "breakeven_move_pct": (total / value * 100) if value else 0.0,
    }
