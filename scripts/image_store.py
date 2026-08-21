"""Permanent avatar capture.

LinkedIn CDN image URLs (media.licdn.com) are signed and expire in ~3 weeks, so
storing the raw URL means every avatar breaks on that cycle. Instead, while the
signed URL is still fresh (right after scraping), we download the bytes, crop to a
small square, and re-encode as a tiny WebP saved under public/avatars/. The record
then stores the LOCAL path (/avatars/<slug>.webp), which never expires and is served
free as a static asset (works in the live app, the static demo, and the local build).

Typical output: 96x96 WebP ~2-4 KB per person (vs ~15-40 KB for the original).
"""

import io
import hashlib
import pathlib

import requests
from PIL import Image, ImageOps

REPO = pathlib.Path(__file__).resolve().parent.parent
AVATAR_DIR = REPO / "public" / "avatars"

SIZE = 96        # nodes render small; 96px stays crisp on retina
QUALITY = 72     # WebP quality — good balance for face icons
TIMEOUT = 15


def _slug(key):
    """Stable filename derived from a person's profile URL (or any stable key)."""
    return hashlib.sha1(key.strip().encode("utf-8")).hexdigest()[:16]


def store_avatar(image_url, key, overwrite=True):
    """Download image_url, compress to a small square WebP, save under public/avatars/.

    Returns the local web path ("/avatars/<slug>.webp") or None if the fetch/decode fails
    (e.g. the signed URL already expired -> 403)."""
    if not image_url or not key:
        return None
    slug = _slug(key)
    out = AVATAR_DIR / f"{slug}.webp"
    if out.exists() and not overwrite:
        return "/avatars/%s.webp" % slug
    try:
        resp = requests.get(image_url, timeout=TIMEOUT)
        if resp.status_code != 200 or not resp.content:
            return None
        img = Image.open(io.BytesIO(resp.content))
        img = ImageOps.exif_transpose(img).convert("RGB")
        img = ImageOps.fit(img, (SIZE, SIZE), Image.LANCZOS)  # center-crop to square
        AVATAR_DIR.mkdir(parents=True, exist_ok=True)
        img.save(out, "WEBP", quality=QUALITY, method=6)
        return "/avatars/%s.webp" % slug
    except Exception as e:  # network hiccup, non-image body, decode error
        print("  [image_store] skip %s: %s" % (key[:40], e))
        return None


def localize_images(images):
    """Turn scraper image records that point at expiring licdn URLs into permanent
    local ones. Input/output: list of {"profileUrl", "imageUrl"}. Entries whose
    download or compression fails are dropped (kept as no-image rather than a dead URL)."""
    out = []
    ok = 0
    for rec in images:
        purl = rec.get("profileUrl")
        iurl = rec.get("imageUrl")
        local = store_avatar(iurl, purl) if (purl and iurl) else None
        if local:
            out.append({"profileUrl": purl, "imageUrl": local})
            ok += 1
    print("  [image_store] captured %d/%d avatars -> public/avatars/" % (ok, len(images)))
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
