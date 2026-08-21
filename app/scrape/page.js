'use client';

import { useEffect, useState } from 'react';

export default function ScrapePage() {
  const [status, setStatus] = useState('Waiting for data...');
  const [count, setCount] = useState(0);
  const [error, setError] = useState(null);

  useEffect(() => {
    // Listen for messages from the bookmarklet
    function handleMessage(event) {
      // Accept from any origin (bookmarklet runs on LinkedIn)
      const { connections, type, bridgeId } = event.data || {};
      if (!connections) return;

      setStatus(`Received ${connections.length} connections. Pushing to database...`);
      setCount(connections.length);

      fetch('/api/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connections, type: type || 'degree1', bridgeId }),
      })
        .then(r => r.json())
        .then(data => {
          if (data.success) {
            setStatus(`Done! ${data.processed} connections saved. You can close this tab.`);
            // Notify the bookmarklet that we're done
            if (window.opener) {
              window.opener.postMessage({ done: true }, '*');
            }
          } else {
            setError(data.error || 'Unknown error');
            setStatus('Error saving data');
          }
        })
        .catch(err => {
          setError(err.message);
          setStatus('Error connecting to server');
        });
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  return (
    <div style={{
      minHeight: '100vh', background: '#0a0a1a', color: '#fff',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    }}>
      <h1 style={{
        fontSize: 28, fontWeight: 700, marginBottom: 8,
        background: 'linear-gradient(135deg, #FFD700, #9B59B6, #3498DB)',
        WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
      }}>
        6 Degrees Scraper
      </h1>
      <div style={{ fontSize: 18, marginBottom: 16 }}>{status}</div>
      {count > 0 && !error && (
        <div style={{
          background: 'rgba(255,215,0,0.1)', border: '1px solid rgba(255,215,0,0.3)',
          borderRadius: 8, padding: '12px 24px', fontSize: 14,
        }}>
          {count} connections processed
        </div>
      )}
      {error && (
        <div style={{
          background: 'rgba(255,0,0,0.1)', border: '1px solid rgba(255,0,0,0.3)',
          borderRadius: 8, padding: '12px 24px', fontSize: 14, color: '#ff6b6b',
        }}>
          Error: {error}
        </div>
      )}
      <p style={{ fontSize: 12, color: '#666', marginTop: 24, maxWidth: 400, textAlign: 'center' }}>
        This page receives data from the bookmarklet scraper running on LinkedIn.
        It pushes connections to the database, scores them, and updates the visualization.
      </p>
    </div>
  );
}
