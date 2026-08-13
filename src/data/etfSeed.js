// What is actually inside the funds — the seed.
//
// Every weight here was read off a published holdings list on the date stamped
// beside it. Nothing is estimated, interpolated or remembered; a fund with no
// entry in this file is reported by the X-ray as UNCOVERED rather than guessed
// at, because a plausible-looking made-up weight is worse than a blank.
//
// WHY ONLY THE TOP 25
// Composition drifts slowly for index funds and this is a top-25 list, not the
// fund. `covered` below is computed from the weights themselves rather than
// asserted, so the X-ray always knows exactly how much of each fund it can see
// and says so on screen. The unlisted remainder is real money in real companies
// and is reported as its own line — never dropped, which would shrink the
// denominator and inflate every percentage.
//
// WHY IT IS CHECKED IN RATHER THAN FETCHED
// There is no free holdings API this app has a key for. A dated file that is
// obviously stale beats a live call that silently fails and renders an empty
// screen. `asOf` is shown in the UI so the age is visible, and anything written
// to memory.etf_holdings overrides the matching entry here — so refreshing is a
// payload, not a code change.

export const ETF_SEED = {
  VOO: {
    name: 'Vanguard S&P 500 ETF',
    asOf: '2026-06-30',
    source: 'stockanalysis.com/etf/voo/holdings',
    count: 520,
    holdings: [
      ['NVDA', 'NVIDIA', 7.50], ['AAPL', 'Apple', 6.58], ['MSFT', 'Microsoft', 4.29],
      ['AMZN', 'Amazon', 3.61], ['GOOGL', 'Alphabet', 3.24], ['AVGO', 'Broadcom', 2.77],
      ['GOOG', 'Alphabet', 2.58], ['MU', 'Micron', 2.01], ['META', 'Meta Platforms', 1.91],
      ['TSLA', 'Tesla', 1.83], ['LLY', 'Eli Lilly', 1.47], ['AMD', 'AMD', 1.47],
      ['BRK.B', 'Berkshire Hathaway', 1.42], ['JPM', 'JPMorgan Chase', 1.25],
      ['INTC', 'Intel', 1.02], ['JNJ', 'Johnson & Johnson', 0.95],
      ['AMAT', 'Applied Materials', 0.89], ['XOM', 'ExxonMobil', 0.88],
      ['V', 'Visa', 0.86], ['LRCX', 'Lam Research', 0.84], ['WMT', 'Walmart', 0.77],
      ['CAT', 'Caterpillar', 0.76], ['CSCO', 'Cisco', 0.72], ['ABBV', 'AbbVie', 0.69],
      ['COST', 'Costco', 0.64],
    ],
  },

  SPMO: {
    name: 'Invesco S&P 500 Momentum ETF',
    asOf: '2026-08-06',
    source: 'stockanalysis.com/etf/spmo/holdings',
    count: 102,
    holdings: [
      ['MU', 'Micron', 9.82], ['NVDA', 'NVIDIA', 8.85], ['AVGO', 'Broadcom', 7.19],
      ['GOOGL', 'Alphabet', 4.56], ['JNJ', 'Johnson & Johnson', 4.43], ['AMD', 'AMD', 3.96],
      ['GOOG', 'Alphabet', 3.64], ['LRCX', 'Lam Research', 3.43], ['XOM', 'ExxonMobil', 2.99],
      ['INTC', 'Intel', 2.59], ['CAT', 'Caterpillar', 2.57], ['AMAT', 'Applied Materials', 2.09],
      ['CSCO', 'Cisco', 2.04], ['GE', 'GE Aerospace', 1.91], ['SNDK', 'Sandisk', 1.84],
      ['STX', 'Seagate', 1.84], ['RTX', 'RTX', 1.75], ['WDC', 'Western Digital', 1.52],
      ['APH', 'Amphenol', 1.50], ['GS', 'Goldman Sachs', 1.45], ['KLAC', 'KLA', 1.41],
      ['PLTR', 'Palantir', 1.39], ['GEV', 'GE Vernova', 1.39],
      ['PM', 'Philip Morris', 1.38], ['KO', 'Coca-Cola', 1.34],
    ],
  },

  QQQM: {
    name: 'Invesco NASDAQ 100 ETF',
    asOf: '2026-08-06',
    source: 'stockanalysis.com/etf/qqqm/holdings',
    count: 107,
    holdings: [
      ['NVDA', 'NVIDIA', 8.46], ['AAPL', 'Apple', 7.32], ['MSFT', 'Microsoft', 5.92],
      ['AMZN', 'Amazon', 4.67], ['MU', 'Micron', 4.38], ['AMD', 'AMD', 3.51],
      ['GOOGL', 'Alphabet', 3.32], ['AVGO', 'Broadcom', 3.18], ['GOOG', 'Alphabet', 3.10],
      ['META', 'Meta Platforms', 2.79], ['TSLA', 'Tesla', 2.55], ['WMT', 'Walmart', 2.41],
      ['INTC', 'Intel', 2.21], ['CSCO', 'Cisco', 2.10], ['COST', 'Costco', 1.85],
      ['AMAT', 'Applied Materials', 1.84], ['LRCX', 'Lam Research', 1.68],
      ['PLTR', 'Palantir', 1.58], ['NFLX', 'Netflix', 1.37], ['PANW', 'Palo Alto Networks', 1.29],
      ['TXN', 'Texas Instruments', 1.12], ['KLAC', 'KLA', 1.11], ['LIN', 'Linde', 1.00],
      ['SPCX', 'SpaceX', 0.97], ['AMGN', 'Amgen', 0.96],
    ],
  },

  QQQ: {
    name: 'Invesco QQQ Trust Series I',
    asOf: '2026-08-10',
    source: 'stockanalysis.com/etf/qqq/holdings',
    count: 105,
    holdings: [
      ['NVDA', 'NVIDIA', 8.36], ['AAPL', 'Apple', 7.11], ['MSFT', 'Microsoft', 5.94],
      ['AMZN', 'Amazon', 4.65], ['MU', 'Micron', 4.29], ['AMD', 'AMD', 3.39],
      ['GOOGL', 'Alphabet', 3.18], ['AVGO', 'Broadcom', 3.13], ['GOOG', 'Alphabet', 2.97],
      ['META', 'Meta Platforms', 2.82], ['TSLA', 'Tesla', 2.64], ['WMT', 'Walmart', 2.42],
      ['INTC', 'Intel', 2.15], ['CSCO', 'Cisco', 2.08], ['COST', 'Costco', 1.84],
      ['AMAT', 'Applied Materials', 1.83], ['PLTR', 'Palantir', 1.76],
      ['LRCX', 'Lam Research', 1.71], ['NFLX', 'Netflix', 1.38],
      ['PANW', 'Palo Alto Networks', 1.37], ['KLAC', 'KLA', 1.15],
      ['TXN', 'Texas Instruments', 1.12], ['SPCX', 'SpaceX', 1.12], ['LIN', 'Linde', 0.99],
      ['CRWD', 'CrowdStrike', 0.99],
    ],
  },

  SCHD: {
    name: 'Schwab US Dividend Equity ETF',
    asOf: '2026-08-06',
    source: 'stockanalysis.com/etf/schd/holdings',
    count: 103,
    holdings: [
      ['ABT', 'Abbott Laboratories', 4.64], ['AMGN', 'Amgen', 4.61], ['HD', 'Home Depot', 4.31],
      ['MRK', 'Merck', 4.28], ['KO', 'Coca-Cola', 4.22], ['UNH', 'UnitedHealth', 4.19],
      ['PG', 'Procter & Gamble', 4.00], ['VZ', 'Verizon', 3.81], ['CVX', 'Chevron', 3.76],
      ['PEP', 'PepsiCo', 3.72], ['COP', 'ConocoPhillips', 3.53],
      ['TXN', 'Texas Instruments', 3.44], ['BMY', 'Bristol-Myers Squibb', 3.27],
      ['LMT', 'Lockheed Martin', 2.95], ['MO', 'Altria', 2.88], ['ADP', 'ADP', 2.72],
      ['ACN', 'Accenture', 2.64], ['BX', 'Blackstone', 2.55], ['QCOM', 'Qualcomm', 2.41],
      ['CMCSA', 'Comcast', 2.22], ['UPS', 'UPS', 2.03], ['SLB', 'SLB', 1.88],
      ['EOG', 'EOG Resources', 1.80], ['TGT', 'Target', 1.69], ['FAST', 'Fastenal', 1.45],
    ],
  },
};

// Funds this app knows are funds but has no composition for. Listing them is
// what makes the difference between "we could not decompose this" and "this is
// a company" — the second is a lie that would put an ETF in the concentration
// table as if it were a single stock.
export const KNOWN_FUNDS = new Set([
  ...Object.keys(ETF_SEED),
  'SPY', 'IVV', 'VTI', 'VT', 'VXUS', 'VEA', 'VWO', 'ARKK', 'SCHG', 'SCHX',
  'VUG', 'VTV', 'IWM', 'DIA', 'INDA', 'SMH', 'SOXX', 'XLK', 'XLF', 'XLE',
  'NIFTYBEES', 'JUNIORBEES', 'BANKBEES', 'MON100', 'MAFANG',
]);
