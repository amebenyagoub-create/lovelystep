# Campaign Intelligence

Lovely Step now has a conclusion-first campaign manager at **Admin → Campaign Manager**.
It combines synced Meta campaign insights, store-side UTM attribution, COD outcomes, product
cost snapshots, delivery costs, refunds, variable expenses, and dated currency conversion.

## Decision authority

`SCALE`, `KEEP`, `WATCH`, and `KILL` are produced only by the pure deterministic engine in
`lib/campaign-intelligence/decision.ts`. Groq receives that decision plus the calculated facts
and may only explain them. Its JSON response is runtime-validated, cached by an input
fingerprint, and ignored if it is malformed. A deterministic explanation is always available.

## Configuration

Server-only environment variables:

- `GROQ_API_KEY`: optional. Without it, the campaign manager remains fully operational and
  uses deterministic explanations.
- `CAMPAIGN_AI_MODEL`: defaults to `llama-3.3-70b-versatile`.
- `CAMPAIGN_AI_TIMEOUT_MS`: defaults to 12 seconds and is capped at 30 seconds.
- `CAMPAIGN_AI_CACHE_HOURS`: defaults to 12 hours and is capped at 168 hours.

Business thresholds live in one typed configuration object in
`lib/campaign-intelligence/thresholds.ts`. Valid JSON overrides may later be stored under the
`campaign_intelligence_thresholds` key in `app_settings`; unsafe or out-of-range values are
ignored.

## Important definitions

- Meta purchases and Meta ROAS remain Meta-attributed advertising metrics.
- Store revenue is recognized only for delivered COD orders.
- Actual delivered CPA is spend divided by delivered store orders.
- Expected delivered CPA uses historical confirmation and delivery probabilities while a
  cohort is still unresolved.
- Target delivered CPA is the contribution available before ads minus the configured desired
  profit per delivered order.
- Campaign-to-order matching currently uses a normalized, unique `utm_campaign` value equal
  to the Meta campaign name. Ambiguous and missing matches stay unattributed and are shown in
  the dashboard.
- Sum of daily reach is labeled explicitly because unique reach cannot be safely added across
  days.

## Verification

Run:

```powershell
npm.cmd run test:campaigns
npm.cmd run lint
npm.cmd run build
```

The campaign test suite covers profitable scaling, overspend without purchase, poor delivery,
insufficient data, deterioration, creative fatigue, missing costs, invalid AI JSON, and the
Groq fallback path.
