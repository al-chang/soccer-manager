import { useState } from 'react';
import { useGame, useGameStore } from '../store/gameStore';
import { clubPlayers, totalWages } from '@soccer-manager/engine/squad';
import { overall } from '@soccer-manager/engine/player';
import { positionGroup } from '@soccer-manager/engine/tactics';
import { weeksRemaining } from '@soccer-manager/engine/finance';
import { dayToDate, MONTH_NAMES } from '@soccer-manager/engine/calendar';
import type { LedgerCategory } from '@soccer-manager/engine/types';
import { OvrBadge, PosBadge, PlayerLink, formatMoney } from './common';

// Ledger keys → human labels. Income is stored positive, expense negative; we
// split by the known category set, not the runtime sign (a 0 still belongs to
// its side).
const INCOME_CATS: { key: LedgerCategory; label: string }[] = [
  { key: 'gate', label: 'Gate receipts' },
  { key: 'tv', label: 'TV money' },
  { key: 'prize', label: 'Prize money' },
  { key: 'commercial', label: 'Commercial' },
  { key: 'playerSales', label: 'Player sales' },
];
const EXPENSE_CATS: { key: LedgerCategory; label: string }[] = [
  { key: 'wages', label: 'Wages' },
  { key: 'transferFees', label: 'Transfer fees' },
  { key: 'operations', label: 'Operations' },
  { key: 'bonuses', label: 'Bonuses' },
];

/** £ magnitude (never a negative sign from formatMoney, which mishandles it). */
function money(n: number): string {
  return formatMoney(Math.round(Math.abs(n)));
}
/** Signed £ with an explicit +/- and a plain £0 at zero. */
function signed(n: number): string {
  const r = Math.round(n);
  if (r > 0) return `+${formatMoney(r)}`;
  if (r < 0) return `-${formatMoney(-r)}`;
  return formatMoney(0);
}

/** Fill hue for a fraction-of-cap meter: healthy → tight → over. */
function meterColor(frac: number): string {
  return frac < 0.85 ? 'var(--accent2)' : frac < 1 ? 'var(--amber)' : 'var(--red)';
}

export function FinancesScreen() {
  const game = useGame();
  const resplit = useGameStore((s) => s.resplitBudget);
  const setScreen = useGameStore((s) => s.setScreen);

  const club = game.clubs[game.userClubId];
  const squad = clubPlayers(game, club.id);
  const wageBill = totalWages(squad);
  const weeks = weeksRemaining(game.day);

  // Season net so far = sum of the ledger = the balance delta this season.
  const seasonNet = (Object.values(club.ledger) as number[]).reduce((a, b) => a + b, 0);

  // --- Income / expense breakdown -----------------------------------------
  const income = INCOME_CATS.map((c) => ({ ...c, amount: Math.max(0, club.ledger[c.key]) }));
  const expense = EXPENSE_CATS.map((c) => ({ ...c, amount: Math.abs(club.ledger[c.key]) }));
  const totalIncome = income.reduce((a, b) => a + b.amount, 0);
  const totalExpense = expense.reduce((a, b) => a + b.amount, 0);
  const net = totalIncome - totalExpense;
  // Shared scale so income and expense bars are directly comparable.
  const maxCat = Math.max(1, ...income.map((c) => c.amount), ...expense.map((c) => c.amount));

  // --- Monthly cash-flow trend --------------------------------------------
  const history = club.financeHistory;
  const maxFlow = Math.max(1, ...history.map((h) => Math.abs(h.income + h.expense)));

  // --- Top earners ---------------------------------------------------------
  const earners = [...squad].sort((a, b) => b.contract.wage - a.contract.wage).slice(0, 8);

  // --- Budget slider (transfer ↔ wage) ------------------------------------
  // The slider moves whole £100/week units of wage room. Each unit costs
  // `weeks * 100` of transfer budget (the season-anchored exchange rate the
  // engine uses), so every position maps to an exact, reversible re-split.
  const [k, setK] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const unit = 100; // £/week granularity (matches the engine's WAGE_STEP)
  // Floor at 0 so the slider's resting state is always "no change": if the
  // wage bill ever exceeds the cap (it shouldn't — world gen and rollover both
  // floor the cap at the bill), a positive floor would silently pre-propose a
  // re-split. We show an explicit notice for that state instead.
  const overCap = wageBill > club.wageBudget;
  const kMin = Math.min(0, -Math.floor((club.wageBudget - wageBill) / unit)); // pull room → transfers
  const kMax = Math.floor(club.budget / (unit * weeks)); // push budget → wages
  const kClamped = Math.max(kMin, Math.min(kMax, k));

  const transferDelta = -kClamped * unit * weeks;
  const wageDelta = kClamped * unit;
  const proposedBudget = club.budget + transferDelta;
  const proposedCap = club.wageBudget + wageDelta;
  const canSplit = kMin < 0 || kMax > 0;

  function commit() {
    if (kClamped === 0) return;
    const err = resplit(transferDelta);
    if (err) {
      setMsg(err);
    } else {
      setMsg(null);
      setK(0);
    }
  }
  function reset() {
    setK(0);
    setMsg(null);
  }

  const wageFrac = club.wageBudget > 0 ? wageBill / club.wageBudget : 0;
  const previewFrac = proposedCap > 0 ? wageBill / proposedCap : 0;

  return (
    <div>
      <div className="screen-head">
        <h1>Finances <span className="muted">· Season {game.season}</span></h1>
        <span className="muted small">Board allocations are drawn from the balance, not the balance itself.</span>
      </div>

      {/* Headline tiles */}
      <div className="stat-strip fin-heads">
        <div className="stat-tile">
          <span className="stat-label">Balance</span>
          <span className={`stat-value ${club.balance < 0 ? 'bad-text' : ''}`}>
            {club.balance < 0 ? `-${money(club.balance)}` : money(club.balance)}
          </span>
          <span className="fin-sub muted small">
            Net this season <b className={seasonNet >= 0 ? 'good-text' : 'bad-text'}>{signed(seasonNet)}</b>
          </span>
        </div>

        <div className="stat-tile">
          <span className="stat-label">Transfer budget</span>
          <span className="stat-value">{money(club.budget)}</span>
          <span className="fin-sub muted small">Board allocation to spend on fees</span>
        </div>

        <div className="stat-tile fin-wage-tile">
          <span className="stat-label">Wage bill vs cap</span>
          <span className="stat-value">
            {money(wageBill)}<span className="muted"> / {money(club.wageBudget)}</span> <span className="fin-unit muted">wk</span>
          </span>
          <div className="meter" aria-hidden="true">
            <div className="meter-track">
              <div
                className="meter-fill"
                style={{ width: `${Math.min(100, wageFrac * 100)}%`, background: meterColor(wageFrac) }}
              />
            </div>
          </div>
          <span className="fin-sub muted small">
            {club.wageBudget - wageBill >= 0
              ? <>Wage room <b className="good-text">{money(club.wageBudget - wageBill)}/wk</b></>
              : <>Over cap by <b className="bad-text">{money(wageBill - club.wageBudget)}/wk</b></>}
          </span>
        </div>
      </div>

      <div className="grid-2 fin-grid">
        {/* Season income & expenses */}
        <section className="card span-2">
          <div className="card-head">
            <h2>Season income &amp; expenses</h2>
            <span className="muted small">Totals to date · money in vs money out</span>
          </div>
          {totalIncome === 0 && totalExpense === 0 ? (
            <p className="muted">No money has moved yet this season — figures appear as matches are played and the monthly income lands.</p>
          ) : (
            <>
              <div className="fin-breakdown">
                <div>
                  <div className="fin-col-head">
                    <span className="fin-col-title good-text">Income</span>
                    <span className="fin-col-total good-text">{signed(totalIncome)}</span>
                  </div>
                  <div className="fin-bars">
                    {income.map((c) => (
                      <div className="fin-bar-row" key={c.key} title={`${c.label}: ${money(c.amount)}`}>
                        <span className="fin-bar-label">{c.label}</span>
                        <span className="fin-bar-track">
                          <span className="fin-bar-fill income" style={{ width: `${(c.amount / maxCat) * 100}%` }} />
                        </span>
                        <span className="fin-bar-amt">{money(c.amount)}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="fin-col-head">
                    <span className="fin-col-title bad-text">Expenses</span>
                    <span className="fin-col-total bad-text">-{money(totalExpense)}</span>
                  </div>
                  <div className="fin-bars">
                    {expense.map((c) => (
                      <div className="fin-bar-row" key={c.key} title={`${c.label}: -${money(c.amount)}`}>
                        <span className="fin-bar-label">{c.label}</span>
                        <span className="fin-bar-track">
                          <span className="fin-bar-fill expense" style={{ width: `${(c.amount / maxCat) * 100}%` }} />
                        </span>
                        <span className="fin-bar-amt">-{money(c.amount)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="fin-net">
                <span className="muted">Net {net >= 0 ? 'surplus' : 'deficit'} so far</span>
                <span className={`fin-net-value ${net >= 0 ? 'good-text' : 'bad-text'}`}>{signed(net)}</span>
              </div>
            </>
          )}
        </section>

        {/* Monthly cash-flow trend */}
        <section className="card">
          <div className="card-head">
            <h2>Monthly cash flow</h2>
            <span className="muted small">Net per month</span>
          </div>
          {history.length === 0 ? (
            <p className="muted">
              The cash-flow trend fills in from your monthly finance summaries — the first checkpoint posts at the start of next month.
            </p>
          ) : (
            <div className="fin-trend">
              <div className="fin-trend-plot" role="img" aria-label="Monthly net cash flow across the season">
                <span className="fin-trend-baseline" />
                {history.map((h) => {
                  const flow = h.income + h.expense;
                  const frac = Math.abs(flow) / maxFlow;
                  const up = flow >= 0;
                  const m = dayToDate(h.day, game.startYear).month;
                  const label = MONTH_NAMES[(m + 11) % 12]; // month just completed
                  return (
                    <div
                      className="fin-trend-col"
                      key={h.day}
                      title={`${label}: net ${signed(flow)} (in ${money(h.income)}, out -${money(-h.expense)}) · balance ${h.balance < 0 ? '-' : ''}${money(h.balance)}`}
                    >
                      <span
                        className={`fin-trend-bar ${up ? 'up' : 'down'}`}
                        style={up ? { bottom: '50%', height: `${frac * 50}%` } : { top: '50%', height: `${frac * 50}%` }}
                      />
                    </div>
                  );
                })}
              </div>
              <div className="fin-trend-labels">
                {history.map((h) => {
                  const flow = h.income + h.expense;
                  const m = dayToDate(h.day, game.startYear).month;
                  return (
                    <div className="fin-trend-lcell" key={h.day}>
                      <span className={`fin-trend-val ${flow >= 0 ? 'good-text' : 'bad-text'}`}>{signed(flow)}</span>
                      <span className="fin-trend-month muted">{MONTH_NAMES[(m + 11) % 12]}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        {/* Budget slider */}
        <section className="card">
          <div className="card-head">
            <h2>Re-split the budget</h2>
            <span className="muted small">{weeks} wk left this season</span>
          </div>
          {overCap && (
            <p className="fin-rate small bad-text">
              The wage bill is {money(wageBill - club.wageBudget)}/wk over the cap — shed wages or push transfer budget into wage room.
            </p>
          )}
          {!canSplit ? (
            <p className="muted">
              There's nothing to move right now — the transfer budget is empty and the wage cap already sits on the wage bill.
            </p>
          ) : (
            <>
              <p className="fin-rate muted small">
                Wages spread over the rest of the season: <b>£100/wk</b> of wage room ⇄ <b>{money(unit * weeks)}</b> of transfer budget.
              </p>
              <input
                className="fin-range"
                type="range"
                min={kMin}
                max={kMax}
                step={1}
                value={kClamped}
                onChange={(e) => { setK(Number(e.target.value)); setMsg(null); }}
                aria-label="Shift budget between transfers and wages"
              />
              <div className="fin-range-ends muted small">
                <span>← More transfer budget</span>
                <span>More wage room →</span>
              </div>

              <div className="fin-preview">
                <div className="fin-preview-tile">
                  <span className="stat-label">Transfer budget</span>
                  <span className="stat-value sm">{money(proposedBudget)}</span>
                  {transferDelta !== 0 && (
                    <span className={`fin-sub small ${transferDelta >= 0 ? 'good-text' : 'bad-text'}`}>{signed(transferDelta)}</span>
                  )}
                </div>
                <div className="fin-preview-tile">
                  <span className="stat-label">Wage cap</span>
                  <span className="stat-value sm">{money(proposedCap)}<span className="muted"> wk</span></span>
                  {wageDelta !== 0 && (
                    <span className={`fin-sub small ${wageDelta >= 0 ? 'good-text' : 'bad-text'}`}>{signed(wageDelta)}/wk room</span>
                  )}
                </div>
              </div>

              <div className="meter" aria-hidden="true">
                <div className="meter-track">
                  <div className="meter-fill" style={{ width: `${Math.min(100, previewFrac * 100)}%`, background: meterColor(previewFrac) }} />
                </div>
              </div>
              <span className="fin-sub muted small">
                Wage bill {money(wageBill)}/wk against the {kClamped === 0 ? 'current' : 'proposed'} cap of {money(proposedCap)}/wk
              </span>

              {msg && <p className="action-msg" role="alert">{msg}</p>}
              <div className="fin-slider-actions">
                <button className="btn primary" disabled={kClamped === 0} onClick={commit}>Confirm re-split</button>
                <button className="btn" disabled={kClamped === 0} onClick={reset}>Reset</button>
              </div>
            </>
          )}
        </section>

        {/* Top earners */}
        <section className="card span-2">
          <div className="card-head">
            <h2>Top earners</h2>
            <button className="btn small" onClick={() => setScreen('squad')}>Full squad</button>
          </div>
          <table className="table compact fin-earners">
            <thead>
              <tr><th>Pos</th><th>Name</th><th>Age</th><th>Ovr</th><th>Weekly wage</th><th>Share of bill</th></tr>
            </thead>
            <tbody>
              {earners.map((p) => {
                const share = wageBill > 0 ? p.contract.wage / wageBill : 0;
                return (
                  <tr key={p.id}>
                    <td><PosBadge pos={p.position} group={positionGroup(p.position)} /></td>
                    <td className="name-cell"><PlayerLink player={p} /></td>
                    <td>{p.age}</td>
                    <td><OvrBadge value={overall(p)} /></td>
                    <td className="fin-wage-cell">{money(p.contract.wage)}</td>
                    <td>
                      <div className="fin-share" title={`${Math.round(share * 100)}% of the wage bill`}>
                        <span className="fin-share-fill" style={{ width: `${share * 100}%` }} />
                        <span className="fin-share-pct muted small">{Math.round(share * 100)}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {earners.length === 0 && <tr><td colSpan={6} className="muted">No players on the books.</td></tr>}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
