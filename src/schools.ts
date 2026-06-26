// School registry + theming. The engine is school-agnostic; this is the single
// place that knows which schools exist, their colors, and where their data is.
// Adding a school = add an entry here (+ its dataset) — nothing else changes.

import { michiganBasketball, type Dataset } from './data'

export interface Theme {
  /** Primary school color — deep panels & text-on-accent. */
  brand: string
  /** Lighter primary — the hero glow. */
  brand2: string
  /** Highlight color — maize, Carolina blue, etc. */
  accent: string
  /** Page background base. */
  ink: string
}

export interface School {
  id: string
  name: string // "Michigan"
  short: string // "Michigan" (used in share text)
  mascot: string // "Wolverines"
  emoji: string // crest stand-in until real logos
  theme: Theme
  /** Basketball dataset, when the school is live. */
  basketball?: Dataset
  /** False = shown in the picker as "coming soon" (no data yet). */
  available: boolean
}

export const SCHOOLS: School[] = [
  {
    id: 'michigan',
    name: 'Michigan',
    short: 'Michigan',
    mascot: 'Wolverines',
    emoji: '〽️',
    // Michigan maize & blue (official: Blue #00274C, Maize #FFCB05).
    theme: {
      brand: '#00274c',
      brand2: '#0a3a6b',
      accent: '#ffcb05',
      ink: '#0c1620',
    },
    basketball: michiganBasketball,
    available: true,
  },
  {
    id: 'unc',
    name: 'North Carolina',
    short: 'UNC',
    mascot: 'Tar Heels',
    emoji: '🐏',
    // Carolina blue & navy (official: Carolina Blue #4B9CD3, Navy #13294B).
    theme: {
      brand: '#13294b',
      brand2: '#1d3f6e',
      accent: '#4b9cd3',
      ink: '#0a1422',
    },
    basketball: undefined,
    available: false,
  },
]

export const DEFAULT_SCHOOL_ID = 'michigan'

export function getSchool(id: string | null | undefined): School | undefined {
  return SCHOOLS.find((s) => s.id === id)
}

/** Push a school's theme into the CSS custom properties read by index.css. */
export function applyTheme(
  theme: Theme,
  root: HTMLElement = document.documentElement,
): void {
  root.style.setProperty('--brand', theme.brand)
  root.style.setProperty('--brand-2', theme.brand2)
  root.style.setProperty('--accent', theme.accent)
  root.style.setProperty('--ink', theme.ink)
}
