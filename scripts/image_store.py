"""Permanent avatar capture.

LinkedIn CDN image URLs (media.licdn.com) are signed and expire in ~3 weeks, so
storing the raw URL means every avatar breaks on that cycle. Instead, while the
signed URL is still fresh (right after scraping), we download the bytes, crop to a
small square, and re-encode as a tiny WebP saved under the user's data directory
(~/.six-degrees/avatars, or $SIX_DEGREES_HOME/avatars). The record stores the local
path /avatars/<slug>.webp, which never expires and is served by app/avatars/[file].

Avatars live outside the repo on purpose: they are photographs of real people and
must never be committed, and an installed copy of the app must not write into its
own package directory.

Typical output: 96x96 WebP ~2-4 KB per person (vs ~15-40 KB for the original).
"""

import io
import hashlib
import pathlib
from urllib.parse import urlsplit

import requests
from PIL import Image, ImageOps

import os

def _data_dir():
    return pathlib.Path(os.environ.get("SIX_DEGREES_HOME") or (pathlib.Path.home() / ".six-degrees"))

AVATAR_DIR = _data_dir() / "avatars"

SIZE = 96        # nodes render small; 96px stays crisp on retina
QUALITY = 72     # WebP quality — good balance for face icons
TIMEOUT = 15

# Answers that say nothing about the link: a timeout, or LinkedIn's image
# server asking to slow down. So does any 5xx. Anything else that isn't a 200
# is a definite no (403 once a signed link has expired, 404, 410).
BUSY = {408, 429}


def _slug(key):
    """Stable filename derived from a person's profile URL (or any stable key)."""
    return hashlib.sha1(key.strip().encode("utf-8")).hexdigest()[:16]


def is_linkedin_image(url):
    """Only LinkedIn's own image servers (media.licdn.com and the like), over https.

    Saving a photo is the only time the app fetches one, and a row can hold a
    link that no scan read: one from a copy of a network made by an older
    version, or from the bulk import. A link to anywhere else is never fetched,
    and that person shows initials.
    """
    try:
        parts = urlsplit(str(url or ""))
        host = (parts.hostname or "").lower()
    except ValueError:
        return False
    return parts.scheme == "https" and (host == "licdn.com" or host.endswith(".licdn.com"))


# Pictures already claimed by somebody, keyed by the hash of the downloaded
# bytes. Filled as a run proceeds and consulted before anything is written.
_claimed = {}


def reset_claims():
    """Start a fresh run. Only useful for tests and long-lived processes."""
    _claimed.clear()


class TryLater(Exception):
    """This photo wasn't saved, and its link may still be good.

    No connection, a timeout, LinkedIn's image server busy (408, 429) or down
    (5xx), or the file couldn't be written here. store_avatar returns None only
    for a definite answer about the link, because Save photos forgets a link on
    None: when every failure was None, clicking it offline forgot links only
    days old, and said they had expired (TRAPS §7).
    """


def store_avatar(image_url, key, overwrite=True):
    """Download image_url, compress to a small square WebP, save under the data dir.

    Returns the local web path ("/avatars/<slug>.webp") or None for a definite no:
    the link has expired (403) or is gone, image_url isn't one of LinkedIn's image
    servers (is_linkedin_image), what came back isn't a picture, or this exact
    picture already belongs to somebody else. Raises TryLater when the answer says
    nothing about the link (no connection, LinkedIn's image server busy or down, the
    file couldn't be written). With overwrite=False, a photo already saved for this
    person is kept and nothing is fetched.

    The somebody-else case matters more than it sounds. Files are named after the PERSON —
    sha1(profile_url) — so one photograph handed to fifty people used to become fifty
    separate files holding identical bytes, and nothing downstream could tell. On one
    real database that was 2,821 of 3,486 photographs: mostly LinkedIn's placeholder
    silhouette for people who have no picture, plus genuine mis-attributions from a
    scraper that matched people by the text of their link. Both look the same from
    here, and both are wrong to save. Initials are honest; somebody else's face is not.
    """
    if not image_url or not key:
        return None
    slug = _slug(key)
    out = AVATAR_DIR / f"{slug}.webp"
    if out.exists() and not overwrite:
        return "/avatars/%s.webp" % slug
    if not is_linkedin_image(image_url):
        return None
    try:
        resp = requests.get(image_url, timeout=TIMEOUT)
    except requests.RequestException as e:  # offline, DNS, refused, timed out
        raise TryLater("couldn't reach LinkedIn's image server (%s)" % type(e).__name__)
    if resp.status_code in BUSY or resp.status_code >= 500:
        raise TryLater("LinkedIn's image server is busy or down (it answered %d)" % resp.status_code)
    if resp.status_code != 200 or not resp.content:
        return None

    # Hash what actually arrived, before any re-encoding, so two fetches of
    # the same picture under different signed URLs still collide.
    digest = hashlib.sha256(resp.content).hexdigest()
    owner = _claimed.get(digest)
    if owner is not None and owner != key:
        return None
    _claimed[digest] = key

    try:
        img = Image.open(io.BytesIO(resp.content))
        img = ImageOps.exif_transpose(img).convert("RGB")
        img = ImageOps.fit(img, (SIZE, SIZE), Image.LANCZOS)  # center-crop to square
    except Exception as e:  # not a picture: an error page, or a format Pillow can't read
        print("  [image_store] skip %s: not a picture (%s)" % (key[:40], e))
        return None
    try:
        AVATAR_DIR.mkdir(parents=True, exist_ok=True)
        img.save(out, "WEBP", quality=QUALITY, method=6)
    except Exception as e:  # disk full, no permission, no WebP here: not the link's fault
        raise TryLater("couldn't write the photo to %s (%s)" % (AVATAR_DIR, getattr(e, "strerror", None) or e))
    return "/avatars/%s.webp" % slug


def localize_images(images):
    """Turn scraper image records that point at expiring licdn URLs into permanent
    local ones. Input/output: list of {"profileUrl", "imageUrl"}. Entries whose
    download or compression fails are dropped (kept as no-image rather than a dead URL).
    The scan's links aren't stored, so one that fails for now (TryLater) is read
    again at that person's next scan."""
    out = []
    ok = later = 0
    for rec in images:
        purl = rec.get("profileUrl")
        iurl = rec.get("imageUrl")
        try:
            local = store_avatar(iurl, purl) if (purl and iurl) else None
        except TryLater as e:
            print("  [image_store] skip %s: %s" % (purl[:40], e))
            later += 1
            continue
        if local:
            out.append({"profileUrl": purl, "imageUrl": local})
            ok += 1
    shared = len(images) - ok - later
    print("  [image_store] captured %d/%d avatars -> %s" % (ok, len(images), AVATAR_DIR))
    if shared > 0:
        print("  [image_store] %d skipped: no picture, or the same picture as someone else" % shared)
    if later > 0:
        print("  [image_store] %d not saved this time: couldn't fetch or write them" % later)
    return out


if __name__ == "__main__":
    # Quick self-test: python image_store.py <image_url> <key>
    import sys
    if len(sys.argv) >= 3:
        path = store_avatar(sys.argv[1], sys.argv[2])
        if path:
            f = REPO / "public" / path.lstrip("/")
            print("saved %s (%d bytes)" % (path, f.stat().st_size))
        else:
            print("failed (URL likely expired or not an image)")
