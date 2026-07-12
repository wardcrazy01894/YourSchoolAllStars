/**
 * Map honor strings (as they appear in the datasets, e.g. "First-Team All-ACC
 * (2005)") to a distinct badge glyph, so the pool table can show *what kind*
 * of decoration a player has instead of a single generic ★.
 *
 * Two families, so national vs conference honors read differently at a glance:
 * stars (🏆🌟⭐✨) are national, medals (👑🥇🥈🥉🎖️) are conference. Specialty
 * awards (defense, freshman, sixth man, tournament) get their own glyphs, and
 * anything unrecognized keeps the old ★ so no honor ever renders blank.
 */

interface Rule {
  test: (h: string) => boolean
  emoji: string
  label: string
}

/** Ordered most-prestigious-first; the first matching rule wins, and badge
 *  output is sorted by rule index so 🏆 always leads. Order also resolves
 *  overlaps: All-American before all-conference team matching, and the
 *  specialty awards (defensive/freshman/sixth-man POYs) before the generic
 *  "Player of the Year" rule that would otherwise swallow them. */
const RULES: Rule[] = [
  {
    // Basketball (Wooden/Naismith/…) and football (Heisman/Camp/Maxwell)
    // national player-of-the-year hardware share the trophy.
    test: (h) =>
      /wooden award|naismith|oscar robertson|bob cousy|national player of the year|heisman|walter camp|maxwell award/i.test(
        h,
      ),
    emoji: '🏆',
    label: 'National Player of the Year',
  },
  {
    // "McDonald's All-American" is a high-school recruiting honor that would
    // otherwise wear the college first-team 🌟 — excluded here and given its
    // own badge further down the prestige order.
    test: (h) =>
      /all.americ/i.test(h) && !/second|third|honorable|mcdonald/i.test(h),
    emoji: '🌟',
    label: 'First-Team All-American',
  },
  {
    test: (h) => /all.americ/i.test(h) && /second/i.test(h),
    emoji: '⭐',
    label: 'Second-Team All-American',
  },
  {
    test: (h) => /all.americ/i.test(h) && !/mcdonald/i.test(h),
    emoji: '✨',
    label: 'Third-Team / HM All-American',
  },
  {
    test: (h) =>
      /most outstanding player|tournament (mvp|mop)|all-tournament|nit most valuable/i.test(
        h,
      ),
    emoji: '🏅',
    label: 'Tournament MVP / MOP',
  },
  {
    test: (h) => /defensive/i.test(h),
    emoji: '🛡️',
    label: 'Defensive honors',
  },
  {
    test: (h) => /sixth man/i.test(h),
    emoji: '🔥',
    label: 'Sixth Man of the Year',
  },
  {
    test: (h) => /freshman|rookie/i.test(h),
    emoji: '🌱',
    label: 'Freshman / rookie honors',
  },
  {
    test: (h) => /player of the year/i.test(h),
    emoji: '👑',
    label: 'Conference Player of the Year',
  },
  {
    test: (h) => /first.team/i.test(h),
    emoji: '🥇',
    label: 'First-Team All-Conference',
  },
  {
    test: (h) => /second.team/i.test(h),
    emoji: '🥈',
    label: 'Second-Team All-Conference',
  },
  {
    test: (h) => /third.team/i.test(h),
    emoji: '🥉',
    label: 'Third-Team All-Conference',
  },
  {
    test: (h) => /honorable mention/i.test(h),
    emoji: '🎖️',
    label: 'All-Conference Honorable Mention',
  },
  {
    test: (h) => /mcdonald/i.test(h),
    emoji: '🍔',
    label: "McDonald's All-American (high school)",
  },
]

const FALLBACK: Rule = {
  test: () => true,
  emoji: '★',
  label: 'Other honor',
}

function ruleFor(honor: string): Rule {
  return RULES.find((r) => r.test(honor)) ?? FALLBACK
}

/** The badge glyph for a single honor string. */
export function honorEmoji(honor: string): string {
  return ruleFor(honor).emoji
}

export interface HonorBadge {
  emoji: string
  label: string
  /** The honor strings that produced this badge (for the tooltip). */
  honors: string[]
}

export interface LegendEntry {
  emoji: string
  label: string
}

/** Every badge glyph the classifier can produce, most prestigious first —
 *  drives the on-page badge key (hover tooltips don't exist on touch). */
export const HONOR_LEGEND: LegendEntry[] = [
  ...RULES.map(({ emoji, label }) => ({ emoji, label })),
  { emoji: FALLBACK.emoji, label: FALLBACK.label },
]

/** Collapse a player's honors into distinct badges, most prestigious first.
 *  Honors sharing a glyph merge into one badge carrying all their strings. */
export function honorBadges(honors: string[]): HonorBadge[] {
  const byEmoji = new Map<string, { rank: number; badge: HonorBadge }>()
  for (const honor of honors) {
    const rule = ruleFor(honor)
    const idx = RULES.indexOf(rule)
    const rank = idx === -1 ? RULES.length : idx
    const existing = byEmoji.get(rule.emoji)
    if (existing) {
      existing.badge.honors.push(honor)
    } else {
      byEmoji.set(rule.emoji, {
        rank,
        badge: { emoji: rule.emoji, label: rule.label, honors: [honor] },
      })
    }
  }
  return [...byEmoji.values()]
    .sort((a, b) => a.rank - b.rank)
    .map((e) => e.badge)
}
