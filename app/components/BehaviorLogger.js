'use client';

// The learning log's window session (lib/learning-client.js startBehaviour):
// started once per page load from the app's layout, so every page is covered.
// It draws nothing.

import { useEffect } from 'react';
import { startBehaviour } from '../../lib/learning-client';

export default function BehaviorLogger() {
  useEffect(() => { startBehaviour(); }, []);
  return null;
}
