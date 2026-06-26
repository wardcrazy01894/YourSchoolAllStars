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
  emoji: string // generic Unicode crest — we deliberately avoid trademarked school logos
  theme: Theme
  /** Basketball dataset, when the school is live. */
  basketball?: Dataset
  /** Does this school field a football team at all? (VCU does not.) Forward
   * reservation: the sport picker is not built yet — when it is, it must hide
   * football wherever this is false (else VCU would wrongly show football). */
  hasFootball: boolean
  /** Power-5 (major) conference? Drives the conference-strength rating: non-power-5
   * schools take a slight haircut on every player rating (17 ppg in the Big Ten is
   * worth more than 17 ppg in the A-10). Today only VCU (Atlantic 10) is false. */
  power5: boolean
  /** False = shown in the picker as "coming soon" (no playable data yet). */
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
    hasFootball: true,
    power5: true,
    available: true,
  },
  {
    id: 'unc',
    name: 'North Carolina',
    short: 'UNC',
    mascot: 'Tar Heels',
    emoji: '👣', // "Tar Heel" footprints — distinct from VCU's ram
    // Carolina blue & navy (official: Carolina Blue #4B9CD3, Navy #13294B).
    theme: {
      brand: '#13294b',
      brand2: '#1d3f6e',
      accent: '#4b9cd3',
      ink: '#0a1422',
    },
    basketball: undefined,
    hasFootball: true,
    power5: true,
    available: false,
  },
  {
    id: 'florida',
    name: 'Florida',
    short: 'Florida',
    mascot: 'Gators',
    emoji: '🐊',
    // Florida orange & blue (official: Blue #0021A5, Orange #FA4616).
    theme: {
      brand: '#0021a5',
      brand2: '#1c3fb0',
      accent: '#fa4616',
      ink: '#0a1124',
    },
    basketball: undefined,
    hasFootball: true,
    power5: true,
    available: false,
  },
  {
    id: 'vt',
    name: 'Virginia Tech',
    short: 'Va Tech',
    mascot: 'Hokies',
    emoji: '🦃',
    // Hokie maroon & burnt orange (official: Maroon #630031, Orange #CF4420).
    theme: {
      brand: '#630031',
      brand2: '#7d2540',
      accent: '#cf4420',
      ink: '#1a0710',
    },
    basketball: undefined,
    hasFootball: true,
    power5: true,
    available: false,
  },
  {
    id: 'pitt',
    name: 'Pittsburgh',
    short: 'Pitt',
    mascot: 'Panthers',
    emoji: '🐾',
    // Pitt navy & gold (official: Navy #003594, Gold #FFB81C).
    theme: {
      brand: '#003594',
      brand2: '#1e4aa8',
      accent: '#ffb81c',
      ink: '#06122e',
    },
    basketball: undefined,
    hasFootball: true,
    power5: true,
    available: false,
  },
  {
    id: 'vcu',
    name: 'VCU',
    short: 'VCU',
    mascot: 'Rams',
    emoji: '🐏',
    // VCU black & gold (official: Gold #F8B300, Black #000000). `brand` is a
    // near-black #1a1a1a (not pure #000000) so the deep panels read as a surface,
    // not a void. Basketball only — VCU does not field a football team.
    theme: {
      brand: '#1a1a1a',
      brand2: '#2e2a17',
      accent: '#f8b300',
      ink: '#0c0c0a',
    },
    basketball: undefined,
    hasFootball: false,
    power5: false, // Atlantic 10 — the lone non-power-5 school today
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
