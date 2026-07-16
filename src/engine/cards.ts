import type { CardDef, DeployEffect, EndOfTurnEffect } from './types'

const defs: CardDef[] = [
  // Units
  { id: 'militia', name: 'Militia Recruit', type: 'unit', power: 4, provisions: 4 },
  { id: 'shieldbearer', name: 'Shield Bearer', type: 'unit', power: 5, provisions: 5 },
  { id: 'pikeman', name: 'Veteran Pikeman', type: 'unit', power: 6, provisions: 6 },
  { id: 'champion', name: 'Iron Champion', type: 'unit', power: 10, provisions: 11 },
  { id: 'scout', name: 'Longbow Scout', type: 'unit', power: 3, provisions: 5, deploy: { type: 'damage', amount: 2 } },
  { id: 'ballista', name: 'Siege Ballista', type: 'unit', power: 4, provisions: 8, deploy: { type: 'damage', amount: 3 } },
  { id: 'assassin', name: 'Night Assassin', type: 'unit', power: 3, provisions: 9, deploy: { type: 'damage', amount: 5 } },
  { id: 'medic', name: 'Field Medic', type: 'unit', power: 3, provisions: 6, deploy: { type: 'boost', amount: 3 } },
  { id: 'banner', name: 'Standard Bearer', type: 'unit', power: 4, provisions: 7, deploy: { type: 'boost', amount: 2 } },
  { id: 'drummer', name: 'War Drummer', type: 'unit', power: 2, provisions: 6, deploy: { type: 'rowBoost', amount: 1 } },
  { id: 'saboteur', name: 'Saboteur', type: 'unit', power: 3, provisions: 7, deploy: { type: 'rowDamage', amount: 1 } },
  { id: 'scholar', name: 'Scholar', type: 'unit', power: 2, provisions: 7, deploy: { type: 'draw' } },
  { id: 'sapling', name: 'Wild Sapling', type: 'unit', power: 3, provisions: 7, endOfTurn: { type: 'boostSelf', amount: 1 } },
  { id: 'sergeant', name: 'Drill Sergeant', type: 'unit', power: 3, provisions: 7, endOfTurn: { type: 'boostRight', amount: 1 } },
  // Spells — resolve their effect, then go straight to the graveyard
  { id: 'fireball', name: 'Fireball', type: 'spell', provisions: 8, deploy: { type: 'damage', amount: 4 } },
  { id: 'volley', name: 'Arrow Volley', type: 'spell', provisions: 7, deploy: { type: 'rowDamage', amount: 1 } },
  { id: 'blessing', name: 'Blessing', type: 'spell', provisions: 6, deploy: { type: 'boost', amount: 4 } },
  // Artifacts — occupy a row slot with no power; can't be damaged or boosted
  { id: 'watchtower', name: 'Watchtower', type: 'artifact', provisions: 6, deploy: { type: 'damage', amount: 2 } },
]

export const CARD_DEFS: Record<string, CardDef> = Object.fromEntries(defs.map((d) => [d.id, d]))

/** Shared 25-card starter deck used by both sides until deckbuilding exists. */
export const STARTER_DECK: string[] = [
  'militia',
  'shieldbearer',
  'sapling',
  'sergeant',
  'pikeman', 'pikeman',
  'champion', 'champion',
  'scout', 'scout',
  'ballista', 'ballista',
  'assassin',
  'medic', 'medic',
  'banner',
  'drummer',
  'saboteur', 'saboteur',
  'scholar', 'scholar',
  'fireball',
  'volley',
  'blessing',
  'watchtower',
]

export function endOfTurnText(effect: EndOfTurnEffect | undefined): string {
  if (!effect) return ''
  switch (effect.type) {
    case 'boostSelf':
      return `End of turn: boost self by ${effect.amount}.`
    case 'boostRight':
      return `End of turn: boost the unit to the right by ${effect.amount}.`
  }
}

/** Full rules text of a card: deploy ability plus end-of-turn effect. */
export function cardText(def: CardDef): string {
  return [abilityText(def.deploy), endOfTurnText(def.endOfTurn)].filter(Boolean).join(' ')
}

export function abilityText(deploy: DeployEffect | undefined): string {
  if (!deploy) return ''
  switch (deploy.type) {
    case 'damage':
      return `Deploy: deal ${deploy.amount} damage to an enemy unit.`
    case 'boost':
      return `Deploy: boost an allied unit by ${deploy.amount}.`
    case 'rowDamage':
      return `Deploy: deal ${deploy.amount} damage to all units in an enemy row.`
    case 'rowBoost':
      return `Deploy: boost all other allies in this row by ${deploy.amount}.`
    case 'draw':
      return 'Deploy: draw a card.'
  }
}
