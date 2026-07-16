import { useEffect, useRef, useState } from 'react'
import { chooseMove } from './engine/ai'
import { CARD_DEFS, cardText, STARTER_DECK } from './engine/cards'
import { describeEvent } from './engine/events'
import { applyMove, createGame, hasLegalTarget, mulliganAllowance, playerTotal, rowTotal } from './engine/game'
import type { CardInstance, GameState, RowKind, Target, Unit } from './engine/types'

const HUMAN = 0 as const
const AI = 1 as const
const AI_DELAY_MS = 1600
const AI_MULLIGAN_DELAY_MS = 700
const DRAW_FLASH_MS = 2000

type TargetKind = 'enemyUnit' | 'allyUnit' | 'enemyRow'

type Placement = { row: RowKind; position: number }

type UiState =
  | { step: 'idle' }
  | { step: 'chooseRow'; iid: number }
  // placement is absent for spells — they never land on a row
  | { step: 'chooseTarget'; iid: number; placement?: Placement; targetKind: TargetKind }

function newGame(): GameState {
  return createGame(STARTER_DECK, STARTER_DECK, Math.floor(Math.random() * 2 ** 31))
}

function targetKindFor(state: GameState, defId: string): TargetKind | null {
  const deploy = CARD_DEFS[defId].deploy
  if (!deploy || !hasLegalTarget(state, HUMAN, defId)) return null
  switch (deploy.type) {
    case 'damage':
      return 'enemyUnit'
    case 'boost':
      return 'allyUnit'
    case 'rowDamage':
      return 'enemyRow'
    default:
      return null
  }
}

function typeGlyph(type: 'spell' | 'artifact'): string {
  return type === 'spell' ? '✦' : '◈'
}

function UnitBadge(props: { unit: Unit; targetable: boolean; onClick?: () => void }) {
  const { unit, targetable, onClick } = props
  const def = CARD_DEFS[unit.defId]
  const powerClass = unit.power > unit.basePower ? 'boosted' : unit.power < unit.basePower ? 'damaged' : ''
  return (
    <button
      className={`unit ${targetable ? 'targetable' : ''} ${unit.type === 'artifact' ? 'artifact' : ''}`}
      onClick={onClick}
      disabled={!targetable}
      title={cardText(def)}
    >
      <span className={`unit-power ${powerClass}`}>{unit.type === 'artifact' ? typeGlyph('artifact') : unit.power}</span>
      <span className="unit-name">{def.name}</span>
    </button>
  )
}

export default function App() {
  const [game, setGame] = useState(newGame)
  const [ui, setUi] = useState<UiState>({ step: 'idle' })
  const [inspect, setInspect] = useState<null | 'deck' | 'graveyard'>(null)
  const [drawnFlash, setDrawnFlash] = useState<number[]>([])
  const seenEvents = useRef(game.events.length)

  // Flash cards newly drawn into the human hand, based on fresh 'drew' events.
  useEffect(() => {
    const fresh = game.events.slice(seenEvents.current)
    seenEvents.current = game.events.length
    const drawn = fresh.flatMap((e) => (e.type === 'drew' && e.player === HUMAN ? [e.iid] : []))
    if (drawn.length > 0) setDrawnFlash(drawn)
  }, [game])

  useEffect(() => {
    if (drawnFlash.length === 0) return
    const t = setTimeout(() => setDrawnFlash([]), DRAW_FLASH_MS)
    return () => clearTimeout(t)
  }, [drawnFlash])

  // The AI takes its turn (mulligan or play) after a thinking pause.
  useEffect(() => {
    if (game.winner !== null || game.current !== AI) return
    const delay = game.phase === 'mulligan' ? AI_MULLIGAN_DELAY_MS : AI_DELAY_MS
    const t = setTimeout(() => {
      setGame((g) => (g.winner === null && g.current === AI ? applyMove(g, chooseMove(g, AI)) : g))
    }, delay)
    return () => clearTimeout(t)
  }, [game])

  const me = game.players[HUMAN]
  const foe = game.players[AI]
  const inMulligan = game.phase === 'mulligan'
  const humanCanAct = game.winner === null && game.current === HUMAN && (inMulligan || !me.passed)

  function commitPlay(iid: number, placement?: Placement, target?: Target) {
    setGame((g) =>
      applyMove(g, { kind: 'play', player: HUMAN, iid, row: placement?.row, position: placement?.position, target }),
    )
    setUi({ step: 'idle' })
  }

  function onHandClick(card: CardInstance) {
    if (!humanCanAct) return
    if (inMulligan) {
      // One click = one swap; the replacement arrives (and flashes) immediately.
      setGame((g) => applyMove(g, { kind: 'mulligan', player: HUMAN, iid: card.iid }))
      return
    }
    if (ui.step !== 'idle' && ui.iid === card.iid) {
      setUi({ step: 'idle' })
      return
    }
    if (CARD_DEFS[card.defId].type === 'spell') {
      // Spells skip row placement: pick a target if one exists, else cast now.
      const kind = targetKindFor(game, card.defId)
      if (kind) setUi({ step: 'chooseTarget', iid: card.iid, targetKind: kind })
      else commitPlay(card.iid)
      return
    }
    setUi({ step: 'chooseRow', iid: card.iid })
  }

  function onEndMulligan() {
    if (!humanCanAct || !inMulligan) return
    setGame((g) => applyMove(g, { kind: 'endMulligan', player: HUMAN }))
  }

  function onPlaceAt(row: RowKind, position: number) {
    if (ui.step !== 'chooseRow') return
    const card = me.hand.find((c) => c.iid === ui.iid)
    if (!card) return
    const kind = targetKindFor(game, card.defId)
    if (kind) setUi({ step: 'chooseTarget', iid: ui.iid, placement: { row, position }, targetKind: kind })
    else commitPlay(ui.iid, { row, position })
  }

  function onMyRowClick(row: RowKind) {
    // Clicking the row background appends to the right end.
    onPlaceAt(row, game.players[HUMAN].rows[row].length)
  }

  function onEnemyRowClick(row: RowKind) {
    if (ui.step === 'chooseTarget' && ui.targetKind === 'enemyRow') {
      commitPlay(ui.iid, ui.placement, { player: AI, row })
    }
  }

  function onEnemyUnitClick(row: RowKind, iid: number) {
    if (ui.step === 'chooseTarget' && ui.targetKind === 'enemyUnit') {
      commitPlay(ui.iid, ui.placement, { player: AI, row, iid })
    }
  }

  function onMyUnitClick(row: RowKind, iid: number) {
    if (ui.step === 'chooseTarget' && ui.targetKind === 'allyUnit') {
      commitPlay(ui.iid, ui.placement, { player: HUMAN, row, iid })
    }
  }

  function onPass() {
    if (!humanCanAct || inMulligan) return
    setUi({ step: 'idle' })
    setGame((g) => applyMove(g, { kind: 'pass', player: HUMAN }))
  }

  const enemyRowTargetable = ui.step === 'chooseTarget' && ui.targetKind === 'enemyRow'
  const enemyUnitTargetable = ui.step === 'chooseTarget' && ui.targetKind === 'enemyUnit'
  const allyUnitTargetable = ui.step === 'chooseTarget' && ui.targetKind === 'allyUnit'
  const rowChoosable = ui.step === 'chooseRow'

  const hint = inMulligan
    ? humanCanAct
      ? `Mulligan: click a card to swap it (${me.mulligansLeft} swap${me.mulligansLeft === 1 ? '' : 's'} left), or finish.`
      : 'Opponent is choosing their mulligan…'
    : ui.step === 'chooseRow'
      ? 'Choose one of your rows to play this card.'
      : ui.step === 'chooseTarget'
        ? ui.targetKind === 'enemyUnit'
          ? 'Choose an enemy unit to damage.'
          : ui.targetKind === 'allyUnit'
            ? 'Choose an allied unit to boost.'
            : 'Choose an enemy row to damage.'
        : humanCanAct
          ? 'Play a card or pass.'
          : me.passed && game.winner === null
            ? 'You passed — waiting for the opponent.'
            : 'Opponent is thinking…'

  function renderRow(player: 0 | 1, row: RowKind) {
    const units = game.players[player].rows[row]
    const isMine = player === HUMAN
    const rowTargetable = !isMine && enemyRowTargetable
    const placeable = isMine && rowChoosable
    return (
      <div
        className={`row ${rowTargetable ? 'row-targetable' : ''} ${placeable ? 'row-placeable' : ''}`}
        onClick={() => (isMine ? onMyRowClick(row) : onEnemyRowClick(row))}
      >
        <div className="row-label">
          <span>{row}</span>
          <span className="row-total">{rowTotal(units)}</span>
        </div>
        <div className="row-units">
          {placeable && (
            <button
              className="gap"
              title="Place here"
              onClick={(e) => {
                e.stopPropagation()
                onPlaceAt(row, 0)
              }}
            />
          )}
          {units.map((u, i) => (
            <span key={u.iid} className="unit-slot">
              <UnitBadge
                unit={u}
                targetable={u.type === 'unit' && (isMine ? allyUnitTargetable : enemyUnitTargetable)}
                onClick={() => (isMine ? onMyUnitClick(row, u.iid) : onEnemyUnitClick(row, u.iid))}
              />
              {placeable && (
                <button
                  className="gap"
                  title="Place here"
                  onClick={(e) => {
                    e.stopPropagation()
                    onPlaceAt(row, i + 1)
                  }}
                />
              )}
            </span>
          ))}
        </div>
      </div>
    )
  }

  const visibleLog = game.events.filter((e) => e.type !== 'drew').slice(-4)

  return (
    <div className="app">
      <header className="topbar">
        <div className="score">
          <span className="player-tag">Opponent</span>
          <span className="crowns">{'●'.repeat(foe.roundWins)}{'○'.repeat(2 - Math.min(2, foe.roundWins))}</span>
          <span className="meta">hand {foe.hand.length} · deck {foe.deck.length} {foe.passed ? '· PASSED' : ''}</span>
          <span className="total">{playerTotal(foe)}</span>
        </div>
        <div className="round-indicator">
          Round {game.round}
          {inMulligan ? ' · Mulligan' : ''}
        </div>
        <div className="score">
          <span className="player-tag">You</span>
          <span className="crowns">{'●'.repeat(me.roundWins)}{'○'.repeat(2 - Math.min(2, me.roundWins))}</span>
          <button className="meta meta-button" onClick={() => setInspect('deck')}>
            deck {me.deck.length}
          </button>
          <button className="meta meta-button" onClick={() => setInspect('graveyard')}>
            grave {me.graveyard.length}
          </button>
          <span className="meta">{me.passed ? 'PASSED' : ''}</span>
          <span className="total">{playerTotal(me)}</span>
        </div>
      </header>

      <main className="board">
        <div className="side enemy-side">
          {renderRow(AI, 'ranged')}
          {renderRow(AI, 'melee')}
        </div>
        <div className="midline" />
        <div className="side my-side">
          {renderRow(HUMAN, 'melee')}
          {renderRow(HUMAN, 'ranged')}
        </div>
      </main>

      <div className="hint">{hint}</div>

      <footer className="hand-area">
        <div className="hand">
          {me.hand.map((card) => {
            const def = CARD_DEFS[card.defId]
            const selected = !inMulligan && ui.step !== 'idle' && ui.iid === card.iid
            const justDrawn = drawnFlash.includes(card.iid)
            return (
              <button
                key={card.iid}
                className={`card ${selected ? 'selected' : ''} ${justDrawn ? 'just-drawn' : ''}`}
                onClick={() => onHandClick(card)}
                disabled={!humanCanAct}
              >
                <span className={`card-power ${def.type}`}>
                  {def.type === 'unit' ? def.power : typeGlyph(def.type)}
                </span>
                <span className="card-name">{def.name}</span>
                <span className="card-ability">{cardText(def)}</span>
              </button>
            )
          })}
        </div>
        {inMulligan ? (
          <button className="pass-button" onClick={onEndMulligan} disabled={!humanCanAct}>
            {me.mulligansLeft === mulliganAllowance(game, HUMAN) ? 'Keep hand' : 'Done'}
          </button>
        ) : (
          <button className="pass-button" onClick={onPass} disabled={!humanCanAct}>
            Pass
          </button>
        )}
      </footer>

      <div className="log">
        {visibleLog.map((e, i) => (
          <div key={`${game.events.length}-${i}`}>{describeEvent(e)}</div>
        ))}
      </div>

      {inspect !== null && (
        <div className="overlay" onClick={() => setInspect(null)}>
          <div className="overlay-box inspect-box" onClick={(e) => e.stopPropagation()}>
            <h2>
              {inspect === 'deck'
                ? `Your deck (${me.deck.length})`
                : `Your graveyard (${me.graveyard.length})`}
            </h2>
            <p className="inspect-note">
              {inspect === 'deck'
                ? 'Sorted by type and name — the draw order stays hidden.'
                : 'In the order the cards arrived.'}
            </p>
            <div className="inspect-list">
              {(inspect === 'deck'
                ? [...me.deck].sort((a, b) => {
                    const da = CARD_DEFS[a.defId]
                    const db = CARD_DEFS[b.defId]
                    return da.type.localeCompare(db.type) || da.name.localeCompare(db.name) || a.iid - b.iid
                  })
                : me.graveyard
              ).map((card) => {
                const def = CARD_DEFS[card.defId]
                return (
                  <div key={card.iid} className="inspect-row">
                    <span className={`card-power ${def.type}`}>
                      {def.type === 'unit' ? def.power : typeGlyph(def.type)}
                    </span>
                    <span className="inspect-name">{def.name}</span>
                    <span className="inspect-ability">{cardText(def)}</span>
                  </div>
                )
              })}
              {(inspect === 'deck' ? me.deck : me.graveyard).length === 0 && (
                <div className="inspect-row inspect-empty">empty</div>
              )}
            </div>
            <button className="pass-button" onClick={() => setInspect(null)}>
              Close
            </button>
          </div>
        </div>
      )}

      {game.winner !== null && (
        <div className="overlay">
          <div className="overlay-box">
            <h1>{game.winner === 'draw' ? 'Draw!' : game.winner === HUMAN ? 'You win!' : 'You lose.'}</h1>
            <p>
              Round wins: {me.roundWins} – {foe.roundWins}
            </p>
            <button
              className="pass-button"
              onClick={() => {
                setUi({ step: 'idle' })
                setGame(newGame())
              }}
            >
              Play again
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
