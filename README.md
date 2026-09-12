# PRIME Scanner

A read-only F&O technical intelligence dashboard powered by the Upstox Analytics Token. There is **no OAuth flow and no redirect URL** in this application.

## Architecture

Browser → Next.js API → Upstox Analytics Token → 5-minute market data → PRIME engine → dashboard.

The Analytics Token is kept server-side in `UPSTOX_ANALYTICS_TOKEN`. The token is never exposed to browser JavaScript and this app has no order-placement code.

## PRIME checks in this build

- Previous-session high/low breakout and reaction
- EMA20 trend alignment
- Session VWAP alignment
- Relative volume and 3-star volume
- Candle quality
- NR4 / NR7 compression
- Breakout/retest structure
- ATR14 risk model and 2R target model
- Current stock-future confirmation
- Futures OI confirmation when Upstox provides the required fields
- Master score and state: CONFIRMED / SETUP / WATCH / NO_TRADE

The scoring weights are deliberately visible in `src/lib/prime.ts`; any PRIME-specific rule that has not been supplied as an authoritative strategy specification should be treated as configurable rather than assumed to be proprietary truth.

## Local setup

```bash
npm install
cp .env.example .env.local
# put the Analytics Token into .env.local
npm run typecheck
npm run build
npm run dev
```

## Vercel

1. Import this GitHub repository into Vercel as a Next.js project.
2. Add `UPSTOX_ANALYTICS_TOKEN` to Production and Preview environment variables.
3. Deploy.
4. No Upstox redirect URI is required.

## Scan size

The dashboard defaults to 40 F&O stocks and supports 20/40/60/80. This is intentionally bounded because each equity requires 5-minute historical data. The architecture can later move continuous streaming and candle aggregation to a dedicated worker using Upstox Market Data Feed V3.

## Security

Never commit the real Analytics Token. If a token is exposed, revoke it in Upstox and generate a new one.
