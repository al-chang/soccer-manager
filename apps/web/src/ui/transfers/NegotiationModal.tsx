import { useMemo, useState, type ReactNode } from 'react';
import { useGame, useGameStore } from '../../store/gameStore';
import { overall, fullName, marketValue } from '@soccer-manager/engine/player';
import { positionGroup } from '@soccer-manager/engine/tactics';
import { clubPlayers, totalWages } from '@soccer-manager/engine/squad';
import { packageValue, playerContractDemand } from '@soccer-manager/engine/transfers';
import { formatDay } from '@soccer-manager/engine/calendar';
import type { DealTerms, ContractTerms, OfferStatus, Player } from '@soccer-manager/engine/types';
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
  const value = marketValue(player, game.day);
  const done = offer.stage === 'done' || offer.status === 'completed';

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
          <span>Valued <b>{formatMoney(value)}</b> · Wage <b>{formatMoney(player.contract.wage)}/wk</b></span>
        </div>

        {done
          ? (
            <>
              <p className="action-msg">{fullName(player)} has signed! Welcome to the club.</p>
              <div className="action-row" style={{ marginBottom: 0 }}>
                <button className="btn primary" onClick={onClose}>Done</button>
              </div>
            </>
          )
          : offer.stage === 'contract'
            ? <ContractStage offerId={offerId} onClose={onClose} onCancel={() => { withdrawOffer(offerId); onClose(); }} />
            : <FeeStage offerId={offerId}
                onAcceptCounter={() => acceptCounter(offerId)}
                onWithdraw={() => { withdrawOffer(offerId); onClose(); }}
                submit={counterDealTerms} />}
      </div>
    </div>
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
  const value = marketValue(player, game.day);

  const start = offer.status === 'countered' && offer.counterTerms ? offer.counterTerms : offer.terms;
  const [fee, setFee] = useState(start.fee);
  const [sellOn, setSellOn] = useState(start.sellOnPct);
  const [swapId, setSwapId] = useState<number | null>(start.swapPlayerId);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<Entry[]>(() => {
    const seed: Entry[] = [{ who: 'you', text: `Opened at ${formatMoney(offer.terms.fee)}.` }];
    if (offer.status === 'countered' && offer.counterTerms) {
      seed.push({ who: 'them', text: `Countered: they want ${formatMoney(offer.counterTerms.fee)}.` });
    }
    return seed;
  });

  const feeMax = Math.max(Math.round(value * 2.5), offer.terms.fee, player.contract.releaseClause ?? 0, 100_000);
  const squad = useMemo(() => clubPlayers(game, club.id), [game, club.id]);
  const terms: DealTerms = { fee, sellOnPct: sellOn, swapPlayerId: swapId };
  const pkg = seller ? packageValue(game, seller, player, terms) : fee;
  const swapPlayer = swapId !== null ? game.players[swapId] : null;

  const closed = offer.status === 'withdrawn' || offer.status === 'rejected';

  const send = () => {
    let extra = '';
    if (sellOn > 0) extra += `, ${sellOn}% sell-on`;
    if (swapPlayer) extra += `, + ${fullName(swapPlayer)}`;
    const res = submit(offerId, terms);
    if (res.error) { setError(res.error); return; }
    setError(null);
    const next: Entry[] = [{ who: 'you', text: `Offer ${formatMoney(fee)}${extra}.` }];
    if (res.status === 'accepted') next.push({ who: 'them', text: 'Deal agreed — on to personal terms.' });
    else if (res.status === 'countered' && offer.counterTerms) next.push({ who: 'them', text: `Counter: they want ${formatMoney(offer.counterTerms.fee)}.` });
    else if (res.status === 'rejected') next.push({ who: 'them', text: 'They reject the offer flat.' });
    else if (res.status === 'withdrawn') next.push({ who: 'them', text: 'They walk away from the table.' });
    setLog((l) => [...l, ...next]);
  };

  return (
    <>
      <div className="neg-meta muted small">
        <span>Fee stage</span>
        <span>Budget {formatMoney(club.budget)}</span>
        <span className={offer.patience <= 1 ? 'warn' : ''}>Patience: {Math.max(0, offer.patience)} round{offer.patience === 1 ? '' : 's'} left</span>
      </div>

      <Slider label="Transfer fee" value={fee} min={0} max={feeMax} step={step(feeMax)}
        onChange={setFee} money />
      <Slider label="Sell-on clause" value={sellOn} min={0} max={50} step={5}
        onChange={setSellOn} display={sellOn === 0 ? 'None' : `${sellOn}%`} />

      <label className="neg-slider">
        <span className="neg-slider-head"><span>Swap player</span>{swapPlayer && <b>{formatMoney(marketValue(swapPlayer, game.day))}</b>}</span>
        <select value={swapId ?? ''} onChange={(e) => setSwapId(e.target.value === '' ? null : Number(e.target.value))}>
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

      <History log={log} counterpart="Club" />
      {error && <p className="action-msg" role="alert">{error}</p>}

      <div className="neg-actions">
        {closed
          ? <button className="btn primary" onClick={onWithdraw}>Close negotiation</button>
          : (
            <>
              <button className="btn primary" onClick={send}>Send offer</button>
              {offer.status === 'countered' && offer.counterTerms && (
                <button className="btn" disabled={offer.counterTerms.fee > club.budget}
                  onClick={onAcceptCounter}>Accept {formatMoney(offer.counterTerms.fee)}</button>
              )}
              <button className="btn" onClick={onWithdraw}>Walk away</button>
            </>
          )}
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
  submit: (terms: ContractTerms) => { error: string | null; verdict: 'accept' | 'counter' | 'reject' | null };
  onDone: () => void;
  onCancel: () => void;
  cancelLabel: string;
  signedText: string;
}) {
  const game = useGame();
  const demand = useMemo(() => playerContractDemand(game, player, kind), [game, player, kind]);
  const [wage, setWage] = useState(demand.wage);
  const [years, setYears] = useState(demand.years);
  const [signingBonus, setSigningBonus] = useState(demand.signingBonus);
  const [goalBonus, setGoalBonus] = useState(demand.goalBonus);
  const [clauseOn, setClauseOn] = useState(demand.releaseClause !== null);
  const [clause, setClause] = useState(demand.releaseClause ?? Math.round(marketValue(player, game.day) * 2));
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<Entry[]>(() => [{ who: 'them', text: `He is looking for around ${formatMoney(demand.wage)}/wk over ${demand.years} years.` }]);
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
  const club = game.clubs[game.userClubId];
  const wageRoom = club.wageBudget - totalWages(clubPlayers(game, club.id));

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
  const value = marketValue(player, game.day);

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
          </span>
          <span>Valued <b>{formatMoney(value)}</b> · Wage <b>{formatMoney(player.contract.wage)}/wk</b></span>
        </div>

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
      </div>
    </div>
  );
}
