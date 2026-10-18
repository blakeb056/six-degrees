// The pages' side of Sixgree Classes: GET /api/class and one POST per change
// (app/api/class/route.js, lib/class-store.js). Plain fetches; every answer
// says what the page shows next.

async function send(body) {
  try {
    const r = await fetch('/api/class', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    return r.ok ? d : { error: d.error || 'Could not save that.' };
  } catch {
    return { error: 'Could not reach the app. Reload this page to see what is saved.' };
  }
}

/** The class state: { class, offer, offerOpen, classes, build, questions, guess, meters, people? }, or { error }. */
export async function loadClass({ people = false } = {}) {
  try {
    const r = await fetch(`/api/class${people ? '?people=1' : ''}`, { cache: 'no-store' });
    const d = await r.json().catch(() => ({}));
    return r.ok ? d : { error: d.error || 'Could not load your class.' };
  } catch {
    return { error: 'Could not reach the app.' };
  }
}

export const pickClass = (key) => send({ action: 'pick', class: key });
export const saveTarget = (key, setup) => send({ action: 'setup', class: key, setup });
export const skipOffer = () => send({ action: 'skip-offer' });
export const nextDuel = (key, mode = 'standard') => send({ action: 'duel', class: key, mode });
export const answerDuel = (key, pair, choice, ms) => send({ action: 'answer', class: key, pair, choice, ms });
export const undoDuel = (key) => send({ action: 'undo', class: key });
export const finishDuels = (key) => send({ action: 'finish', class: key });
export const skipQuestions = (key) => send({ action: 'skip-questions', class: key });
export const saveAvoid = (key, avoid) => send({ action: 'avoid', class: key, avoid });
export const loadReveal = (key) => send({ action: 'reveal', class: key });
export const react = (key, personId, verdict) => send({ action: 'react', class: key, personId, verdict });
export const retake = (key) => send({ action: 'retake', class: key });
