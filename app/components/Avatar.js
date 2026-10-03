'use client';

import { initialsFor } from '../../lib/tiers';
import { localPhoto } from '../../lib/photos';
import { TIER_COLORS as THEME_TIERS } from '../../lib/themes';

const FALLBACK = THEME_TIERS;   // the theme's dot colours (lib/themes.js)

// A round face with a tier-coloured ring.
//
// Most people have no photo, so the initials disc is the common case, not the
// fallback — and it sits UNDER the photo, so a photo that fails to load just
// reveals it. No state, and no reaching into a sibling node to un-hide it.
// Only a photo saved on this computer is drawn (lib/photos.js).
export default function Avatar({ person, size = 32, tierColors = FALLBACK }) {
  const c = tierColors[person?.tier] || '#666';
  const photo = localPhoto(person?.profile_image_url);
  return (
    <span className="sd-dot-html" style={{
      position: 'relative', display: 'inline-block', width: size, height: size, flexShrink: 0,
      borderRadius: '50%', boxShadow: `0 0 0 ${size >= 24 ? 2 : 1}px ${c}`,
    }}>
      <span style={{
        position: 'absolute', inset: 0, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: `${c}2e`, color: c, fontWeight: 800, fontSize: Math.max(7, Math.round(size * 0.36)), lineHeight: 1,
      }}>{initialsFor(person?.name)}</span>
      {photo && (
        <img
          src={photo}
          alt=""
          loading="lazy"
          decoding="async"
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
          style={{ position: 'absolute', inset: 0, width: size, height: size, borderRadius: '50%', objectFit: 'cover' }}
        />
      )}
    </span>
  );
}
