import type { CardDef, DeployEffect } from './types'

const defs: CardDef[] = [
  { id: 'militia', name: 'Militia Recruit', power: 4, provisions: 4 },
  { id: 'shieldbearer', name: 'Shield Bearer', power: 5, provisions: 5 },
  { id: 'pikeman', name: 'Veteran Pikeman', power: 6, provisions: 6 },
  { id: 'champion', name: 'Iron Champion', power: 10, provisions: 11 },
  { id: 'scout', name: 'Longbow Scout', power: 3, provisions: 5, deploy: { type: 'damage', amount: 2 } },
  { id: 'ballista', name: 'Siege Ballista', power: 4, provisions: 8, deploy: { type: 'damage', amount: 3 } },
  { id: 'assassin', name: 'Night Assassin', power: 3, provisions: 9, deploy: { type: 'damage', amount: 5 } },
  { id: 'medic', name: 'Field Medic', power: 3, provisions: 6, deploy: { type: 'boost', amount: 3 } },
  { id: 'banner', name: 'Standard Bearer', power: 4, provisions: 7, deploy: { type: 'boost', amount: 2 } },
  { id: 'drummer', name: 'War Drummer', power: 2, provisions: 6, deploy: { type: 'rowBoost', amount: 1 } },
  { id: 'saboteur', name: 'Saboteur', power: 3, provisions: 7, deploy: { type: 'rowDamage', amount: 1 } },
  { id: 'scholar', name: 'Scholar', power: 2, provisions: 7, deploy: { type: 'draw' } },
]

export const CARD_DEFS: Record<string, CardDef> = Object.fromEntries(defs.map((d) => [d.id, d]))

/** Shared 25-card starter deck used by both sides until deckbuilding exists. */
export const STARTER_DECK: string[] = [
  'militia', 'militia',
  'shieldbearer', 'shieldbearer',
  'pikeman', 'pikeman',
  'champion', 'champion',
  'scout', 'scout',
  'ballista', 'ballista',
  'assassin',
  'medic', 'medic',
  'banner', 'banner',
  'drummer', 'drummer',
  'saboteur', 'saboteur',
  'scholar', 'scholar',
  'militia', 'shieldbearer',
]

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
