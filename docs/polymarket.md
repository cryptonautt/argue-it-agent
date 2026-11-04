# Polymarket markets and in-app betting

For the ARGUE IT team that will switch betting on and keep it running. Everything here describes what the code
does today. **Betting is off** until the four Builder env vars below are set.

## 1. What it is

- **`/markets`** lists live Polymarket events: the most traded open events by 24h volume, or a search (`?q=`).
  Each card shows up to three leading options and their Yes odds.
- **`/markets/<slug>`** is one event. It has:
  - an odds chart for up to 4 leading options (1d / 1w / 1m / max);
  - every open option with its chance, 1-day change, and **Yes ¢ / No ¢** buttons;
  - the **trade panel**;
  - **The debate**: ARGUE IT arguments linked to the market (newest 20), plus the event's rules.
  - The page refreshes every 30 s while the tab is visible.
- **Argue your call** opens `/new?market=<slug>&title=…`. The published argument stores the slug
  (`arguments.polymarket_event_slug`), and it then appears on that market page.
- Both pages need a signed-in user (`list-markets` and `get-market` call `requireUser`). Market data is
  public and read from Polymarket's Gamma API and CLOB price history. It is cached in-process (15 s for an
  event, 30 s for a list, 60 s for history).

Code: `server/domain/polymarket/` (`markets.ts`, `trading.ts`, `debates.ts`, `slug.ts`),
`actions/list-markets.ts`, `actions/get-market.ts`, `app/routes/markets.*`, `app/lib/polymarket-trading.ts`,
`app/components/argue/markets/trade-panel.tsx`, `server/routes/api/polymarket/builder-sign.post.ts`.

## 2. How betting works

**It's non-custodial.** The user's own injected browser wallet (MetaMask, Rabby, …) signs the Polymarket login
and every order. Orders go **from the browser straight to Polymarket**, never through our server, because
Polymarket geoblocks by the requesting IP. ARGUE IT never sees a private key or holds funds.

**Our server does one job:** it signs Builder headers (`POLY_BUILDER_*`, an HMAC with our Builder secret) at
`POST /api/polymarket/builder-sign`, for the SDK's `remoteBuilderSigning`. The route refuses a request unless
all of these hold:

- the `Origin` matches our own origin (direct or via `X-Forwarded-Host/Proto`). A request with no `Origin`
  header isn't blocked by this check;
- the user is signed in, has finished their profile, and isn't suspended;
- all four Builder credentials are set (otherwise 403);
- the request is on the relayer allowlist: `GET /deployed`, `GET /v1/account/transactions/<id>`,
  `POST /submit`. Anything else returns 400 and logs the path (never the body);
- the user is within the per-user rate limits: `polymarket_sign` 600/hour on every request that reaches
  parsing, refused ones included (so the refusal log line can't be flooded), plus `polymarket_relay` 10/day on
  POSTs (that is, `/submit`).

The public **builder code** goes to the browser in `get-market` (`trading.builderCode`). It is attached to every
order, so volume and builder fees are credited to ARGUE IT.

```text
Browser (trade panel)                          ARGUE IT server             Polymarket
 1. GET polymarket.com/api/geoblock  ─────────────────────────────────────▶ blocked? (fails closed)
 2. wallet: connect, switch to Polygon, sign login
 3. createSecureClient ── relayer call needs Builder auth ─▶ /builder-sign ─┐
                        ◀──────────── POLY_BUILDER_* headers ───────────────┘
    first time: Deposit Wallet deployed (gasless)  ───────────────────────▶ relayer
 4. Bet: price check, approvals if missing (gasless)  ────────────────────▶ relayer
 5. FAK market BUY, maxSpend = amount, builderCode  ──────────────────────▶ CLOB
```

Step by step, in `app/lib/polymarket-trading.ts`:

1. **Location check.** The browser calls Polymarket's geoblock endpoint. If the answer can't be read, it
   counts as blocked.
2. **Connect.** viem connects the wallet on Polygon (it adds the chain if it's missing). The SDK then opens a
   session. We don't pass a `wallet`, so the account is the signer's **Deposit Wallet**. The first time,
   Polymarket deploys that wallet gaslessly.
   - After connecting, the panel listens to the wallet's `accountsChanged` and `chainChanged` events. If the
     account changes or the wallet leaves Polygon, it drops the session and asks the user to reconnect.
     `placeBet` also re-checks `eth_chainId` is Polygon (137) before doing anything.
3. **Price check.** `maxPrice` comes from `estimateMarketPrice` on the live book. The confirm step shows the
   Gamma price, which can be up to 15 s old, so if `maxPrice` is more than 5¢ (`MAX_PRICE_SLIPPAGE`) above the
   price the user confirmed, nothing is placed and the panel says the price moved. This runs before approvals.
4. **Approvals,** only when missing:
   - Standard approvals come from the SDK's real on-chain state (`client.fetchTradingApprovalsState()`).
     `setupTradingApprovals()` runs only when that state isn't fully approved, or can't be read.
   - Neg-risk (multi-outcome) markets also need two Neg Risk Adapter approvals: pUSD `approveErc20` and Conditional
     Tokens `approveErc1155ForAll`. The SDK doesn't grant these, and its approval state doesn't cover them. They
     are skipped when the SDK reports the market as `version: "v2"`.
   - The neg-risk approvals are remembered in `localStorage` (`argue.polymarket.approved.negrisk.<wallet>`). The
     flag is cleared whenever an order fails, so a retry re-approves. It is kept when nothing matched, when the
     user cancels the signature, or when the book is too thin: those say nothing about approvals, and each
     re-approval spends two of the user's 10 relayer transactions a day.
5. **Order.** A market BUY, fill-and-kill (FAK):
   - `maxPrice` is the live estimate from step 3.
   - `maxSpend` equals the typed amount, which caps the all-in cost with Polymarket and builder fees included.
   - Anything that can't fill is cancelled.
   - The panel caps a bet at $10,000.
   - Before the wallet prompt, a confirm step restates the option, the side, the price, the max price per share
     (shown price + 5¢) and the cap.
6. **Result.** The panel branches on the order status:
   - `matched`: "Bet placed: N shares for $X".
   - `delayed`: Polymarket queued the order behind a matching delay, so it may still fill. The panel says it's
     queued and points to the user's Polymarket activity. It never says nothing was spent.
   - `live`, or a `fak_not_filled` / `unmatched` refusal: "nothing matched, so nothing was spent".
   - Errors: a wallet rejection, too little pUSD (`insufficient_balance_or_allowance`, or a "not enough /
     insufficient balance" message), and too little book depth (the SDK's `InsufficientLiquidityError`) each get
     their own message. Every other failure shows a generic message, and its cause is logged to the browser
     console as `[polymarket] …`, with names, messages, codes and statuses only (never request headers).

## 3. Switching it on

1. **Pick the account.** Create or choose the polymarket.com account that will own ARGUE IT's builder
   profile. Treat it as a company account, not someone's personal one.
2. **Get the credentials.** On polymarket.com, go to **Settings → Builders**:
   - copy the **builder code** (public);
   - create a **Builder API key**, then copy the **key, secret and passphrase**. They are shown when you
     create the key, so store them in the team's secret manager straight away.
3. **Set four env vars** on the server, or in Netlify's site environment variables (see `.env.example`):

   ```bash
   POLYMARKET_BUILDER_CODE=
   POLYMARKET_BUILDER_API_KEY=
   POLYMARKET_BUILDER_SECRET=
   POLYMARKET_BUILDER_PASSPHRASE=
   ```

   - Betting stays off unless **all four** are set.
   - They are read only on the server (`readBuilderCredentials`). Never put them in client code or a
     `VITE_`-style public var. Only the code is ever sent to the browser.
   - Redeploy, then open any market. The trade panel should show **Connect wallet to bet** instead of "In-app
     betting isn't switched on yet."
4. **Builder fees (optional).** Set these in the Polymarket builder settings. The app has no fee config.
   - Taker fee: up to 100 bps (1%). Maker fee: up to 50 bps (0.5%).
   - You can change the rates once per 7 days. A change takes effect 3 days after you schedule it, and only
     one change can be pending at a time.
   - ([fees](https://docs.polymarket.com/programs/builders/fees.md))
5. **Mind the tier.**
   - **Unverified** (the default) allows **100 relayer transactions a day for the whole app**, across all
     users. Every first-time user spends a few of these on wallet deployment and approvals, and a
     neg-risk market adds two more.
   - To ask for **Verified** (10,000 a day), email **[builder@polymarket.com](mailto:builder@polymarket.com)** with the Builder API key, the use
     case, the expected volume and any links.
   - ([tiers](https://docs.polymarket.com/programs/builders/tiers.md))

## 4. Funding

Users bet with **pUSD** held in their Deposit Wallet on Polygon. Once connected, the panel shows the wallet and
signer addresses and the cash balance. If the balance is $0, it links to Polymarket's
[deposit guide](https://docs.polymarket.com/trading/bridge/deposit). Funds can be bridged from supported
chains, and USDC or USDC.e is converted to pUSD automatically. ARGUE IT has no deposit or withdrawal flow of its
own.

## 5. What's verified and what isn't

**Verified**

- **Unit tests** (`server/domain/polymarket/*.spec.ts`):
  - Gamma normalisation: JSON-string fields, inactive options, bad prices, the `restricted` flag ignored;
  - list, search, cache, retry and outage handling, plus price history;
  - `tradingStatus` is off until all four credentials are set, and when on exposes only the code;
  - Builder header signing;
  - the allowlist rejects other methods, hosts, traversal, oversized bodies, `/order` and session-signer
    paths;
  - storing an argument's market slug and listing it on that market only.
- **E2E smoke** (`e2e/markets.spec.ts`, live Polymarket data):
  - the markets list loads;
  - the market page shows Yes/No buttons, and picking No moves the ticket to No;
  - with betting off, the panel says it's off and links to Polymarket;
  - the signing route returns 403 when betting is off and 401 when not signed in;
  - **Argue your call** publishes an argument that then shows on the market page.

**Not yet verified end to end:** Deposit Wallet deployment, the approvals (standard and neg-risk), and a real
order. These need real Builder credentials, a non-blocked location, and a funded wallet.

**First real bet ($1–5), manual test plan.** Use a deploy preview with the four env vars set:

1. Fund a fresh MetaMask address's Deposit Wallet with about $10 of pUSD. Note its address from the panel.
2. Open a **single-outcome** market that is accepting orders, then click **Connect wallet to bet**.
   - Check that the geoblock passes, the wallet asks to switch to Polygon and to sign the login, and the
     panel shows the wallet, signer and cash.
   - In the server logs, check the `/builder-sign` calls return 200, with no `[builder-sign] refused` lines.
3. Bet **$1 Yes** and confirm. Expect the approval steps, then the order.
   - The panel should say "Bet placed: N shares for $X", with X ≤ $1.
   - Check the position on polymarket.com with the same wallet.
   - Check the trade is attributed in the Builders dashboard.
4. Repeat on a **multi-outcome (neg-risk)** market for $1. This exercises the Neg Risk Adapter approvals.
5. Bet again on each market. There should be no approval prompts this time: the SDK's approval state reports
   the standard approvals as done, and the neg-risk flag is set.
6. Negative checks:
   - reject the wallet prompt: expect "You cancelled the request in your wallet.";
   - try a VPN from a blocked country: expect the location message and no connect.

## 6. Known limitations

- **Old Safe or Proxy wallets aren't used.** We always trade from the signer's Deposit Wallet, so a user
  whose Polymarket funds sit in an older Safe or Proxy wallet sees a new, empty wallet. The SDK can take a
  `wallet` address, but we don't pass one.
- **Origin check behind a proxy.** The check accepts the request origin or the `X-Forwarded-*` origin.
  Confirm on a Netlify deploy preview that real signing requests pass it, and that a cross-site POST gets
  403.
- **Gamma's `restricted` flag isn't used.** Gamma sets it on almost every event, so the app relies on
  Polymarket's geoblock check in the browser. Polymarket's docs don't say whether close-only countries
  return `blocked: true`. If they don't, the CLOB is what refuses the order.
- **Market slugs aren't checked.** When an argument is created, its slug is checked for format only
  (`marketSlugSchema`). It isn't checked against Polymarket.
- **Neg-risk approvals cache.** Only the Neg Risk Adapter approvals are cached, in `localStorage` per wallet.
  If the cache is cleared, or an order fails (which clears it on purpose), those two approvals are
  re-submitted, which spends relayer quota.
- **Dev server: the SDK must be prebundled.** Agent-Native turns Vite's dependency discovery off, so the
  browser-side SDK entries (`viem`, `viem/chains`, `@polymarket/client`, `/viem`, `/actions`) are listed in
  `optimizeDeps.include` in `vite.config.ts`. Without that, the dynamic import fails in dev on eventemitter3's
  CommonJS file. A new SDK subpath imported by the panel needs adding there too. Never import
  `@polymarket/client/node` from client code.
- **Rate limits are per user.** The app-wide quota is Polymarket's tier limit (section 3).

## 7. Legal and product note

- **This is the owners' decision.** Offering real-money betting is a legal and regulatory call for ARGUE IT's
  owners, not an engineering default. Polymarket blocks some countries outright and puts many others,
  including the US and UK, on close-only (see its
  [geoblock docs](https://docs.polymarket.com/api-reference/geoblock.md)). The panel links to Polymarket's
  Terms of Use.
- **The agent never bets.** It can read markets (`list-markets`, `get-market`), report Polymarket's odds,
  and help start an argument about a market. It never places, sizes or recommends bets, and gives no
  financial advice (`server/plugins/agent-chat.ts`, `AGENTS.md`). There is no betting action on purpose.
- **Debates carry no stakes.** Debates and verdicts never involve money, and the agent must not use betting
  language about them.
