/**
 * A fixed NSE universe. `beta` is the loading on a single market factor,
 * `gamma` on the sector factor and `idio` is name-specific daily vol. The
 * synthetic provider draws returns from this factor model, which means the
 * correlation matrix the app computes is genuinely structured — an all-IT
 * watchlist really does score badly, and a spread one really does score well.
 */
export type Spec = {
  symbol: string;
  name: string;
  sector: string;
  mcap_cr: number;
  beta: number;
  gamma: number;
  idio: number;
  price: number;
};

export const UNIVERSE: Spec[] = [
  { symbol: "TCS",        name: "Tata Consultancy Services", sector: "IT",         mcap_cr: 1_420_000, beta: 0.78, gamma: 0.95, idio: 0.008, price: 3890 },
  { symbol: "INFY",       name: "Infosys",                   sector: "IT",         mcap_cr:   760_000, beta: 0.86, gamma: 1.00, idio: 0.009, price: 1610 },
  { symbol: "WIPRO",      name: "Wipro",                     sector: "IT",         mcap_cr:   270_000, beta: 0.83, gamma: 0.92, idio: 0.011, price: 512 },
  { symbol: "HCLTECH",    name: "HCL Technologies",          sector: "IT",         mcap_cr:   470_000, beta: 0.80, gamma: 0.90, idio: 0.009, price: 1735 },
  { symbol: "TECHM",      name: "Tech Mahindra",             sector: "IT",         mcap_cr:   160_000, beta: 0.92, gamma: 0.88, idio: 0.012, price: 1622 },
  { symbol: "LTIM",       name: "LTIMindtree",               sector: "IT",         mcap_cr:   170_000, beta: 0.88, gamma: 0.86, idio: 0.012, price: 5740 },

  { symbol: "HDFCBANK",   name: "HDFC Bank",                 sector: "Banking",    mcap_cr: 1_290_000, beta: 1.02, gamma: 1.00, idio: 0.008, price: 1690 },
  { symbol: "ICICIBANK",  name: "ICICI Bank",                sector: "Banking",    mcap_cr:   890_000, beta: 1.05, gamma: 0.98, idio: 0.009, price: 1265 },
  { symbol: "SBIN",       name: "State Bank of India",       sector: "Banking",    mcap_cr:   720_000, beta: 1.18, gamma: 0.86, idio: 0.011, price: 812 },
  { symbol: "AXISBANK",   name: "Axis Bank",                 sector: "Banking",    mcap_cr:   360_000, beta: 1.14, gamma: 0.95, idio: 0.011, price: 1148 },
  { symbol: "KOTAKBANK",  name: "Kotak Mahindra Bank",       sector: "Banking",    mcap_cr:   350_000, beta: 0.96, gamma: 0.90, idio: 0.010, price: 1762 },
  { symbol: "INDUSINDBK", name: "IndusInd Bank",             sector: "Banking",    mcap_cr:   110_000, beta: 1.28, gamma: 0.84, idio: 0.015, price: 1420 },

  { symbol: "SUNPHARMA",  name: "Sun Pharmaceutical",        sector: "Pharma",     mcap_cr:   410_000, beta: 0.62, gamma: 0.94, idio: 0.010, price: 1710 },
  { symbol: "CIPLA",      name: "Cipla",                     sector: "Pharma",     mcap_cr:   125_000, beta: 0.58, gamma: 0.92, idio: 0.011, price: 1548 },
  { symbol: "DRREDDY",    name: "Dr. Reddy's Laboratories",  sector: "Pharma",     mcap_cr:   105_000, beta: 0.60, gamma: 0.88, idio: 0.012, price: 1258 },
  { symbol: "DIVISLAB",   name: "Divi's Laboratories",       sector: "Pharma",     mcap_cr:   150_000, beta: 0.66, gamma: 0.82, idio: 0.014, price: 5610 },
  { symbol: "LUPIN",      name: "Lupin",                     sector: "Pharma",     mcap_cr:    95_000, beta: 0.64, gamma: 0.86, idio: 0.014, price: 2075 },

  { symbol: "MARUTI",     name: "Maruti Suzuki India",       sector: "Auto",       mcap_cr:   380_000, beta: 0.94, gamma: 0.93, idio: 0.011, price: 12180 },
  { symbol: "TATAMOTORS", name: "Tata Motors",               sector: "Auto",       mcap_cr:   280_000, beta: 1.32, gamma: 0.88, idio: 0.016, price: 745 },
  { symbol: "M&M",        name: "Mahindra & Mahindra",       sector: "Auto",       mcap_cr:   350_000, beta: 1.06, gamma: 0.90, idio: 0.012, price: 2860 },
  { symbol: "BAJAJ-AUTO", name: "Bajaj Auto",                sector: "Auto",       mcap_cr:   250_000, beta: 0.88, gamma: 0.84, idio: 0.013, price: 8940 },
  { symbol: "EICHERMOT",  name: "Eicher Motors",             sector: "Auto",       mcap_cr:   135_000, beta: 0.90, gamma: 0.80, idio: 0.014, price: 4930 },

  { symbol: "HINDUNILVR", name: "Hindustan Unilever",        sector: "FMCG",       mcap_cr:   560_000, beta: 0.52, gamma: 0.96, idio: 0.008, price: 2385 },
  { symbol: "ITC",        name: "ITC",                       sector: "FMCG",       mcap_cr:   540_000, beta: 0.61, gamma: 0.82, idio: 0.009, price: 432 },
  { symbol: "NESTLEIND",  name: "Nestle India",              sector: "FMCG",       mcap_cr:   215_000, beta: 0.48, gamma: 0.90, idio: 0.009, price: 2235 },
  { symbol: "BRITANNIA",  name: "Britannia Industries",      sector: "FMCG",       mcap_cr:   135_000, beta: 0.55, gamma: 0.88, idio: 0.010, price: 5620 },
  { symbol: "DABUR",      name: "Dabur India",               sector: "FMCG",       mcap_cr:    90_000, beta: 0.57, gamma: 0.86, idio: 0.011, price: 508 },

  { symbol: "RELIANCE",   name: "Reliance Industries",       sector: "Energy",     mcap_cr: 1_910_000, beta: 1.00, gamma: 0.78, idio: 0.009, price: 1412 },
  { symbol: "ONGC",       name: "Oil & Natural Gas Corp",    sector: "Energy",     mcap_cr:   310_000, beta: 1.10, gamma: 0.94, idio: 0.013, price: 246 },
  { symbol: "NTPC",       name: "NTPC",                      sector: "Energy",     mcap_cr:   345_000, beta: 0.86, gamma: 0.88, idio: 0.010, price: 356 },
  { symbol: "POWERGRID",  name: "Power Grid Corporation",    sector: "Energy",     mcap_cr:   295_000, beta: 0.74, gamma: 0.86, idio: 0.010, price: 318 },

  { symbol: "TATASTEEL",  name: "Tata Steel",                sector: "Metals",     mcap_cr:   200_000, beta: 1.34, gamma: 0.96, idio: 0.014, price: 162 },
  { symbol: "JSWSTEEL",   name: "JSW Steel",                 sector: "Metals",     mcap_cr:   240_000, beta: 1.24, gamma: 0.95, idio: 0.013, price: 985 },
  { symbol: "HINDALCO",   name: "Hindalco Industries",       sector: "Metals",     mcap_cr:   155_000, beta: 1.30, gamma: 0.92, idio: 0.014, price: 692 },
  { symbol: "VEDL",       name: "Vedanta",                   sector: "Metals",     mcap_cr:   175_000, beta: 1.40, gamma: 0.88, idio: 0.018, price: 448 },

  { symbol: "LT",         name: "Larsen & Toubro",           sector: "Infra",      mcap_cr:   500_000, beta: 1.08, gamma: 0.90, idio: 0.011, price: 3640 },
  { symbol: "ADANIPORTS", name: "Adani Ports & SEZ",         sector: "Infra",      mcap_cr:   285_000, beta: 1.26, gamma: 0.78, idio: 0.017, price: 1322 },
  { symbol: "ULTRACEMCO", name: "UltraTech Cement",          sector: "Infra",      mcap_cr:   330_000, beta: 0.92, gamma: 0.84, idio: 0.011, price: 11450 },

  { symbol: "BHARTIARTL", name: "Bharti Airtel",             sector: "Telecom",    mcap_cr:   980_000, beta: 0.82, gamma: 0.90, idio: 0.010, price: 1655 },
  { symbol: "IDEA",       name: "Vodafone Idea",             sector: "Telecom",    mcap_cr:    55_000, beta: 1.55, gamma: 0.72, idio: 0.032, price: 8.4 },

  { symbol: "PIDILITIND", name: "Pidilite Industries",       sector: "Chemicals",  mcap_cr:   145_000, beta: 0.74, gamma: 0.88, idio: 0.011, price: 2905 },
  { symbol: "SRF",        name: "SRF",                       sector: "Chemicals",  mcap_cr:    70_000, beta: 1.02, gamma: 0.92, idio: 0.015, price: 2340 },
  { symbol: "DEEPAKNTR",  name: "Deepak Nitrite",            sector: "Chemicals",  mcap_cr:    30_000, beta: 1.12, gamma: 0.86, idio: 0.019, price: 2180 },
];

export const SECTORS = [...new Set(UNIVERSE.map((s) => s.sector))];
export const BY_SYMBOL = new Map(UNIVERSE.map((s) => [s.symbol, s]));

/** The starter watchlist is deliberately lopsided — five IT names and three
 *  banks — so the diversification x-ray has something honest to say on load. */
export const DEFAULT_WATCHLIST = [
  "TCS", "INFY", "WIPRO", "HCLTECH", "LTIM",
  "HDFCBANK", "ICICIBANK", "AXISBANK",
  "RELIANCE", "TATAMOTORS",
];
