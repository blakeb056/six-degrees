'use client';

import { initialsFor } from '../../lib/tiers';

const FALLBACK = { S: '#FFD700', A: '#9B59B6', B: '#3498DB', C: '#95A5A6', D: '#BDC3C7' };

// A round face with a tier-coloured ring.
//
// Most people have no photo, so the initials disc is the common case, not the
// fallback — and it sits UNDER the photo, so a photo that fails to load just
// reveals it. No state, and no reaching into a sibling node to un-hide it.
export default function Avatar({ person, size = 32, tierColors = FALLBACK }) {
  const c = tierColors[person?.tier] || '#666';
  return (
    <span style={{
      position: 'relative', display: 'inline-block', width: size, height: size, flexShrink: 0,
      borderRadius: '50%', boxShadow: `0 0 0 ${size >= 24 ? 2 : 1}px ${c}`,
    }}>
      <span style={{
        position: 'absolute', inset: 0, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: `${c}2e`, color: c, fontWeight: 800, fontSize: Math.max(7, Math.round(size * 0.36)), lineHeight: 1,
      }}>{initialsFor(person?.name)}</span>
      {person?.profile_image_url && (
        <img
          src={person.profile_image_url}
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
