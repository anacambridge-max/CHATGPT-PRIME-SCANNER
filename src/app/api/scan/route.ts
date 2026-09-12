import { gunzipSync } from "node:zlib";
import { scorePrime, type Candle } from "@/lib/prime";

export const runtime = "nodejs";
export const maxDuration = 60;

const UPSTOX = "https://api.upstox.com";
const NSE_INSTRUMENTS = "https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz";
const UPSTREAM_TIMEOUT_MS = 12_000;
const CANDLE_CONCURRENCY = 10;

type Instrument = {
  segment?: string;
  instrument_type?: string;
  instrument_key: string;
  trading_symbol?: string;
  name?: string;
  underlying_key?: string;
  underlying_symbol?: string;
  expiry?: number | string;
  lot_size?: number;
};

type Quote = Record<string, any>;

let instrumentCache: { at: number; instruments: Instrument[] } | null = null;

function token() {
  const value = process.env.UPSTOX_ANALYTICS_TOKEN;
  if (!value) throw new Error("UPSTOX_ANALYTICS_TOKEN is not configured");
  return value;
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = UPSTREAM_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Upstox request timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function getInstruments() {
  if (instrumentCache && Date.now() - instrumentCache.at < 6 * 60 * 60 * 1000) return instrumentCache.instruments;
  const response = await fetchWithTimeout(NSE_INSTRUMENTS, { cache: "no-store" }, 20_000);
  if (!response.ok) throw new Error(`Instrument master failed: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  let text: string;
  try { text = gunzipSync(bytes).toString("utf8"); } catch { text = bytes.toString("utf8"); }
  const parsed = JSON.parse(text);
  const instruments: Instrument[] = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.data) ? parsed.data : [];
  if (!instruments.length) throw new Error("Upstox instrument master returned no instruments");
  instrumentCache = { at: Date.now(), instruments };
  return instruments;
}

async function upstox(path: string) {
  const response = await fetchWithTimeout(`${UPSTOX}${path}`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${token()}` },
    cache: "no-store",
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Upstox ${response.status}: ${body.slice(0, 300)}`);
  try {
    return JSON.parse(body);
  } catch {
    throw new Error("Upstox returned invalid JSON");
  }
}

function isoDate(d: Date) { return d.toISOString().slice(0, 10); }

function parseCandles(payload: any): Candle[] {
  const rows = payload?.data?.candles ?? [];
  return rows.map((r: any[]) => ({
    ts: String(r[0]), open: Number(r[1]), high: Number(r[2]), low: Number(r[3]), close: Number(r[4]), volume: Number(r[5] ?? 0), oi: r[6] == null ? undefined : Number(r[6]),
  })).filter((c: Candle) => Number.isFinite(c.close));
}

function expiryMs(value: number | string | undefined) {
  if (value == null) return Number.MAX_SAFE_INTEGER;
  if (typeof value === "number") return value < 1e12 ? value * 1000 : value;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

function quoteEntry(payload: any, instrumentKey: string): Quote | null {
  const data = payload?.data ?? {};
  return (data[instrumentKey] ?? Object.values(data)[0] ?? null) as Quote | null;
}

function quoteNumbers(q: Quote | null) {
  if (!q) return { ltp: null, prevClose: null, oi: null, previousOi: null };
  const ohlc = q.ohlc ?? q.live_ohlc ?? {};
  return {
    ltp: Number(q.last_price ?? q.ltp ?? ohlc.close),
    prevClose: Number(q.prev_close_price ?? q.cp ?? q.previous_close ?? NaN),
    oi: Number(q.oi ?? q.open_interest ?? NaN),
    previousOi: Number(q.previous_oi ?? q.prev_oi ?? NaN),
  };
}

async function fetchCandles(instrumentKey: string, from: string, to: string) {
  const encoded = encodeURIComponent(instrumentKey);
  const payload = await upstox(`/v3/historical-candle/${encoded}/minutes/5/${to}/${from}`);
  return parseCandles(payload);
}

async function fetchQuotes(keys: string[]) {
  const out = new Map<string, Quote>();
  for (let i = 0; i < keys.length; i += 500) {
    const chunk = keys.slice(i, i + 500);
    const payload = await upstox(`/v3/market-quote/quotes?instrument_key=${chunk.map(encodeURIComponent).join(",")}`);
    for (const key of chunk) {
      const q = quoteEntry(payload, key);
      if (q) out.set(key, q);
    }
  }
  return out;
}

async function mapConcurrent<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>) {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function runner() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runner));
  return results;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const requested = url.searchParams.get("symbols")?.split(",").map(s => s.trim().toUpperCase()).filter(Boolean) ?? [];
    const requestedLimit = Number(url.searchParams.get("limit") ?? "40");
    const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 40, 1), 80);

    const all = await getInstruments();
    const today = Date.now();
    const equities = all.filter(i => i.segment === "NSE_EQ" && i.instrument_type === "EQ" && i.instrument_key);
    const futures = all.filter(i => i.segment === "NSE_FO" && i.instrument_type === "FUT" && i.underlying_key && expiryMs(i.expiry) >= today - 24 * 60 * 60 * 1000);

    const futureByUnderlying = new Map<string, Instrument>();
    for (const f of futures) {
      const current = futureByUnderlying.get(f.underlying_key!);
      if (!current || expiryMs(f.expiry) < expiryMs(current.expiry)) futureByUnderlying.set(f.underlying_key!, f);
    }

    let universe = equities.filter(e => futureByUnderlying.has(e.instrument_key));
    if (requested.length) universe = universe.filter(e => requested.includes(String(e.trading_symbol ?? "").toUpperCase()));
    universe = universe.slice(0, requested.length ? requested.length : limit);

    if (!universe.length) {
      return Response.json({ ok: true, scanned: 0, returned: 0, generatedAt: new Date().toISOString(), results: [], errors: ["No F&O equity instruments matched the requested universe"], mode: "analytics-token-readonly" });
    }

    const futureKeys = universe.map(e => futureByUnderlying.get(e.instrument_key)!.instrument_key);
    const futureQuotes = await fetchQuotes(futureKeys);

    const now = new Date();
    const from = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const fromDate = isoDate(from);
    const toDate = isoDate(now);

    const errors: string[] = [];
    const results = (await mapConcurrent(universe, CANDLE_CONCURRENCY, async equity => {
      try {
        const candles = await fetchCandles(equity.instrument_key, fromDate, toDate);
        if (candles.length < 30) throw new Error("insufficient 5-minute candles");
        const future = futureByUnderlying.get(equity.instrument_key)!;
        const fq = quoteNumbers(futureQuotes.get(future.instrument_key) ?? null);
        const last = [...candles].sort((a, b) => +new Date(a.ts) - +new Date(b.ts)).at(-1)!;
        const futureMove = Number.isFinite(fq.ltp!) && Number.isFinite(fq.prevClose!) ? fq.ltp! - fq.prevClose! : 0;
        const oiDelta = Number.isFinite(fq.oi!) && Number.isFinite(fq.previousOi!) ? fq.oi! - fq.previousOi! : 0;
        const futureConfirm = futureMove !== 0 && ((last.close > last.open && futureMove > 0) || (last.close < last.open && futureMove < 0));
        const oiConfirm = oiDelta > 0 && futureConfirm;
        return scorePrime({ symbol: equity.trading_symbol ?? equity.name ?? equity.instrument_key, instrumentKey: equity.instrument_key, candles, futureConfirm, oiConfirm });
      } catch (error) {
        errors.push(`${equity.trading_symbol ?? equity.instrument_key}: ${error instanceof Error ? error.message : "scan failed"}`);
        return null;
      }
    })).filter(Boolean);

    results.sort((a: any, b: any) => {
      const stateRank: Record<string, number> = { CONFIRMED: 4, SETUP: 3, WATCH: 2, NO_TRADE: 1 };
      return (stateRank[b.state] - stateRank[a.state]) || (b.score - a.score) || (b.rvol - a.rvol);
    });

    return Response.json({
      ok: true,
      scanned: universe.length,
      returned: results.length,
      generatedAt: new Date().toISOString(),
      results,
      errors: errors.slice(0, 20),
      mode: "analytics-token-readonly",
    });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Scanner failed" }, { status: 500 });
  }
}
