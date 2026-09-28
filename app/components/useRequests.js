'use client';

import { useSyncExternalStore } from 'react';
import { watchRequests, requestsNow, REQUESTS_UNKNOWN } from '../../lib/requests-client';

/**
 * Who you've sent a request to, shared by every view (lib/requests-client.js).
 * Pass the answer to hasRequest(row, state) and requestCount(state).
 */
export default function useRequests() {
  return useSyncExternalStore(watchRequests, requestsNow, () => REQUESTS_UNKNOWN);
}
