import { useMemo, useState, type ReactNode } from 'react';
import { useGame, useGameStore } from '../../store/gameStore';
import { overall, fullName, marketValue } from '@soccer-manager/engine/player';
import { positionGroup } from '@soccer-manager/engine/tactics';
import { clubPlayers, totalWages } from '@soccer-manager/engine/squad';
import { packageValue, playerContractDemand } from '@soccer-manager/engine/transfers';
import { formatDay } from '@soccer-manager/engine/calendar';
import type { Club, DealTerms, ContractTerms, OfferStatus, Player } from '@soccer-manager/engine/types';
import { OvrBadge, PosBadge, formatMoney, MoneyInput } from '../common';

/**
 * A labelled range control. Reuses the shared `.fin-range` slider styling.
 * `money` swaps the read-only display for a typed-entry box (accepts 800k /
 * 2.5m / plain pounds) so big amounts don't have to be dragged to; `suffix`
 * annotates its unit (e.g. "/wk"). Typing past the slider's max is allowed —
 * the track just pegs at its end.
 */
export function Slider({ label, value, min, max, step, onChange, display, money, suffix }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  display?: ReactNode;
  money?: boolean;
  suffix?: string;
}) {
  return (
    <div className="neg-slider">
      <span className="neg-slider-head">
        <span>{label}</span>
        {money
          ? <span className="neg-slider-entry"><MoneyInput value={value} onCommit={onChange} ariaLabel={label} />{suffix}</span>
          : <b>{display}</b>}
      </span>
      <input className="fin-range" type="range" min={min} max={max} step={step}
        value={Math.min(max, Math.max(min, value))}
        onChange={(e) => onChange(Number(e.target.value))} aria-label={label} />
    </div>
  );
}

type Entry = { who: 'you' | 'them' | 'system'; text: string };

const step = (max: number) => Math.max(1000, Math.round(max / 200 / 1000) * 1000);

/** The negotiation modal chrome: overlay, player header and value/wage meta. */
function NegShell({ player, seller, onClose, children }: {
  player: Player;
  seller: Club | null;
  onClose: () => void;
  children: ReactNode;
}) {
  const game = useGame();
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal card neg-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="player-head">
            <h2>{fullName(player)}</h2>
            <OvrBadge value={overall(player)} />
          </div>
          <button className="btn small" onClick={onClose}>✕</button>
        </div>
        <div className="club-meta">
          <span>
            <PosBadge pos={player.position} group={positionGroup(player.position)} /> · Age {player.age}
            {seller && <> · {seller.name}</>}
          </span>
          <span>Valued <b>{formatMoney(marketValue(player, game.day))}</b> · Wage <b>{formatMoney(player.contract.wage)}/wk</b></span>
        </div>
        {children}
      </div>
    </div>
  );
}

/** The deal-package controls shared by an initial bid and the live fee stage:
 * fee, sell-on clause, swap player, and what the package is worth to the seller. */
function DealTermsFields({ player, seller, terms, onChange }: {
  player: Player;
  seller: Club | null;
  terms: DealTerms;
  onChange: (t: DealTerms) => void;
}) {
  const game = useGame();
  const club = game.clubs[game.userClubId];
  // The slider spans exactly what the club can spend: you can always slide up
  // to the full transfer budget and never past it. (A counter above budget
  // still displays — the track just pegs.)
  const feeMax = club.budget;
  const squad = useMemo(() => clubPlayers(game, club.id), [game, club.id]);
  const swapPlayer = terms.swapPlayerId !== null ? game.players[terms.swapPlayerId] : null;
  const pkg = seller ? packageValue(game, seller, player, terms) : terms.fee;

  return (
    <>
      <Slider label="Transfer fee" value={terms.fee} min={0} max={feeMax} step={step(feeMax)}
        onChange={(fee) => onChange({ ...terms, fee })} money />
      <Slider label="Sell-on clause" value={terms.sellOnPct} min={0} max={50} step={5}
        onChange={(sellOnPct) => onChange({ ...terms, sellOnPct })}
        display={terms.sellOnPct === 0 ? 'None' : `${terms.sellOnPct}%`} />

      <label className="neg-slider">
        <span className="neg-slider-head"><span>Swap player</span>{swapPlayer && <b>{formatMoney(marketValue(swapPlayer, game.day))}</b>}</span>
        <select value={terms.swapPlayerId ?? ''}
          onChange={(e) => onChange({ ...terms, swapPlayerId: e.target.value === '' ? null : Number(e.target.value) })}>
          <option value="">No swap</option>
          {squad.map((p) => (
            <option key={p.id} value={p.id}>{fullName(p)} ({p.position}, {overall(p)})</option>
          ))}
        </select>
      </label>
      {swapPlayer && <p className="muted small">Swap execution lands with a later update — for now the AI only prices him into the package.</p>}

      <div className="neg-meta small">
        <span className="muted">They value your package at <b>{formatMoney(pkg)}</b></span>
      </div>
    </>
  );
}

/** Live negotiation session for one outgoing bid: the fee (deal) stage, then the
 * contract stage, each an instant back-and-forth with round-by-round history. */
export function NegotiationModal({ offerId, onClose }: { offerId: number; onClose: () => void }) {
  const game = useGame();
  const counterDealTerms = useGameStore((s) => s.counterDealTerms);
  const acceptCounter = useGameStore((s) => s.acceptCounter);
  const withdrawOffer = useGameStore((s) => s.withdrawOffer);

  const offer = game.offers.find((o) => o.id === offerId);
  const player = offer ? game.players[offer.playerId] : null;

  if (!offer || !player) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal card neg-modal" onClick={(e) => e.stopPropagation()}>
          <p className="muted">This negotiation is no longer active.</p>
          <div className="action-row" style={{ marginBottom: 0 }}>
            <button className="btn" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    );
  }

  const seller = offer.toClubId >= 0 ? game.clubs[offer.toClubId] : null;
  const done = offer.stage === 'done' || offer.status === 'completed';
  const dead = offer.status === 'rejected' || offer.status === 'withdrawn';

  return (
    <NegShell player={player} seller={seller} onClose={onClose}>
      {done
        ? (
          <>
            <p className="action-msg">{fullName(player)} has signed! Welcome to the club.</p>
            <div className="action-row" style={{ marginBottom: 0 }}>
              <button className="btn primary" onClick={onClose}>Done</button>
            </div>
          </>
        )
        : dead
          ? (
            <>
              <p className="muted">Negotiations have broken down — the deal for {fullName(player)} is off. Check your inbox for the details.</p>
              <div className="neg-actions">
                <button className="btn" onClick={onClose}>Close</button>
              </div>
            </>
          )
          : offer.stage === 'contract'
            ? <ContractStage offerId={offerId} onClose={onClose} onCancel={() => { withdrawOffer(offerId); onClose(); }} />
            : <FeeStage offerId={offerId}
                onAcceptCounter={() => acceptCounter(offerId)}
                onWithdraw={() => { withdrawOffer(offerId); onClose(); }}
                submit={counterDealTerms} />}
    </NegShell>
  );
}

/**
 * Opening a new bid on a contracted player, in the same modal as the live
 * negotiation: set the full package (fee / sell-on / swap) and submit. The
 * selling club replies in a day or two — negotiation resumes from the Offers
 * tab once they do.
 */
export function BidModal({ playerId, onClose }: { playerId: number; onClose: () => void }) {
  const game = useGame();
  const bidForPlayer = useGameStore((s) => s.bidForPlayer);
  const player = game.players[playerId];
  const seller = game.clubs[player.clubId];
  const club = game.clubs[game.userClubId];
  const [terms, setTerms] = useState<DealTerms>(() => (
    { fee: Math.min(marketValue(player, game.day), club.budget), sellOnPct: 0, swapPlayerId: null }
  ));
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const submit = () => {
    const err = bidForPlayer(playerId, terms);
    if (err) { setError(err); return; }
    setSubmitted(true);
  };

  return (
    <NegShell player={player} seller={seller} onClose={onClose}>
      {submitted
        ? (
          <>
            <p className="action-msg">Bid submitted — expect a reply from {seller.name} within a day or two.</p>
            <div className="neg-actions">
              <button className="btn primary" onClick={onClose}>Done</button>
            </div>
          </>
        )
        : (
          <>
            <div className="neg-meta muted small">
              <span>New bid</span>
              <span>Budget {formatMoney(club.budget)}</span>
            </div>
            <DealTermsFields player={player} seller={seller} terms={terms} onChange={setTerms} />
            {error && <p className="action-msg" role="alert">{error}</p>}
            <div className="neg-actions">
              <button className="btn primary" disabled={terms.fee <= 0} onClick={submit}>Submit bid</button>
              <button className="btn" onClick={onClose}>Cancel</button>
            </div>
          </>
        )}
    </NegShell>
  );
}

function History({ log, counterpart }: { log: Entry[]; counterpart: string }) {
  if (!log.length) return null;
  return (
    <div className="neg-history">
      {log.map((e, i) => (
        <div key={i} className={`neg-line neg-${e.who}`}>
          <span className="neg-who">{e.who === 'you' ? 'You' : e.who === 'them' ? counterpart : '·'}</span>
          <span>{e.text}</span>
        </div>
      ))}
    </div>
  );
}

function FeeStage({ offerId, onAcceptCounter, onWithdraw, submit }: {
  offerId: number;
  onAcceptCounter: () => void;
  onWithdraw: () => void;
  submit: (offerId: number, terms: DealTerms) => { error: string | null; status: OfferStatus };
}) {
  const game = useGame();
  const offer = game.offers.find((o) => o.id === offerId)!;
  const player = game.players[offer.playerId];
  const seller = offer.toClubId >= 0 ? game.clubs[offer.toClubId] : null;
  const club = game.clubs[game.userClubId];

  const start = offer.status === 'countered' && offer.counterTerms ? offer.counterTerms : offer.terms;
  const [terms, setTerms] = useState<DealTerms>({ ...start });
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<Entry[]>(() => {
    const seed: Entry[] = [{ who: 'you', text: `${offer.rounds > 0 ? 'Offered' : 'Opened at'} ${formatMoney(offer.terms.fee)}.` }];
    if (offer.status === 'countered' && offer.counterTerms) {
      seed.push({ who: 'them', text: `Countered: they want ${formatMoney(offer.counterTerms.fee)}.` });
    }
    return seed;
  });

  const awaiting = offer.status === 'pending';
  const swapPlayer = terms.swapPlayerId !== null ? game.players[terms.swapPlayerId] : null;

  const send = () => {
    let extra = '';
    if (terms.sellOnPct > 0) extra += `, ${terms.sellOnPct}% sell-on`;
    if (swapPlayer) extra += `, + ${fullName(swapPlayer)}`;
    const res = submit(offerId, terms);
    if (res.error) { setError(res.error); return; }
    setError(null);
    // The offer is back on the table ('pending'): the awaiting view takes over.
    setLog((l) => [...l, { who: 'you', text: `Offer ${formatMoney(terms.fee)}${extra}.` }]);
  };

  if (awaiting) {
    return (
      <>
        <History log={log} counterpart="Club" />
        <p className="muted">Your {formatMoney(offer.terms.fee)} bid is on the table — {seller?.name ?? 'the club'} usually responds within a day or two. Continue playing and you'll be pulled back when they answer.</p>
        <div className="neg-actions">
          <button className="btn" onClick={onWithdraw}>Withdraw bid</button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="neg-meta muted small">
        <span>Fee stage</span>
        <span>Budget {formatMoney(club.budget)}</span>
        <span className={offer.patience <= 1 ? 'warn' : ''}>Patience: {Math.max(0, offer.patience)} round{offer.patience === 1 ? '' : 's'} left</span>
      </div>

      <DealTermsFields player={player} seller={seller} terms={terms} onChange={setTerms} />

      <History log={log} counterpart="Club" />
      {error && <p className="action-msg" role="alert">{error}</p>}

      <div className="neg-actions">
        <button className="btn primary" onClick={send}>Send counter</button>
        {offer.status === 'countered' && offer.counterTerms && (
          <button className="btn" disabled={offer.counterTerms.fee > club.budget}
            onClick={onAcceptCounter}>Accept {formatMoney(offer.counterTerms.fee)}</button>
        )}
        <button className="btn" onClick={onWithdraw}>Walk away</button>
      </div>
    </>
  );
}

/**
 * The shared contract-stage form, driving both a transfer's personal-terms round
 * and an own-player renewal. Sliders for wage/length/bonuses/release clause, an
 * instant back-and-forth via `submit`, and a counter pre-filled from the player's
 * `contractTalk`. The caller supplies the meta line, submit action and copy so
 * the mechanics stay identical across the two flows.
 */
function ContractForm({ player, kind, meta, submit, onDone, onCancel, cancelLabel, signedText }: {
  player: Player;
  kind: 'transfer' | 'renewal';
  meta: ReactNode;
  submit: (terms: ContractTerms) => { error: string | null; verdict: 'accept' | 'counter' | 'reject' | 'sent' | null };
  onDone: () => void;
  onCancel: () => void;
  cancelLabel: string;
  signedText: string;
}) {
  const game = useGame();
  const demand = useMemo(() => playerContractDemand(game, player, kind), [game, player, kind]);
  // An outstanding counter from earlier talks pre-fills the form.
  const counter = player.contractTalk?.counter ?? null;
  const start = counter ?? demand;
  const [wage, setWage] = useState(start.wage);
  const [years, setYears] = useState(start.years);
  const [signingBonus, setSigningBonus] = useState(start.signingBonus);
  const [goalBonus, setGoalBonus] = useState(start.goalBonus);
  const [clauseOn, setClauseOn] = useState(start.releaseClause !== null);
  const [clause, setClause] = useState(start.releaseClause ?? Math.round(marketValue(player, game.day) * 2));
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<Entry[]>(() => counter
    ? [{ who: 'them', text: `He counters: ${formatMoney(counter.wage)}/wk over ${counter.years} yr${counter.years === 1 ? '' : 's'} — terms loaded below.` }]
    : [{ who: 'them', text: `He is looking for around ${formatMoney(demand.wage)}/wk over ${demand.years} years.` }]);
  const [signed, setSigned] = useState(false);

  const value = marketValue(player, game.day);
  const wageMax = Math.max(Math.round(demand.wage * 2), player.contract.wage * 2, 5000);
  const bonusMax = Math.max(Math.round(value * 0.3), 250_000);

  const terms: ContractTerms = {
    wage, years, signingBonus, goalBonus,
    releaseClause: clauseOn ? clause : null,
  };

  const send = () => {
    const res = submit(terms);
    if (res.error) { setError(res.error); return; }
    setError(null);
    // Async transfer path: the offer is with the agent, the parent swaps in
    // the awaiting view.
    if (res.verdict === 'sent') return;
    setLog((l) => [...l, { who: 'you', text: `Offer ${formatMoney(wage)}/wk, ${years} yr${years === 1 ? '' : 's'}.` }]);
    if (res.verdict === 'accept') {
      setLog((l) => [...l, { who: 'them', text: 'He accepts! Deal done.' }]);
      setSigned(true);
    } else if (res.verdict === 'counter') {
      const c = useGameStore.getState().game?.players[player.id].contractTalk?.counter;
      if (c) {
        setWage(c.wage);
        setYears(c.years);
        setSigningBonus(c.signingBonus);
        setGoalBonus(c.goalBonus);
        setClauseOn(c.releaseClause !== null);
        if (c.releaseClause !== null) setClause(c.releaseClause);
        setLog((l) => [...l, { who: 'them', text: `He counters: ${formatMoney(c.wage)}/wk over ${c.years} yr${c.years === 1 ? '' : 's'} — terms loaded below.` }]);
      } else {
        setLog((l) => [...l, { who: 'them', text: 'He wants improved terms before he signs.' }]);
      }
    } else {
      setLog((l) => [...l, { who: 'them', text: kind === 'renewal' ? 'He walks away from the talks for now.' : 'He turns those terms down.' }]);
    }
  };

  if (signed) {
    return (
      <>
        <p className="action-msg">{signedText}</p>
        <div className="neg-actions">
          <button className="btn primary" onClick={onDone}>Done</button>
        </div>
      </>
    );
  }

  return (
    <>
      {meta}

      <Slider label="Weekly wage" value={wage} min={0} max={wageMax} step={step(wageMax)}
        onChange={setWage} money suffix="/wk" />
      <Slider label="Contract length" value={years} min={1} max={5} step={1}
        onChange={setYears} display={`${years} yr${years === 1 ? '' : 's'}`} />
      <Slider label="Signing bonus" value={signingBonus} min={0} max={bonusMax} step={step(bonusMax)}
        onChange={setSigningBonus} money />
      <Slider label="Goal bonus" value={goalBonus} min={0} max={20_000} step={500}
        onChange={setGoalBonus} money suffix="/goal" />

      <label className="neg-toggle">
        <input type="checkbox" checked={clauseOn} onChange={(e) => setClauseOn(e.target.checked)} />
        Release clause {clauseOn && <b>{formatMoney(clause)}</b>}
      </label>
      {clauseOn && (
        <Slider label="Clause amount" value={clause} min={0} max={Math.max(Math.round(value * 5), 1_000_000)}
          step={step(Math.round(value * 5) || 1_000_000)} onChange={setClause} money />
      )}

      <History log={log} counterpart="Agent" />
      {error && <p className="action-msg" role="alert">{error}</p>}

      <div className="neg-actions">
        <button className="btn primary" onClick={send}>Offer contract</button>
        <button className="btn" onClick={onCancel}>{cancelLabel}</button>
      </div>
    </>
  );
}

function ContractStage({ offerId, onClose, onCancel }: { offerId: number; onClose: () => void; onCancel: () => void }) {
  const game = useGame();
  const offerContractTerms = useGameStore((s) => s.offerContractTerms);
  const offer = game.offers.find((o) => o.id === offerId)!;
  const player = game.players[offer.playerId];
  const seller = offer.toClubId >= 0 ? game.clubs[offer.toClubId] : null;
  const club = game.clubs[game.userClubId];
  const wageRoom = club.wageBudget - totalWages(clubPlayers(game, club.id));
  // A freshly agreed fee pauses on an "accepted" screen; ongoing talks
  // (an agent counter on the table) skip straight to the form.
  const [proceeded, setProceeded] = useState(player.contractTalk !== null);

  if (offer.contractOffer) {
    return (
      <>
        <div className="neg-meta muted small">
          <span>Contract stage · fee agreed at {formatMoney(offer.terms.fee)}</span>
        </div>
        <p className="muted">Your contract offer ({formatMoney(offer.contractOffer.wage)}/wk over {offer.contractOffer.years} yr{offer.contractOffer.years === 1 ? '' : 's'}) is with his agent — expect an answer within a day or two.</p>
        <div className="neg-actions">
          <button className="btn" onClick={onCancel}>Cancel deal</button>
        </div>
      </>
    );
  }

  if (!proceeded) {
    return (
      <>
        <p className="action-msg">Offer accepted! {seller ? seller.name : 'The club'} have agreed to {formatMoney(offer.terms.fee)} for {fullName(player)}. Personal terms are next.</p>
        <div className="neg-actions">
          <button className="btn primary" onClick={() => setProceeded(true)}>Proceed to contract talks</button>
          <button className="btn" onClick={onCancel}>Cancel deal</button>
        </div>
      </>
    );
  }

  return (
    <ContractForm
      player={player}
      kind="transfer"
      meta={(
        <div className="neg-meta muted small">
          <span>Contract stage · fee agreed at {formatMoney(offer.terms.fee)}</span>
          <span className={wageRoom < 0 ? 'warn' : ''}>Wage room {formatMoney(wageRoom)}/wk</span>
        </div>
      )}
      submit={(terms) => offerContractTerms(offerId, terms)}
      onDone={onClose}
      onCancel={onCancel}
      cancelLabel="Cancel deal"
      signedText={`${fullName(player)} has signed! Welcome to the club.`}
    />
  );
}

/** Standalone renewal negotiation for an own squad player, reusing the transfer
 * contract stage. Opened from the player screen/modal; on accept the player's
 * contract is updated in place and the signing bonus hits the ledger. */
export function RenewalModal({ playerId, onClose }: { playerId: number; onClose: () => void }) {
  const game = useGame();
  const offerRenewalTerms = useGameStore((s) => s.offerRenewalTerms);
  const player = game.players[playerId];

  if (!player || player.clubId !== game.userClubId) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal card neg-modal" onClick={(e) => e.stopPropagation()}>
          <p className="muted">He is no longer one of your players.</p>
          <div className="action-row" style={{ marginBottom: 0 }}>
            <button className="btn" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    );
  }

  const club = game.clubs[game.userClubId];
  const roomForRaise = club.wageBudget - (totalWages(clubPlayers(game, club.id)) - player.contract.wage);

  return (
    <NegShell player={player} seller={null} onClose={onClose}>
      <ContractForm
        player={player}
        kind="renewal"
        meta={(
          <div className="neg-meta muted small">
            <span>Current deal runs to {formatDay(player.contract.expiresDay, game.startYear)}</span>
            <span className={roomForRaise < 0 ? 'warn' : ''}>Wage room {formatMoney(roomForRaise)}/wk</span>
          </div>
        )}
        submit={(terms) => offerRenewalTerms(playerId, terms)}
        onDone={onClose}
        onCancel={onClose}
        cancelLabel="Close"
        signedText={`${fullName(player)} has signed a new deal!`}
      />
    </NegShell>
  );
}
