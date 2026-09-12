export type Candle = {
  ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  oi?: number;
};

export type PrimeResult = {
  symbol: string;
  instrumentKey: string;
  price: number;
  state: "CONFIRMED" | "SETUP" | "WATCH" | "NO_TRADE";
  direction: "LONG" | "SHORT" | "NEUTRAL";
  score: number;
  maxScore: number;
  yh: number | null;
  yl: number | null;
  ema20: number | null;
  vwap: number | null;
  rvol: number;
  atr14: number | null;
  rr: number | null;
  volumeStars: number;
  nr4: boolean;
  nr7: boolean;
  breakout: boolean;
  retest: boolean;
  fnoConfirm: boolean;
  oiConfirm: boolean;
  entry: number | null;
  stop: number | null;
  target: number | null;
  reasons: string[];
};

const SCORE_MAX = 120;

function ema(values: number[], period: number) {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let value = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) value = values[i] * k + value * (1 - k);
  return value;
}

function atr(candles: Candle[], period = 14) {
  if (candles.length < period + 1) return null;
  const tr: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const p = candles[i - 1].close;
    tr.push(Math.max(c.high - c.low, Math.abs(c.high - p), Math.abs(c.low - p)));
  }
  return tr.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function sessionKey(ts: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ts));
}

function vwap(candles: Candle[]) {
  if (!candles.length) return null;
  let pv = 0;
  let vol = 0;
  for (const c of candles) {
    const typical = (c.high + c.low + c.close) / 3;
    pv += typical * c.volume;
    vol += c.volume;
  }
  return vol ? pv / vol : null;
}

function levels(candles: Candle[]) {
  if (candles.length < 2) return { yh: null, yl: null, previousDate: null as string | null };
  const dates = candles.map(c => sessionKey(c.ts));
  const unique = [...new Set(dates)].sort();
  if (unique.length < 2) return { yh: null, yl: null, previousDate: null };
  const previousDate = unique[unique.length - 2];
  const prev = candles.filter(c => sessionKey(c.ts) === previousDate);
  return {
    yh: prev.length ? Math.max(...prev.map(c => c.high)) : null,
    yl: prev.length ? Math.min(...prev.map(c => c.low)) : null,
    previousDate,
  };
}

function volumeStats(candles: Candle[]) {
  const recent = candles[candles.length - 1];
  const baseline = candles.slice(Math.max(0, candles.length - 21), -1).map(c => c.volume).filter(Boolean);
  const avg = baseline.length ? baseline.reduce((a, b) => a + b, 0) / baseline.length : 0;
  const rvol = avg ? recent.volume / avg : 0;
  const stars = rvol >= 6.5 ? 3 : rvol >= 4 ? 2 : rvol >= 2 ? 1 : 0;
  return { rvol, stars };
}

function isNarrow(candles: Candle[], n: number) {
  if (candles.length < n) return false;
  const last = candles.slice(-n).map(c => c.high - c.low);
  const lastRange = last[last.length - 1];
  return lastRange <= Math.min(...last);
}

export function scorePrime(input: {
  symbol: string;
  instrumentKey: string;
  candles: Candle[];
  futureConfirm?: boolean;
  oiConfirm?: boolean;
}): PrimeResult {
  const candles = [...input.candles].sort((a, b) => +new Date(a.ts) - +new Date(b.ts));
  const last = candles[candles.length - 1];
  const closes = candles.map(c => c.close);
  const e20 = ema(closes, 20);
  const a14 = atr(candles, 14);
  const { yh, yl } = levels(candles);
  const currentDate = last ? sessionKey(last.ts) : null;
  const currentSession = currentDate ? candles.filter(c => sessionKey(c.ts) === currentDate) : [];
  const currentVwap = vwap(currentSession);
  const { rvol, stars } = volumeStats(candles);
  const nr4 = isNarrow(candles, 4);
  const nr7 = isNarrow(candles, 7);

  let score = 0;
  const reasons: string[] = [];
  let direction: PrimeResult["direction"] = "NEUTRAL";

  const touchesHigh = yh !== null && last.high >= yh;
  const touchesLow = yl !== null && last.low <= yl;
  const breaksHigh = yh !== null && last.close > yh;
  const breaksLow = yl !== null && last.close < yl;

  if (breaksHigh || breaksLow) {
    score += 20;
    direction = breaksHigh ? "LONG" : "SHORT";
    reasons.push(breaksHigh ? "Previous high breakout" : "Previous low breakdown");
  } else if (touchesHigh || touchesLow) {
    score += 10;
    direction = touchesHigh ? "LONG" : "SHORT";
    reasons.push(touchesHigh ? "Previous high reaction" : "Previous low reaction");
  }

  if (rvol >= 2) { score += 15; reasons.push(`RVOL ${rvol.toFixed(1)}x`); }
  if (stars >= 3) { score += 10; reasons.push("3-star volume"); }

  if (e20 !== null) {
    const prevEma = ema(closes.slice(0, -1), 20);
    const up = prevEma !== null && e20 > prevEma;
    const aligned = direction === "LONG" ? last.close > e20 && up : direction === "SHORT" ? last.close < e20 && !up : false;
    if (aligned) { score += 10; reasons.push("EMA20 trend aligned"); }
  }

  if (currentVwap !== null) {
    const aligned = direction === "LONG" ? last.close > currentVwap : direction === "SHORT" ? last.close < currentVwap : false;
    if (aligned) { score += 10; reasons.push("VWAP aligned"); }
  }

  const body = Math.abs(last.close - last.open);
  const range = Math.max(last.high - last.low, Number.EPSILON);
  const bodyRatio = body / range;
  if (bodyRatio >= 0.55) { score += 10; reasons.push("Strong candle body"); }

  const breakout = breaksHigh || breaksLow;
  const prior = candles.length > 2 ? candles[candles.length - 2] : null;
  const retest = breakout && prior ? (breaksHigh ? prior.low <= yh! && last.close > yh! : prior.high >= yl! && last.close < yl!) : false;
  if (breakout && retest) { score += 5; reasons.push("Breakout/retest structure"); }

  if (nr4 || nr7) { score += 5; reasons.push(nr7 ? "NR7 compression" : "NR4 compression"); }

  let stop: number | null = null;
  let target: number | null = null;
  let rr: number | null = null;
  if (a14 !== null && direction !== "NEUTRAL") {
    stop = direction === "LONG" ? last.close - a14 : last.close + a14;
    target = direction === "LONG" ? last.close + a14 * 2 : last.close - a14 * 2;
    rr = 2;
    score += 5;
    reasons.push("ATR risk model available");
  }

  if (input.futureConfirm) { score += 5; reasons.push("F&O confirmation"); }
  if (input.oiConfirm) { score += 5; reasons.push("OI confirmation"); }

  const technicalGate = (breakout || touchesHigh || touchesLow) && (rvol >= 1.5 || bodyRatio >= 0.55);
  const confirmed = score >= 80 && technicalGate && (input.futureConfirm ?? false) && (input.oiConfirm ?? false);
  const setup = !confirmed && score >= 45 && technicalGate;
  const state: PrimeResult["state"] = confirmed ? "CONFIRMED" : setup ? "SETUP" : direction === "NEUTRAL" ? "WATCH" : "NO_TRADE";

  return {
    symbol: input.symbol,
    instrumentKey: input.instrumentKey,
    price: last.close,
    state,
    direction,
    score,
    maxScore: SCORE_MAX,
    yh,
    yl,
    ema20: e20,
    vwap: currentVwap,
    rvol,
    atr14: a14,
    rr,
    volumeStars: stars,
    nr4,
    nr7,
    breakout,
    retest,
    fnoConfirm: !!input.futureConfirm,
    oiConfirm: !!input.oiConfirm,
    entry: state === "SETUP" || state === "CONFIRMED" ? last.close : null,
    stop,
    target,
    reasons,
  };
}
