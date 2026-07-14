// Dataset loader. The curated player list lives in JSON (easy for the
// data-curation pass to regenerate); this module gives it a typed surface and
// is the single import point for the app.

import raw from './michigan-basketball.json'
import vtRaw from './vt-basketball.json'
import uncRaw from './unc-basketball.json'
import flaRaw from './florida-basketball.json'
import vcuRaw from './vcu-basketball.json'
import pittRaw from './pitt-basketball.json'
import fbRaw from './michigan-football.json'
import pittFbRaw from './pitt-football.json'
import flaFbRaw from './florida-football.json'
import vtFbRaw from './vt-football.json'
import type { BballPlayer, FbPlayer } from '../types'

export interface Dataset {
  school: string
  sport: 'basketball'
  /** True while the bundled data is the provisional seed, not the curated set. */
  provisional: boolean
  players: BballPlayer[]
}

export const michiganBasketball: Dataset = {
  school: raw.school,
  sport: 'basketball',
  provisional: raw._provisional === true,
  players: raw.players as BballPlayer[],
}

export const virginiaTechBasketball: Dataset = {
  school: vtRaw.school,
  sport: 'basketball',
  provisional: vtRaw._provisional === true,
  players: vtRaw.players as BballPlayer[],
}

export const northCarolinaBasketball: Dataset = {
  school: uncRaw.school,
  sport: 'basketball',
  provisional: uncRaw._provisional === true,
  players: uncRaw.players as BballPlayer[],
}

export const floridaBasketball: Dataset = {
  school: flaRaw.school,
  sport: 'basketball',
  provisional: flaRaw._provisional === true,
  players: flaRaw.players as BballPlayer[],
}

export const vcuBasketball: Dataset = {
  school: vcuRaw.school,
  sport: 'basketball',
  provisional: vcuRaw._provisional === true,
  players: vcuRaw.players as BballPlayer[],
}

export const pittsburghBasketball: Dataset = {
  school: pittRaw.school,
  sport: 'basketball',
  provisional: pittRaw._provisional === true,
  players: pittRaw.players as BballPlayer[],
}

export interface FootballDataset {
  school: string
  sport: 'football'
  /** True while the bundled data is MOCK/placeholder, not real sourced stats. */
  provisional: boolean
  players: FbPlayer[]
}

export const michiganFootball: FootballDataset = {
  school: fbRaw.school,
  sport: 'football',
  provisional: fbRaw._provisional === true,
  players: fbRaw.players as FbPlayer[],
}

export const pittsburghFootball: FootballDataset = {
  school: pittFbRaw.school,
  sport: 'football',
  provisional: pittFbRaw._provisional === true,
  players: pittFbRaw.players as FbPlayer[],
}

export const floridaFootball: FootballDataset = {
  school: flaFbRaw.school,
  sport: 'football',
  provisional: flaFbRaw._provisional === true,
  players: flaFbRaw.players as FbPlayer[],
}

export const virginiaTechFootball: FootballDataset = {
  school: vtFbRaw.school,
  sport: 'football',
  provisional: vtFbRaw._provisional === true,
  players: vtFbRaw.players as FbPlayer[],
}
