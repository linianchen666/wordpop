const { fsrs, generatorParameters, createEmptyCard, Rating, State } = require('ts-fsrs');

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MAX_INTERVAL = 90 * DAY;
const FSRS_OPTIONS = Object.freeze({
  request_retention: 0.9,
  maximum_interval: 90,
  enable_fuzz: false,
  enable_short_term: true
});
const engine = fsrs(generatorParameters(FSRS_OPTIONS));
const RATINGS = Object.freeze({ unknown: Rating.Again, fuzzy: Rating.Hard,
  known: Rating.Good, easy: Rating.Easy, mastered: Rating.Easy });
const LEGACY_INTERVALS = [0, 5 * MINUTE, 30 * MINUTE, 4 * HOUR,
  DAY, 2 * DAY, 4 * DAY, 7 * DAY, 15 * DAY, MAX_INTERVAL];

function stageForInterval(interval) {
  if (interval >= 15 * DAY) return 8;
  if (interval >= 7 * DAY) return 7;
  if (interval >= 4 * DAY) return 6;
  if (interval >= 2 * DAY) return 5;
  if (interval >= DAY) return 4;
  if (interval >= 4 * HOUR) return 3;
  if (interval >= 30 * MINUTE) return 2;
  return 1;
}

/** Validate persisted state instead of silently resetting corrupted memory. */
function deserializeCard(value) {
  const card = typeof value === 'string' ? JSON.parse(value) : { ...value };
  if (!card || typeof card !== 'object') throw new Error('Invalid FSRS card');
  for (const field of ['stability', 'difficulty', 'elapsed_days', 'scheduled_days',
    'learning_steps', 'reps', 'lapses', 'state']) {
    if (!Number.isFinite(card[field]) || card[field] < 0) throw new Error(`Invalid FSRS ${field}`);
  }
  if (card.difficulty > 10 || ![0, 1, 2, 3].includes(card.state) ||
    ['learning_steps', 'reps', 'lapses'].some(field => !Number.isInteger(card[field]))) {
    throw new Error('Invalid FSRS card state');
  }
  card.due = new Date(card.due);
  if (!Number.isFinite(card.due.getTime())) throw new Error('Invalid FSRS due date');
  if (card.last_review != null) {
    card.last_review = new Date(card.last_review);
    if (!Number.isFinite(card.last_review.getTime())) throw new Error('Invalid FSRS last review');
  } else if (card.state !== State.New) {
    throw new Error('Missing FSRS last review');
  }
  return card;
}

/** Bootstrap legacy progress once; incomplete history cannot be reconstructed. */
function cardForProgress(existing, now) {
  if (existing?.fsrs_card) return deserializeCard(existing.fsrs_card);
  if (!existing) return createEmptyCard(new Date(now));
  const lastReview = Number.isFinite(existing.last_review_at)
    ? Math.min(now, existing.last_review_at) : now;
  const interval = Math.max(MINUTE, existing.interval || LEGACY_INTERVALS[existing.stage] || MINUTE);
  const seed = engine.next(createEmptyCard(new Date(lastReview)), new Date(lastReview), Rating.Good).card;
  seed.due = new Date(existing.next_review_at || now);
  seed.last_review = new Date(lastReview);
  seed.stability = Math.max(0.1, interval / DAY);
  seed.reps = Math.max(1, existing.repetitions || 1);
  seed.scheduled_days = interval / DAY;
  seed.state = interval >= DAY ? State.Review : State.Learning;
  seed.learning_steps = interval < 10 * MINUTE ? 0 : 1;
  return seed;
}

function calculateReview(existing, action, now = Date.now()) {
  const rating = Object.hasOwn(RATINGS, action) ? RATINGS[action] : undefined;
  if (!rating) throw new Error(`Unsupported review action: ${action}`);
  if (!Number.isFinite(now)) throw new Error('Invalid review time');
  const before = cardForProgress(existing, now);
  if (before.last_review && before.last_review.getTime() > now) {
    throw new Error('Review time is before the last FSRS review');
  }
  // The library owns stability, difficulty, forgetting curve and scheduling.
  const { card, log } = engine.next(before, new Date(now), rating);
  // Upstream enforces Hard < Good < Easy and may exceed maximum_interval by
  // a day at the boundary. Cap the due date without changing its memory model.
  if (card.due.getTime() - now > MAX_INTERVAL) {
    card.due = new Date(now + MAX_INTERVAL);
    card.scheduled_days = MAX_INTERVAL / DAY;
  }
  const interval = card.due.getTime() - now;
  return {
    stage: stageForInterval(interval),
    interval,
    // Retained solely for backward-compatible backups; never used by FSRS.
    efactor: existing?.efactor ?? 2.5,
    repetitions: card.reps,
    next_review_at: card.due.getTime(),
    last_review_at: now,
    correct_count: rating >= Rating.Good ? 1 : 0,
    wrong_count: rating <= Rating.Hard ? 1 : 0,
    mastered_count: 0,
    fsrs_card: JSON.stringify(card),
    fsrs_before: JSON.stringify(before),
    fsrs_log: JSON.stringify(log),
    rating
  };
}

module.exports = { calculateReview, cardForProgress, deserializeCard, stageForInterval,
  FSRS_OPTIONS, RATINGS, MINUTE, HOUR, DAY, MAX_INTERVAL };
