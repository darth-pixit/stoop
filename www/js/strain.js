// Neck-angle → strain model, zones, and playful equivalents.
// Load curve from Hansraj (2014), Surg Technol Int — force on the cervical
// spine at forward head tilt, converted from lb to kg.
const CURVE = [
  [0, 5.4],   // neutral head ≈ its own weight
  [15, 12.2],
  [30, 18.1],
  [45, 22.2],
  [60, 27.2],
];

export function strainKg(angle) {
  const a = Math.max(0, Math.min(60, angle));
  for (let i = 1; i < CURVE.length; i++) {
    const [a0, k0] = CURVE[i - 1];
    const [a1, k1] = CURVE[i];
    if (a <= a1) return k0 + (k1 - k0) * ((a - a0) / (a1 - a0));
  }
  return CURVE[CURVE.length - 1][1];
}

export const ZONES = [
  { id: 'upright',  label: 'Upright',  range: 'under 15°', min: 0,  max: 15,  emoji: '🙂',
    color: 'var(--zone-upright)',  soft: 'var(--zone-upright-soft)',  hex: '#1E9E3E' },
  { id: 'mild',     label: 'Mild stoop', range: '15–30°',  min: 15, max: 30,  emoji: '😐',
    color: 'var(--zone-mild)',     soft: 'var(--zone-mild-soft)',     hex: '#D98E04' },
  { id: 'moderate', label: 'Deep stoop', range: '30–45°',  min: 30, max: 45,  emoji: '😖',
    color: 'var(--zone-moderate)', soft: 'var(--zone-moderate-soft)', hex: '#E0662E' },
  { id: 'severe',   label: 'Full gargoyle', range: '45°+', min: 45, max: 91, emoji: '🫠',
    color: 'var(--zone-severe)',   soft: 'var(--zone-severe-soft)',   hex: '#CC3344' },
];

export function zoneFor(angle) {
  return ZONES.find((z) => angle < z.max) || ZONES[ZONES.length - 1];
}

export const STOOP_THRESHOLD = 15; // ° — below this counts as upright
// Nudge hysteresis: start stooping at ENTER, only recover at EXIT — a one-
// sample dip to 14.9° shouldn't reset the sustain timer or close the nudge.
export const STOOP_ENTER = 15;
export const STOOP_EXIT = 12;

// Something the reader can actually picture on their neck.
const EQUIVALENTS = [
  [8,  'a bowling ball 🎳'],
  [14, 'three watermelons 🍉🍉🍉'],
  [20, 'a five-year-old kid 🧒'],
  [25, 'a packed check-in suitcase 🧳'],
  [99, 'a mini fridge 🧊'],
];

export function equivalentFor(kg) {
  return EQUIVALENTS.find(([max]) => kg < max)[1];
}

// Curated "what this does to you" facts per zone, for the mobility section.
export const IMPACT_FACTS = {
  upright: {
    title: 'Neutral neck',
    body: 'Your spine stacks like it was designed to. Muscles idle, discs happy, full range of motion on tap.',
    mobility: 'Full mobility preserved — ears, meet shoulders, anytime you like.',
    pct: 4,
  },
  mild: {
    title: 'Mild stoop (15–30°)',
    body: 'Neck extensors start working double shifts to hold your head up. An hour a day here and the muscles that tilt your ear to your shoulder slowly stiffen.',
    mobility: 'Side-bend range typically drops a few degrees after long sessions.',
    pct: 30,
  },
  moderate: {
    title: 'Deep stoop (30–45°)',
    body: 'Roughly 3× your head\'s weight is now hanging off your cervical spine. Upper traps and levator scapulae shorten — the classic "phone neck" tightness.',
    mobility: 'Lateral flexion can lose 10–15° when this becomes a habit.',
    pct: 62,
  },
  severe: {
    title: 'Full gargoyle (45°+)',
    body: 'Around 5× your head\'s weight of strain. Chest closes, breathing gets shallower, and joints in the mid-back stop rotating freely.',
    mobility: 'This is where ear-to-shoulder starts feeling impossible without hiking the shoulder.',
    pct: 88,
  },
};
