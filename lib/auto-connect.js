// Auto: one connection request, sent for you from the scanner's Chrome.
//
// Blake, 2026-10-03: "auto add and basically adds the person for them in the
// card or wherever its available. now this will count in scans obviously for
// usage and one thing to prevent problems is that sometimes when adding it'll
// prompt the user to have a email from their work or to send a personal note
// if they have premium so if thats the case then have it close out of that in
// the scanner for adding but it should be seamless." Then: "i just want it next
// to connect button but say auto and makes it the better pick visually".
//
// That reverses the standing rule against automated LinkedIn actions, for this
// one action only: one press, one person. Never a batch, never on a timer. The
// scanner does the pressing (scripts/scrape.py --connect, connect_person); the
// app looks the person up by id and refuses before anything opens
// (app/api/scraper/route.js); this file holds what both sides must agree on:
// the caps, the result names the scanner prints, and the words the page shows.
//
// No Node imports: the page, the route and the tests all read it.

// Invitations in any 24 hours and in any 7 days (scripts/scrape.py
// INVITE_DAY_CAP, INVITE_WEEK_CAP; tests/auto-connect.test.mjs checks they
// match). LinkedIn doesn't publish its invitation limit; people commonly report
// about 100 a week, so the week stays well under that, and the day keeps a
// whole week from going in one sitting.
export const INVITE_CAPS = { day: 15, week: 80 };

// The weekly number people report, shown as a range people report, never as LinkedIn's.
export const REPORTED_WEEKLY_INVITES = 100;

export const AUTO_EXPLAIN = 'Sends the request for you from the scanner’s Chrome, without a note. Counts toward your LinkedIn usage.';

export const AUTO_CONFIRM = 'Auto sends connection requests from your LinkedIn account, one each time you press it. '
  + 'LinkedIn limits how many invitations an account can send, and may restrict accounts that send many.';

// The server's answer until the one-time yes is given (the page then asks it).
export const AUTO_REFUSAL = 'Auto asks once before its first request. Press Auto again and confirm.';

/** When Auto's one-time question was answered yes (ISO time), or null. Saved in Settings (lib/settings.js). */
export const AUTO_ACCEPTED_SETTING = {
  default: null,
  parse(value) {
    if (value === null) return null;
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
      throw new Error('When Auto was first allowed is a date and time.');
    }
    return new Date(value).toISOString();
  },
};

// The one line the scanner prints to say how a request went (scrape.py
// connect_result), read by the route as the job's log arrives.
export const CONNECT_RESULT = /^Connect result: ([a-z-]+)$/;

/** The result named on a log line, or null. */
export function connectResultIn(line) {
  const m = String(line ?? '').trim().match(CONNECT_RESULT);
  return m && Object.hasOwn(OUTCOMES, m[1]) ? m[1] : null;
}

const day = INVITE_CAPS.day;
const week = INVITE_CAPS.week;

// Every result the scanner can print (scrape.py CONNECT_RESULTS; the test
// checks both lists are the same). `marks`: the request is marked as sent here,
// everywhere at once. Only a send the profile then showed as Pending, or one
// that was already pending, does that; anything unclear does not (TRAPS §7).
export const OUTCOMES = {
  sent: { ok: true, marks: true, text: 'Request sent' },
  'already-pending': { ok: true, marks: true, text: 'A request to them was already pending on LinkedIn, so nothing new was sent. It’s marked as sent here.' },
  'email-needed': { text: 'LinkedIn wants their email address before it sends this one. Use Connect to add them yourself.' },
  'no-connect': { text: 'LinkedIn shows no Connect for them here, only Follow or Message, or a request is already out. Nothing was sent.' },
  'not-sent': { text: 'LinkedIn asked something Auto doesn’t answer for you, so it closed that and sent nothing. Use Connect to add them yourself.' },
  unclear: { text: 'Auto pressed Send but couldn’t see the request go through, so it isn’t marked as sent. Use Connect to check their profile.' },
  'not-loaded': { text: 'Their profile didn’t load, so nothing was sent. Try again in a while.' },
  unavailable: { text: 'LinkedIn says their profile isn’t available, so nothing was sent.' },
  'linkedin-limit': { text: 'LinkedIn says this account has reached its invitation limit for now. Nothing was sent.' },
  pushback: { text: 'LinkedIn pushed back, so scanning and Auto are paused for a day. Settings, LinkedIn usage says when it ends.' },
  stopped: { text: 'Stopped before anything was sent.' },
  'not-signed-in': { text: 'LinkedIn isn’t signed in in the scanner’s Chrome. Sign in on the Scan page (step 2), then try again.' },
  cooldown: { text: 'Scanning is paused after LinkedIn pushed back, and Auto waits with it. Nothing was sent.' },
  'invites-day': { text: `Auto has sent ${day} requests in the last 24 hours, its limit. Nothing was sent.` },
  'invites-week': { text: `Auto has sent ${week} requests in the last 7 days, its limit. Nothing was sent.` },
  profiles: { text: 'Today’s profile views are used, and Auto opens their profile to send. Nothing was sent.' },
  'not-found': { text: 'That person isn’t in your network on this computer, so nothing was sent.' },
};

export const RESULT_NAMES = Object.keys(OUTCOMES);

/** Does this result mark the request as sent? */
export const connectMarks = (result) => Boolean(OUTCOMES[result]?.marks);

/**
 * What the page says once an Auto job has ended: { result, ok, marks, text }.
 * `end` is how the job ended (lib/scraper-client.js runScrape): its `outcome`
 * (the route's reading of the result line), else its failure, else a plain
 * "couldn't finish". Never says sent without the scanner saying so.
 */
export function connectOutcome(end) {
  const result = end?.outcome && Object.hasOwn(OUTCOMES, end.outcome) ? end.outcome : null;
  if (result) {
    const o = OUTCOMES[result];
    return { result, ok: Boolean(o.ok), marks: Boolean(o.marks), text: o.text };
  }
  const why = Array.isArray(end?.failure) ? end.failure.filter(Boolean).slice(-2).join(' ') : '';
  return {
    result: null, ok: false, marks: false,
    text: why ? `Auto couldn’t finish, and nothing is marked as sent: ${why}` : 'Auto couldn’t finish, and nothing is marked as sent.',
  };
}

/**
 * Why the route won't start an Auto request because of a cap, or null.
 * `li` is lib/linkedin-limits.js linkedinState: invitesToday, invitesWeek,
 * invitesFreeAt / invitesWeekFreeAt (ms) and profilesLeftToday. `when` turns a
 * time into words.
 */
export function inviteRefusal(li, when = (ms) => new Date(ms).toLocaleString()) {
  if (!li) return null;
  if (li.unreadable) return 'The record of what Sixgree has asked of LinkedIn couldn’t be read, so Auto waits until it can.';
  if (li.invitesToday >= day) {
    return `Auto has sent ${day} requests in the last 24 hours, its limit.${li.invitesFreeAt ? ` The next one frees up ${when(li.invitesFreeAt)}.` : ''}`;
  }
  if (li.invitesWeek >= week) {
    return `Auto has sent ${week} requests in the last 7 days, its limit.${li.invitesWeekFreeAt ? ` The next one frees up ${when(li.invitesWeekFreeAt)}.` : ''}`;
  }
  if (li.profilesLeftToday === 0) {
    return 'Today’s profile views are used, and Auto opens their profile to send the request. Try again once one frees up (Settings, LinkedIn usage).';
  }
  return null;
}

/**
 * Why this person can't be sent a request from here, or null when they can.
 * `person` is their row; `connected` is true when they're one of your own
 * connections (any copy of them at degree 1); `requested` when a request to
 * them is already out (any copy marked sent or pending).
 */
export function personRefusal(person, { connected = false, requested = false, accepted = false } = {}) {
  if (!person) return { status: 400, error: 'That person could not be found.' };
  const name = person.name || 'They';
  if (connected || accepted || person.degree === 1) return { status: 409, error: `${name} is already one of your connections.` };
  if (requested) return { status: 409, error: `A request to ${name} is already out.` };
  if (!person.profile_url) return { status: 400, error: `There is no LinkedIn profile on file for ${name}.` };
  return null;
}
