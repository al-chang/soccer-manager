# Transfers v2 — work breakdown

Expands the ⚪ **Improved Transfer Experience** roadmap item into independent
pieces. Each piece is sized for one focused session. Decisions below are
settled — don't re-litigate them inside a piece.

> **Status: all pieces (P1–P6) implemented** — 2026-07-19, pending manual
> in-browser verification.

## Agreed scope (decisions)

- **Live negotiations** = instant back-and-forth: the AI responds immediately
  to each counter in a negotiation session; no day-advance between rounds.
  AI patience (personality-driven) caps the rounds before they walk away.
- **Clauses/bonuses in v1**: contract length picker (1–5 yrs), release clause,
  sell-on percentage (deal clause, seller benefit), signing-on fee,
  appearance fee, goal bonus. Bonuses must actually hit the finance ledger.
- **Swaps**: user can include one of their players in a bid (cash + player).
  AI values the package but does not initiate swap offers.
- **Renewals are in scope**: same contract-negotiation UI is used to renew
  existing squad players' contracts.

## Target data model (Piece 1 defines these; later pieces consume)

```ts
interface Contract {
  wage: number;
  expiresDay: number;
  releaseClause: number | null; // bids >= clause skip fee negotiation
  appearanceFee: number;        // per appearance, 0 if none
  goalBonus: number;            // per goal, 0 if none
}

// On Player: sell-on obligation from the deal that brought them in.
// Replaced (or cleared) on each subsequent transfer.
sellOn: { clubId: number; pct: number } | null;

interface DealTerms {          // fee stage
  fee: number;
  sellOnPct: number;           // 0 = none
  swapPlayerId: number | null; // from the buying club
}

interface ContractTerms {      // contract stage (transfer or renewal)
  wage: number;
  years: number;               // 1–5
  signingBonus: number;        // one-time, paid on completion
  appearanceFee: number;
  goalBonus: number;
  releaseClause: number | null;
}
```

`TransferOffer` carries `terms: DealTerms`, the AI's `counterTerms`, a round
count, and remaining patience, replacing the single `fee`/`counterFee` pair.

## Engine API contract (agreed signatures so pieces 2 and 3 can run in parallel)

In `packages/engine/src/transfers.ts` (piece 2 implements; piece 1 stubs):

- `counterBid(state, rng, offer, terms: DealTerms): void` — apply a user
  counter; AI responds synchronously (accept / counter / reject / walk away).
- `packageValue(state, club, player, terms: DealTerms): number` — cash-
  equivalent value of a deal package to the selling club.
- `playerContractDemand(state, player, kind: 'transfer' | 'renewal'): ContractTerms`
- `respondToContractOffer(state, rng, playerId, terms: ContractTerms, kind): 'accept' | 'counter' | 'reject'`
  (counter terms written somewhere the UI can read).

## Pieces

### P1 — Engine foundation: deal & contract model  _(first; blocks all but P4)_
Types above in `types.ts`; save migration defaults in `migrate.ts`;
`completeTransfer` pays signing bonus + records sell-on + pays out an existing
sell-on obligation via the ledger (`finance.ts` categories as needed);
sim pays appearance/goal bonuses when matches resolve; release-clause bids
auto-accept the fee stage (both directions — AI can trigger user players'
clauses). Stub the engine API above with current single-round behavior so the
app keeps working. Tests in `packages/engine/test/transfers.test.ts`.

### P2 — Engine: AI package valuation & instant negotiation  _(after P1)_
Real implementations of the API: package valuation (fee + swap player value +
sell-on discount), personality-driven concession curve across instant rounds,
patience/walk-away, player-side contract demands trading wage vs length vs
bonuses vs release clause, renewal willingness (morale, age, club status).
Update `aiRespondToBid`, `aiTransferTick`, `aiFollowUpCounters` to price the
richer contracts. Engine-only; tests.

### P3 — UI: negotiation experience  _(after P1, parallel with P2/P4)_
New negotiation session view (modal or dedicated pane): sliders for fee /
wage / length / bonuses / sell-on / release clause instead of raw number
inputs, round-by-round history, AI responses appearing instantly, walk-away
state. Covers both stages (fee deal, then contract) and renewals. Owns
`OffersTab` in `TransfersScreen.tsx`, new component file(s), and the
`gameStore.ts` actions that call the engine API. Include the swap-player
picker control (disabled until P2 lands if needed).

### P4 — UI: transfer hub  _(independent — can start immediately)_
First extract the tabs of `TransfersScreen.tsx` into separate files (avoids
conflicts with P3, which owns the offers tab). Then: a Transfer list tab
(listed players league-wide), better player search (sortable columns; filters
for age, wage, contract expiry, listed-only), and a shortlist if cheap.

### P5 — Player swaps end-to-end  _(after P2 + P3)_
Wire the swap slot through for real: `completeTransfer` moves both players
(swap player valued into the deal, gets a contract at the selling club),
AI package valuation exercised from the UI, news/history entries name the
swap. Mostly integration + tests.

### P6 — Contract renewals  _(after P2 + P3)_
"Offer new contract" action on the player screen/modal for own squad,
reusing the P3 negotiation UI and P2 demand logic. Expiring-contract warnings
in squad views; expired-and-unrenewed players leave on a free. Check what AI
clubs already do about their own expiries and keep them coherent.

## Conventions that apply to every piece

- Never show `effectiveRating` in UI — `overall(p)` only (see `CLAUDE.md`).
- No manual browser verification — explain the change, let the human check.
- Save-compatibility: every state shape change needs a `migrate.ts` default.
- Run `packages/engine` tests before finishing a piece.
