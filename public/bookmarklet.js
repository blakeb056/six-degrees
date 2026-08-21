/**
 * 6 Degrees LinkedIn Scraper Bookmarklet
 *
 * Works on two LinkedIn pages:
 * 1. Connections page (/mynetwork/invite-connect/connections/) — scrapes degree-1
 * 2. Search results (/search/results/people/?connectionOf=...) — scrapes degree-2
 *
 * Opens a relay window on the app domain to bypass LinkedIn's CSP
 * and push data to Supabase.
 */
(function() {
  const APP_URL = 'https://six-degrees-linkedin.vercel.app';
  const url = window.location.href;

  // Detect page type
  const isConnectionsPage = url.includes('/mynetwork/invite-connect/connections');
  const isSearchPage = url.includes('/search/results/people') && url.includes('connectionOf');

  if (!isConnectionsPage && !isSearchPage) {
    alert('6 Degrees Scraper: Navigate to your LinkedIn Connections page or a connection search results page first.');
    return;
  }

  // Show progress overlay
  const overlay = document.createElement('div');
  overlay.id = 'sixdeg-overlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:linear-gradient(135deg,#FFD700,#9B59B6);color:#000;padding:12px 20px;font-family:system-ui;font-size:14px;font-weight:600;text-align:center;';
  overlay.textContent = '6 Degrees: Scanning connections...';
  document.body.appendChild(overlay);

  function updateStatus(msg) {
    overlay.textContent = '6 Degrees: ' + msg;
  }

  // ============ CONNECTIONS PAGE SCRAPER ============
  async function scrapeConnections() {
    updateStatus('Loading all connections...');

    // Step 1: Load all by scrolling + clicking "Load more"
    let attempts = 0;
    while (attempts < 120) {
      window.scrollTo(0, document.body.scrollHeight);
      await new Promise(r => setTimeout(r, 500));
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Load more'));
      if (btn) {
        btn.scrollIntoView();
        btn.click();
        attempts++;
        await new Promise(r => setTimeout(r, 1000));
        if (attempts % 10 === 0) {
          const count = document.querySelectorAll('a[href*="/in/"]').length / 2;
          updateStatus('Loading... ' + Math.round(count) + ' connections found');
        }
      } else {
        const count = document.querySelectorAll('a[href*="/in/"]').length / 2;
        if (count > 500 || attempts > 5) break;
        attempts++;
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    // Step 2: Extract all connections
    updateStatus('Extracting connection data...');
    const connections = [];
    const seen = new Set();
    document.querySelectorAll('a[href*="/in/"]').forEach(link => {
      const href = link.getAttribute('href');
      if (link.querySelector('img') && !link.querySelector('img[src*="media.licdn.com"]')) return;

      // Profile picture links have img — get image URL from them
      const img = link.querySelector('img');
      if (img && img.src.includes('media.licdn.com')) {
        const profileUrl = href.startsWith('http') ? href.split('?')[0] : 'https://www.linkedin.com' + href.split('?')[0];
        if (!seen.has(profileUrl)) {
          seen.add(profileUrl);
          // Store image URL, will merge with name data
          const existing = connections.find(c => c.profileUrl === profileUrl);
          if (existing) {
            existing.imageUrl = img.src;
          } else {
            connections.push({ profileUrl, imageUrl: img.src, name: '', headline: '' });
          }
        }
        return;
      }

      // Name/headline links
      if (img) return; // skip if it has img but not media URL
      const profileUrl = href.startsWith('http') ? href.split('?')[0] : 'https://www.linkedin.com' + href.split('?')[0];

      const wrapper = link.children[0];
      if (!wrapper || wrapper.children.length < 2) return;
      const name = wrapper.children[0].textContent.trim();
      const headline = wrapper.children[1].textContent.trim();
      if (!name) return;

      // Find connected date
      let connectedDate = '';
      let el = link.nextElementSibling;
      for (let i = 0; i < 5 && el; i++) {
        const t = el.textContent.trim();
        if (t.startsWith('Connected on')) { connectedDate = t.replace('Connected on ', ''); break; }
        el = el.nextElementSibling;
      }

      const existing = connections.find(c => c.profileUrl === profileUrl);
      if (existing) {
        existing.name = name;
        existing.headline = headline;
        existing.connectedDate = connectedDate;
      } else {
        connections.push({ profileUrl, name, headline, connectedDate, imageUrl: '' });
      }
    });

    // Filter to only records with names
    return connections.filter(c => c.name);
  }

  // ============ SEARCH RESULTS SCRAPER ============
  async function scrapeSearchResults() {
    const results = [];

    for (let page = 1; page <= 10; page++) {
      updateStatus('Scanning page ' + page + '/10... (' + results.length + ' found)');
      await new Promise(r => setTimeout(r, 2000));

      // Get URL map
      const urlMap = {};
      document.querySelectorAll('a').forEach(a => {
        const h = a.getAttribute('href') || '';
        if (!h.includes('/in/')) return;
        const url = h.startsWith('http') ? h.split('?')[0] : 'https://www.linkedin.com' + h.split('?')[0];
        const text = a.textContent.trim();
        if (!text || text.length > 60 || text.includes('mutual') || text.includes('Connect') || text.includes('Invite') || text.includes('•')) return;
        if (!urlMap[text]) urlMap[text] = url;
      });

      // Parse page text
      const main = document.querySelector('[role="main"], main');
      const pageText = main ? main.innerText : '';
      const lines = pageText.split('\n').map(l => l.trim());

      let i = 0;
      while (i < lines.length) {
        if (urlMap[lines[i]]) {
          const name = lines[i];
          const profileUrl = urlMap[name];
          let headline = '';
          let j = i + 1;
          while (j < lines.length && j < i + 8) {
            const l = lines[j].trim();
            if (!l || l.match(/^•\s*(1st|2nd|3rd)/) || l === name) { j++; continue; }
            if (l === 'Connect' || l === 'Follow' || l === 'Message' || l.includes('mutual connection') || l.match(/followers$/)) break;
            if (!headline) { headline = l; j++; continue; }
            j++;
          }
          results.push({ name, headline, profileUrl, imageUrl: '' });
        }
        i++;
      }

      // Click next
      if (page < 10) {
        const nextBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Next');
        if (!nextBtn) break;
        nextBtn.click();
        await new Promise(r => setTimeout(r, 2500));
      }
    }

    return results;
  }

  // ============ MAIN ============
  async function run() {
    let connections;
    let type;

    if (isConnectionsPage) {
      connections = await scrapeConnections();
      type = 'degree1';
    } else {
      connections = await scrapeSearchResults();
      type = 'degree2';
    }

    updateStatus('Found ' + connections.length + ' connections. Opening relay...');

    // Open relay window on app domain (bypasses CSP)
    const relay = window.open(APP_URL + '/scrape', '_blank', 'width=500,height=400');

    // Wait for relay to load, then send data
    let attempts = 0;
    const sendInterval = setInterval(() => {
      attempts++;
      if (attempts > 30) {
        clearInterval(sendInterval);
        updateStatus('Error: Relay window did not respond. Check popup blocker.');
        return;
      }
      try {
        relay.postMessage({ connections, type }, APP_URL);
      } catch(e) {}
    }, 1000);

    // Listen for completion
    window.addEventListener('message', function handler(event) {
      if (event.data?.done) {
        clearInterval(sendInterval);
        updateStatus('Done! ' + connections.length + ' connections saved. Refresh the app to see results.');
        overlay.style.background = 'linear-gradient(135deg, #00ff88, #3498DB)';
        setTimeout(() => overlay.remove(), 5000);
        window.removeEventListener('message', handler);
      }
    });
  }

  run().catch(err => {
    updateStatus('Error: ' + err.message);
    overlay.style.background = '#ff4444';
  });
})();
