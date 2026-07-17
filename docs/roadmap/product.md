# Product roadmap

Features for the game — what a manager can _do_. See the
[status legend](./README.md#status-legend).

> **Seeded draft.** The 🟢 rows are read from the current codebase. The unbuilt
> rows below are inferred candidates — **please confirm/correct**, since the
> "previously discussed" backlog isn't fully captured yet.

## Shipped 🟢

- 🟢 **Squad management** — sortable squad table, player detail + modal, 11-attribute grid.
- 🟢 **Tactics & lineup** — formation picker, mentality/pressing/tempo, drag-and-drop pitch editor.
- 🟢 **Transfers** — search/filter, outgoing offers, incoming-offer negotiation.
- 🟢 **Match engine** — sim with team quality + positions, live match screen (scoreboard, clock, feed, subs).
- 🟢 **Season simulation** — fixtures, league table w/ promotion/relegation edges, day-by-day calendar advance.
- 🟢 **News / inbox** — categorized feed (transfer/match/league/window), read/unread.
- 🟢 **Club & history** — club profile, past-season records.
- 🟢 **Condition/form model** — fitness/sharpness/morale/wellbeing bars + form dots (the sharpness signal).
- 🟢 **Local persistence** — IndexedDB autosave, save migration.
- 🟢 **Theming** — dark/light, OS-follow + manual override.
- 🟢 **Finances & budgets** — full-ledger club economy: real balance, wages actually paid,
  gate/TV/commercial income, board-set spending envelope with an adjustable transfer↔wage
  split. FFP-style limits deferred to a v2. New Finances screen.

## Near-term 🟡 / Backlog ⚪

- ⚪ **Youth academy / intake** — regen prospects, youth intake day, promote to senior squad.
- ⚪ **Real player data** — seed the world with real clubs/players instead of (or alongside)
  generated ones. _Note: real names/likenesses carry licensing considerations — fine for a
  private single-player build, worth a deliberate call before any public distribution._
- ⚪ **Player development & training** — weekly training focus, attribute growth/decline by age.
  Pairs with the youth academy: gives prospects a way to grow.
- ⚪ **Scouting** — hidden attributes, scout assignments, shortlists, report accuracy.
  The discovery loop for real data + youth talent.
- ⚪ **Cup competitions** — knockout tournaments alongside the league; more calendar + showpiece moments.
- ⚪ **Board & expectations** — season objectives, confidence, job security / sacking. The season win condition.
- ⚪ **Improved Transfer Experience** — Sliders instead of inputs, live negotiations, player swaps,
  additional contract clauses, better contract negotation experience, bonuses in contracts, improved transfer hub (ie transfer list) and player search.
- ⚪ **Improved Tactics and Lineup Experience** — Players can play multiple positions, better UI for seeing player condition (morale, fitness, out of position penalty etc.),
  overall cleaner UI for screen and experience (research required)
- ⚪ **Game AI Audit** — general audit of AI around game and team management. Potentially skew AI to interact with player more heavily in transfers (ie when player is transfer listed)

## Ideas / discussed 💭

Candidates to sort into 🟡/⚪/❌. **Confirm which of these we actually discussed:**

- 💭 **Staff & coaching** — assistant, coaches, physios affecting training/injury/match.
- 💭 **Injuries & suspensions depth** — injury types/durations, cards → bans, rotation pressure.
- 💭 **Contracts & negotiation** — renewals, expiries, free agents, agent demands.
- 💭 **Player morale/interaction** — team talks, individual conversations, unhappiness.
- 💭 **Set pieces / tactical detail** — corners, free kicks, per-player instructions.
- 💭 **Multi-season career** — long careers, records, hall of fame, aging world.
- 💭 **Difficulty / new-game options** — starting club strength, world size, realism sliders.
- 💭 **Onboarding** — first-run guidance for the "read state → decide" loop.
