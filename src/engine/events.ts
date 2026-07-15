import { CARD_DEFS } from './cards'
import type { GameEvent } from './types'

function name(defId: string): string {
  return CARD_DEFS[defId].name
}

/**
 * Human-readable text for an event. Card identities of drawn cards are never
 * mentioned so the shared log doesn't leak hidden information.
 */
export function describeEvent(e: GameEvent): string {
  switch (e.type) {
    case 'gameStarted':
      return `Player ${e.first + 1} wins the coin toss.`
    case 'roundStarted':
      return `Round ${e.round} — Player ${e.leader + 1} goes first.`
    case 'mulliganed':
      return e.count === 0
        ? `Player ${e.player + 1} keeps their hand.`
        : `Player ${e.player + 1} mulligans ${e.count} card${e.count === 1 ? '' : 's'}.`
    case 'played':
      return `Player ${e.player + 1} plays ${name(e.defId)} to the ${e.row} row.`
    case 'drew':
      return `Player ${e.player + 1} draws a card.`
    case 'drawFailed':
      return `${name(e.sourceDefId)} has nothing to draw.`
    case 'damaged':
      return `${name(e.sourceDefId)} deals ${e.amount} damage to ${name(e.defId)}.`
    case 'boosted':
      return `${name(e.sourceDefId)} boosts ${name(e.defId)} by ${e.amount}.`
    case 'destroyed':
      return `${name(e.defId)} is destroyed.`
    case 'passed':
      return e.reason === 'chose'
        ? `Player ${e.player + 1} passes.`
        : `Player ${e.player + 1} is out of cards and passes.`
    case 'roundEnded':
      return e.winner === 'draw'
        ? `Round ${e.round} is a draw (${e.totals[0]}–${e.totals[1]}). Both players gain a round win.`
        : `Player ${e.winner + 1} wins round ${e.round} (${e.totals[0]}–${e.totals[1]}).`
    case 'gameEnded':
      return e.winner === 'draw' ? 'The game ends in a draw.' : `Player ${e.winner + 1} wins the game!`
  }
}
