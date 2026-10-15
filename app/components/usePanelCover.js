'use client';

import { useEffect, useId } from 'react';
import { coverPanel } from '../../lib/panel-cover';

/**
 * While `open`, this menu, panel or note is over Sixgree's own browser, so the
 * browser steps aside for it (lib/panel-cover.js). Anywhere but the desktop
 * app nothing listens, and this costs nothing.
 */
export default function usePanelCover(open) {
  const id = useId();
  useEffect(() => (open ? coverPanel(id) : undefined), [open, id]);
}
