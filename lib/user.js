// User identity — localStorage UUID, no auth
// Each user gets a UUID on first visit. No passwords, no login.
// The browser IS the auth (scraper uses their Chrome session).

const STORAGE_KEY = 'six-degrees-user-id';
const NAME_KEY = 'six-degrees-user-name';

export function getUserId() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(STORAGE_KEY) || null;
}

export function getUserName() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(NAME_KEY) || null;
}

export function setUser(id, name) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, id);
  localStorage.setItem(NAME_KEY, name);
}

export function clearUser() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(NAME_KEY);
}

export function hasUser() {
  return !!getUserId();
}
