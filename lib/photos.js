// Profile photos are shown from this computer only.
//
// The scanner saves each photo into the data folder as it reads it
// (scripts/image_store.py), and the row points at the saved file,
// `/avatars/<name>`, which app/avatars/[file] serves. A row can also hold a
// link: LinkedIn's own, which older versions stored until the scanner replaced
// it, and which a copy of a network made by one carries too. A page never loads
// a link: it would contact LinkedIn while someone is only looking at their map,
// and the app goes online only when you act. That person shows initials until
// the photo is saved, at the next scan or with Save photos on the Scan page.
// The Content-Security-Policy in next.config.mjs holds the same line in the
// browser.
//
// No imports, so the views and the server share it: every view and the routes
// that store photos check with localPhoto, and the /avatars route serves the
// names AVATAR_FILE allows.

/** A photo the /avatars route serves: a plain file name, no folders. The route uses this same pattern. */
export const AVATAR_FILE = /^[A-Za-z0-9_-]+\.(webp|jpg|jpeg|png)$/;

const PREFIX = '/avatars/';

/** The photo to show for a row's `profile_image_url`: its saved file's path, or null. */
export function localPhoto(url) {
  if (typeof url !== 'string' || !url.startsWith(PREFIX)) return null;
  return AVATAR_FILE.test(url.slice(PREFIX.length)) ? url : null;
}

/**
 * The photos still kept as links, one per person and link:
 * [{ profileUrl, imageUrl }]. `db` is an open node:sqlite database. The
 * scanner saves each (`GET /api/update-images`), or forgets the link on a
 * definite no, so a link is tried until there's an answer.
 */
export function waitingPhotos(db) {
  return db.prepare(`SELECT DISTINCT profile_url AS profileUrl, profile_image_url AS imageUrl
      FROM linkedin_connections
     WHERE profile_image_url IS NOT NULL AND profile_image_url <> ''
       AND substr(profile_image_url, 1, 9) <> '/avatars/'
     ORDER BY profile_url`).all()
    .filter((r) => r.profileUrl && !localPhoto(r.imageUrl));
}

/** How many people have a photo waiting to be saved. */
export function waitingPhotoCount(db) {
  return new Set(waitingPhotos(db).map((r) => r.profileUrl)).size;
}
