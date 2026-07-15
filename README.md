# Gwentlike

A card game in the style of standalone Gwent (GWENT: The Witcher Card Game): two players, two rows (melee and ranged), best of three rounds, highest total power wins the round. Original cards and abilities — only the core mechanics follow Gwent.

## Play

```sh
npm install
npm run dev
```

You play against a simple greedy AI. Click a card, click one of your rows to place it, then pick a target if the card's deploy ability needs one. Pass to end your participation in the round.

## Rules (current)

- Both players draw 10 from a 25-card deck; 3 more at the start of rounds 2 and 3 (hand cap 10).
- On your turn: play one card to your melee or ranged row, or pass. Passing locks you out for the rest of the round.
- When both players have passed, the higher total power wins the round; a tie gives both players a round win. First to 2 round wins takes the game.
- The round winner leads the next round.
- Deploy abilities resolve when a unit is played: single-target damage/boost, row damage/boost, and card draw.
- Cards have provision costs in their definitions for future deckbuilding; both players currently use the same starter deck.

## Structure

- `src/engine/` — pure, framework-free rules engine (`game.ts`), card definitions (`cards.ts`), deterministic RNG (`rng.ts`), and a greedy AI (`ai.ts`). Fully covered by `game.test.ts`.
- `src/App.tsx` — React UI on top of the engine.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm test` | Run engine tests (Vitest) |
| `npm run build` | Type-check and build for production |

## Roadmap

- Deckbuilding with provision limits and factions
- More ability types (orders, timers, shields, spies/card advantage)
- Local hotseat mode, online multiplayer later
- Smarter AI (search-based instead of greedy)
