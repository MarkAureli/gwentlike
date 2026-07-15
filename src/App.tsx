import { useEffect, useState } from 'react'
import { chooseMove } from './engine/ai'
import { abilityText, CARD_DEFS, STARTER_DECK } from './engine/cards'
import { createGame, hasLegalTarget, pass, playCard, playerTotal, rowTotal } from './engine/game'
import type { GameState, RowKind, Target, Unit } from './engine/types'

const HUMAN = 0 as const
const AI = 1 as const
const AI_DELAY_MS = 1600
const DRAW_FLASH_MS = 2000

type TargetKind = 'enemyUnit' | 'allyUnit' | 'enemyRow'

type UiState =
  | { step: 'idle' }
  | { step: 'chooseRow'; handIndex: number }
  | { step: 'chooseTarget'; handIndex: number; row: RowKind; targetKind: TargetKind }

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

function UnitBadge(props: { unit: Unit; targetable: boolean; onClick?: () => void }) {
  const { unit, targetable, onClick } = props
  const powerClass = unit.power > unit.basePower ? 'boosted' : unit.power < unit.basePower ? 'damaged' : ''
  return (
    <button
      className={`unit ${targetable ? 'targetable' : ''}`}
      onClick={onClick}
      disabled={!targetable}
      title={abilityText(CARD_DEFS[unit.defId].deploy)}
    >
      <span className={`unit-power ${powerClass}`}>{unit.power}</span>
      <span className="unit-name">{unit.name}</span>
    </button>
  )
}

export default function App() {
  const [game, setGame] = useState(newGame)
  const [ui, setUi] = useState<UiState>({ step: 'idle' })
  const [drawnFlash, setDrawnFlash] = useState<number | null>(null)

  useEffect(() => {
    if (drawnFlash === null) return
    const t = setTimeout(() => setDrawnFlash(null), DRAW_FLASH_MS)
    return () => clearTimeout(t)
  }, [drawnFlash])

  useEffect(() => {
    if (game.winner !== null || game.current !== AI) return
    const t = setTimeout(() => {
      setGame((g) => {
        if (g.winner !== null || g.current !== AI) return g
        const move = chooseMove(g, AI)
        return move.kind === 'pass' ? pass(g, AI) : playCard(g, AI, move.handIndex, move.row, move.target)
      })
    }, AI_DELAY_MS)
    return () => clearTimeout(t)
  }, [game])

  const me = game.players[HUMAN]
  const foe = game.players[AI]
  const humanCanAct = game.winner === null && game.current === HUMAN && !me.passed

  function commitPlay(handIndex: number, row: RowKind, target?: Target) {
    const next = playCard(game, HUMAN, handIndex, row, target)
    // Played one card yet the hand is the same size within the same round:
    // a card was drawn, and draws always land at the end of the hand.
    const drew =
      next.round === game.round &&
      next.players[HUMAN].hand.length === game.players[HUMAN].hand.length
    setGame(next)
    setUi({ step: 'idle' })
    setDrawnFlash(drew ? next.players[HUMAN].hand.length - 1 : null)
  }

  function onHandClick(i: number) {
    if (!humanCanAct) return
    if (ui.step !== 'idle' && ui.handIndex === i) setUi({ step: 'idle' })
    else setUi({ step: 'chooseRow', handIndex: i })
  }

  function onMyRowClick(row: RowKind) {
    if (ui.step !== 'chooseRow') return
    const kind = targetKindFor(game, me.hand[ui.handIndex])
    if (kind) setUi({ step: 'chooseTarget', handIndex: ui.handIndex, row, targetKind: kind })
    else commitPlay(ui.handIndex, row)
  }

  function onEnemyRowClick(row: RowKind) {
    if (ui.step === 'chooseTarget' && ui.targetKind === 'enemyRow') {
      commitPlay(ui.handIndex, ui.row, { player: AI, row })
    }
  }

  function onEnemyUnitClick(row: RowKind, uid: number) {
    if (ui.step === 'chooseTarget' && ui.targetKind === 'enemyUnit') {
      commitPlay(ui.handIndex, ui.row, { player: AI, row, uid })
    }
  }

  function onMyUnitClick(row: RowKind, uid: number) {
    if (ui.step === 'chooseTarget' && ui.targetKind === 'allyUnit') {
      commitPlay(ui.handIndex, ui.row, { player: HUMAN, row, uid })
    }
  }

  function onPass() {
    if (!humanCanAct) return
    setUi({ step: 'idle' })
    setGame((g) => pass(g, HUMAN))
  }

  const enemyRowTargetable = ui.step === 'chooseTarget' && ui.targetKind === 'enemyRow'
  const enemyUnitTargetable = ui.step === 'chooseTarget' && ui.targetKind === 'enemyUnit'
  const allyUnitTargetable = ui.step === 'chooseTarget' && ui.targetKind === 'allyUnit'
  const rowChoosable = ui.step === 'chooseRow'

  const hint =
    ui.step === 'chooseRow'
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
          {units.map((u) => (
            <UnitBadge
              key={u.uid}
              unit={u}
              targetable={isMine ? allyUnitTargetable : enemyUnitTargetable}
              onClick={() => (isMine ? onMyUnitClick(row, u.uid) : onEnemyUnitClick(row, u.uid))}
            />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="score">
          <span className="player-tag">Opponent</span>
          <span className="crowns">{'●'.repeat(foe.roundWins)}{'○'.repeat(2 - Math.min(2, foe.roundWins))}</span>
          <span className="meta">hand {foe.hand.length} · deck {foe.deck.length} {foe.passed ? '· PASSED' : ''}</span>
          <span className="total">{playerTotal(foe)}</span>
        </div>
        <div className="round-indicator">Round {game.round}</div>
        <div className="score">
          <span className="player-tag">You</span>
          <span className="crowns">{'●'.repeat(me.roundWins)}{'○'.repeat(2 - Math.min(2, me.roundWins))}</span>
          <span className="meta">deck {me.deck.length} {me.passed ? '· PASSED' : ''}</span>
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
          {me.hand.map((defId, i) => {
            const def = CARD_DEFS[defId]
            const selected = ui.step !== 'idle' && ui.handIndex === i
            const justDrawn = drawnFlash === i
            return (
              <button
                key={i}
                className={`card ${selected ? 'selected' : ''} ${justDrawn ? 'just-drawn' : ''}`}
                onClick={() => onHandClick(i)}
                disabled={!humanCanAct}
              >
                <span className="card-power">{def.power}</span>
                <span className="card-name">{def.name}</span>
                <span className="card-ability">{abilityText(def.deploy)}</span>
              </button>
            )
          })}
        </div>
        <button className="pass-button" onClick={onPass} disabled={!humanCanAct}>
          Pass
        </button>
      </footer>

      <div className="log">
        {game.log.slice(-4).map((line, i) => (
          <div key={`${game.log.length}-${i}`}>{line}</div>
        ))}
      </div>

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
