# Gwentlike

A card game in the style of standalone Gwent (GWENT: The Witcher Card Game): two players, two rows (melee and ranged), best of three rounds, highest total power wins the round. Original cards and abilities — only the core mechanics follow Gwent.

**Play it:** https://markaureli.github.io/gwentlike/

## Play locally

```sh
npm install
npm run dev
```

You play against a simple greedy AI. Each round starts with a mulligan; after that, click a card, then click a placement slot in one of your rows (or the row itself to place rightmost), then pick a target if the card's deploy ability needs one. Pass to end your participation in the round.

## Rules (current)

- Both players draw 10 from a 25-card deck; 3 more at the start of rounds 2 and 3 (hand cap 10).
- Each round opens with a mulligan: the round leader may swap up to 3 cards, the other player up to 2 — one card at a time, drawing each replacement before choosing the next swap (replacements can themselves be swapped). A card shuffled back cannot be redrawn during that same mulligan phase.
- Cards come in three types: **units** (have power and score points), **spells** (no power — their effect resolves and they go straight to the graveyard), and **artifacts** (no power — played to a row like units, but immune to damage/boosts and worth 0 points).
- On your turn: play one card (units/artifacts to your melee or ranged row; spells need no row), or pass. Passing locks you out for the rest of the round.
- When both players have passed, the higher total power wins the round; a tie gives both players a round win. First to 2 round wins takes the game.
- The round winner leads the next round; after a tied round, the player who went second in it leads.
- Deploy abilities resolve when a card is played: single-target damage/boost, row damage/boost, and card draw.
- End-of-turn effects fire after each of their owner's actions (playing a card, and once more on the pass): front (melee) row left-to-right first, then the back (ranged) row left-to-right. Opponent turns don't trigger them. Examples: Wild Sapling (boosts itself by 1), Drill Sergeant (boosts the unit to its right by 1).
- Everything destroyed during a round or still on the board when it ends goes to its owner's graveyard.
- Click your deck or graveyard counters to inspect them; the deck view is sorted by type and name so the actual draw order stays hidden.
- Cards have provision costs in their definitions for future deckbuilding; both players currently use the same starter deck.

## Architecture

- `src/engine/` — pure, framework-free rules engine. Fully covered by `game.test.ts`.
  - **One entry point:** a game is a seed plus a list of `Move`s; `applyMove(state, move)` handles play, pass, and mulligan. This is the seam for replays, search-based AI, and multiplayer.
  - **Typed events:** everything that happens is appended to `state.events` as structured `GameEvent`s. Log text is derived via `events.ts`; the UI can also drive animations from them.
  - **Card instance identity:** every physical card gets an `iid` at game creation and keeps it through deck → hand → board → graveyard, so cards can be referenced anywhere.
  - **Row positioning:** rows are ordered; the play move carries an optional insertion `position` (defaults to append), and `neighborsOf` exposes adjacency for future mechanics. The UI shows clickable insertion slots while placing.
- `src/App.tsx` — React UI on top of the engine.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm test` | Run engine tests (Vitest) |
| `npm run build` | Type-check and build for production |

Pushes to `main` deploy to GitHub Pages automatically (tests must pass).

## Roadmap

- More ability types (orders, timers, shields, spies/card advantage, adjacency effects)
- Deckbuilding with provision limits and factions
- Local hotseat mode, online multiplayer later
- Smarter AI (search-based instead of greedy)
