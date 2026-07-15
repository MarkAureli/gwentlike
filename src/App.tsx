import { useEffect, useRef, useState } from 'react'
import { chooseMove } from './engine/ai'
import { abilityText, CARD_DEFS, STARTER_DECK } from './engine/cards'
import { describeEvent } from './engine/events'
import { applyMove, createGame, hasLegalTarget, playerTotal, rowTotal } from './engine/game'
import type { CardInstance, GameState, RowKind, Target, Unit } from './engine/types'

const HUMAN = 0 as const
const AI = 1 as const
const AI_DELAY_MS = 1600
const AI_MULLIGAN_DELAY_MS = 700
const DRAW_FLASH_MS = 2000

type TargetKind = 'enemyUnit' | 'allyUnit' | 'enemyRow'

type UiState =
  | { step: 'idle' }
  | { step: 'chooseRow'; iid: number }
  | { step: 'chooseTarget'; iid: number; row: RowKind; targetKind: TargetKind }

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
  const def = CARD_DEFS[unit.defId]
  const powerClass = unit.power > unit.basePower ? 'boosted' : unit.power < unit.basePower ? 'damaged' : ''
  return (
    <button
      className={`unit ${targetable ? 'targetable' : ''}`}
      onClick={onClick}
      disabled={!targetable}
      title={abilityText(def.deploy)}
    >
      <span className={`unit-power ${powerClass}`}>{unit.power}</span>
      <span className="unit-name">{def.name}</span>
    </button>
  )
}

export default function App() {
  const [game, setGame] = useState(newGame)
  const [ui, setUi] = useState<UiState>({ step: 'idle' })
  const [mulliganSel, setMulliganSel] = useState<number[]>([])
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

  function commitPlay(iid: number, row: RowKind, target?: Target) {
    setGame((g) => applyMove(g, { kind: 'play', player: HUMAN, iid, row, target }))
    setUi({ step: 'idle' })
  }

  function onHandClick(card: CardInstance) {
    if (!humanCanAct) return
    if (inMulligan) {
      setMulliganSel((sel) =>
        sel.includes(card.iid)
          ? sel.filter((iid) => iid !== card.iid)
          : sel.length < me.mulligansLeft
            ? [...sel, card.iid]
            : sel,
      )
      return
    }
    if (ui.step !== 'idle' && ui.iid === card.iid) setUi({ step: 'idle' })
    else setUi({ step: 'chooseRow', iid: card.iid })
  }

  function onConfirmMulligan() {
    if (!humanCanAct || !inMulligan) return
    setGame((g) => applyMove(g, { kind: 'mulligan', player: HUMAN, iids: mulliganSel }))
    setMulliganSel([])
  }

  function onMyRowClick(row: RowKind) {
    if (ui.step !== 'chooseRow') return
    const card = me.hand.find((c) => c.iid === ui.iid)
    if (!card) return
    const kind = targetKindFor(game, card.defId)
    if (kind) setUi({ step: 'chooseTarget', iid: ui.iid, row, targetKind: kind })
    else commitPlay(ui.iid, row)
  }

  function onEnemyRowClick(row: RowKind) {
    if (ui.step === 'chooseTarget' && ui.targetKind === 'enemyRow') {
      commitPlay(ui.iid, ui.row, { player: AI, row })
    }
  }

  function onEnemyUnitClick(row: RowKind, iid: number) {
    if (ui.step === 'chooseTarget' && ui.targetKind === 'enemyUnit') {
      commitPlay(ui.iid, ui.row, { player: AI, row, iid })
    }
  }

  function onMyUnitClick(row: RowKind, iid: number) {
    if (ui.step === 'chooseTarget' && ui.targetKind === 'allyUnit') {
      commitPlay(ui.iid, ui.row, { player: HUMAN, row, iid })
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
      ? `Mulligan: select up to ${me.mulligansLeft} card${me.mulligansLeft === 1 ? '' : 's'} to swap, then confirm.`
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
          {units.map((u) => (
            <UnitBadge
              key={u.iid}
              unit={u}
              targetable={isMine ? allyUnitTargetable : enemyUnitTargetable}
              onClick={() => (isMine ? onMyUnitClick(row, u.iid) : onEnemyUnitClick(row, u.iid))}
            />
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
          {me.hand.map((card) => {
            const def = CARD_DEFS[card.defId]
            const selected = inMulligan
              ? mulliganSel.includes(card.iid)
              : ui.step !== 'idle' && ui.iid === card.iid
            const justDrawn = drawnFlash.includes(card.iid)
            return (
              <button
                key={card.iid}
                className={`card ${selected ? 'selected' : ''} ${justDrawn ? 'just-drawn' : ''}`}
                onClick={() => onHandClick(card)}
                disabled={!humanCanAct}
              >
                <span className="card-power">{def.power}</span>
                <span className="card-name">{def.name}</span>
                <span className="card-ability">{abilityText(def.deploy)}</span>
              </button>
            )
          })}
        </div>
        {inMulligan ? (
          <button className="pass-button" onClick={onConfirmMulligan} disabled={!humanCanAct}>
            {mulliganSel.length === 0 ? 'Keep hand' : `Swap ${mulliganSel.length}`}
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
                setMulliganSel([])
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
