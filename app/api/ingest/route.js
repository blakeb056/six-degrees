import { db as supabase } from '../../../lib/db';
import { uniqueByProfile, splitAlreadyConnected, toIsoDate } from '../../../lib/ingest';
import { promoteToFirstDegree } from '../../../lib/promote';

function parseHeadline(h) {
  if (!h) return { role: '', company: '' };
  const m = h.match(/^(.+?)\s+(?:at|@)\s+(.+?)(?:\s*\|.*)?$/i);
  return m ? { role: m[1].trim(), company: m[2].trim() } : { role: h.split('|')[0].trim(), company: '' };
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { connections, type, bridgeId, userId, companyName } = body;

    if (!connections || !Array.isArray(connections)) {
      return Response.json({ error: 'Missing connections array' }, { status: 400 });
    }

    const degree = type === 'degree2' ? 2 : type === 'company' ? 3 : 1;

    let records = connections.map(c => {
      const { role, company } = parseHeadline(c.headline);
      const rec = {
        degree,
        name: c.name?.trim(),
        headline: (c.headline || '').trim().substring(0, 200),
        // For company scans: if headline didn't parse a company, use the scanned company name
        company: (company || (type === 'company' ? companyName : '') || '').substring(0, 100),
        role: role.substring(0, 100),
        profile_url: c.profileUrl?.trim(),
        profile_image_url: c.imageUrl || null,
        connected_date: toIsoDate(c.connectedDate),
      };
      if (degree === 2 && bridgeId) {
        rec.source_connection_id = bridgeId;
      }
      // Mark company scan source
      if (type === 'company' && companyName) {
        rec.scanned_company = companyName;
      }
      // Attach user_id if provided
      if (userId) {
        rec.user_id = userId;
      }
      return rec;
    }).filter(r => r.name && r.profile_url);

    // One record per person, and — for someone else's circle or a company — not
    // people who are already your own connections. A repeated profile made the
    // whole insert fail on the unique index, so a bridge's people were read and
    // none saved; your own connections arrive as the "mutual connections" links
    // under each result and are not people you have not met. TRAPS §32.
    const received = records.length;
    records = uniqueByProfile(records);
    const duplicates = received - records.length;
    let alreadyConnected = 0;
    if (degree > 1 && userId && records.length > 0) {
      const firstDegree = new Set();
      const all = records.map(r => r.profile_url);
      for (let i = 0; i < all.length; i += 100) {
        const { data: mine } = await supabase.from('linkedin_connections')
          .select('profile_url').in('profile_url', all.slice(i, i + 100))
          .eq('user_id', userId).eq('degree', 1);
        (mine || []).forEach(r => firstDegree.add(r.profile_url));
      }
      const split = splitAlreadyConnected(records, firstDegree);
      records = split.keep;
      alreadyConnected = split.alreadyConnected;
    }

    // Pre-filter: find which profile_urls already exist for this specific context
    // The unique index is (profile_url, source_connection_id, user_id)
    // So we scope the existence check to match the insert context
    const urls = records.map(r => r.profile_url).filter(Boolean);
    const existingUrls = new Set();
    if (urls.length > 0) {
      for (let i = 0; i < urls.length; i += 100) {
        const batch = urls.slice(i, i + 100);
        let query = supabase.from('linkedin_connections').select('profile_url').in('profile_url', batch);
        // Scope by bridge for D2, by user for D1/D3
        if (degree === 2 && bridgeId) {
          query = query.eq('source_connection_id', bridgeId);
        }
        if (userId) {
          query = query.eq('user_id', userId);
        }
        const { data: existing } = await query;
        (existing || []).forEach(e => existingUrls.add(e.profile_url));
      }
    }

    const newRecords = records.filter(r => !existingUrls.has(r.profile_url));
    const existingRecords = records.filter(r => existingUrls.has(r.profile_url));
    let promoted = 0;

    // Someone you met through a bridge and have now actually connected with.
    //
    // The existence check above is not degree-aware, so a person whose only row
    // was 2nd-degree counted as "already handled" — and the update below only
    // touches rows at degree 1, of which they had none. They stayed a
    // 2nd-degree contact forever and the path that produced them was never
    // recorded. Promote them instead, keeping who introduced them.
    if (degree === 1 && existingRecords.length > 0) {
      const stillSecondDegree = new Set();
      for (let i = 0; i < existingRecords.length; i += 100) {
        const batch = existingRecords.slice(i, i + 100).map(r => r.profile_url);
        let q = supabase.from('linkedin_connections')
          .select('profile_url, degree').in('profile_url', batch).eq('degree', 2);
        if (userId) q = q.eq('user_id', userId);
        const { data: d2 } = await q;
        (d2 || []).forEach(r => stillSecondDegree.add(r.profile_url));
      }
      for (const rec of existingRecords) {
        if (!stillSecondDegree.has(rec.profile_url)) continue;
        const res = await promoteToFirstDegree(supabase, {
          profileUrl: rec.profile_url,
          userId,
          fields: {
            name: rec.name,
            headline: rec.headline,
            company: rec.company,
            role: rec.role,
            ...(rec.profile_image_url ? { profile_image_url: rec.profile_image_url } : {}),
          },
        });
        if (res.promoted) promoted += 1;
      }
    }

    // Insert truly new records
    let insertError = null;
    if (newRecords.length > 0) {
      const { error } = await supabase
        .from('linkedin_connections')
        .insert(newRecords);
      insertError = error;
    }

    // Update existing records (refresh headline, company, image, etc.)
    // Only for degree-1 refreshes — keeps data fresh without constraint issues
    if (degree === 1 && existingRecords.length > 0) {
      for (const rec of existingRecords) {
        const updates = {};
        if (rec.headline) updates.headline = rec.headline;
        if (rec.company) updates.company = rec.company;
        if (rec.role) updates.role = rec.role;
        if (rec.profile_image_url) updates.profile_image_url = rec.profile_image_url;
        // Fills in the date for people saved before it was captured, so one full
        // scan dates everyone and "newest first" can go by it.
        if (rec.connected_date) updates.connected_date = rec.connected_date;
        if (Object.keys(updates).length > 0) {
          await supabase
            .from('linkedin_connections')
            .update(updates)
            .eq('profile_url', rec.profile_url)
            .eq('degree', 1);
        }
      }
    }

    if (insertError) {
      console.error('Supabase insert error:', insertError);
      return Response.json({ error: insertError.message }, { status: 500 });
    }

    // Image updates handled separately via /api/update-images (avoids timeout)

    // Rescore everyone (lib/scoring.js): a new circle changes company headcounts
    // and its bridge's circle boost. For a circle scan, compare the bridge's
    // score before and after so a promotion or a catalyst gets a notification.
    const bridgeBefore = degree === 2 && bridgeId
      ? (await supabase.from('linkedin_connections').select('name, power_score, tier, is_catalyst').eq('id', bridgeId).single()).data
      : null;
    try { await supabase.rpc('score_new_connections'); } catch (e) { /* scoring is best-effort */ }
    if (bridgeBefore) {
      try {
        const { data: bridge } = await supabase.from('linkedin_connections')
          .select('name, power_score, tier, is_catalyst, circle_s_count, circle_a_count, circle_elite_pct').eq('id', bridgeId).single();
        if (bridge) {
          const detail = `${bridge.circle_s_count} S-tier, ${bridge.circle_a_count} A-tier, ${Math.round((bridge.circle_elite_pct || 0) * 100)}% A or S in their circle`;
          const oldScore = parseFloat(bridgeBefore.power_score) || 0;
          const newScore = parseFloat(bridge.power_score) || 0;
          if (newScore > oldScore) {
            const promoted = bridge.tier !== bridgeBefore.tier;
            await supabase.from('notifications').insert([{
              user_id: userId || null,
              type: 'bridge_scored',
              title: promoted
                ? `Bridge promoted: ${bridgeBefore.tier || '?'} → ${bridge.tier}`
                : `Bridge score updated: ${oldScore.toFixed(1)} → ${newScore.toFixed(1)}`,
              message: detail,
              icon: promoted ? '⬆️' : '📊',
            }]).catch(() => {});
          }
          if (bridge.is_catalyst && !bridgeBefore.is_catalyst) {
            await supabase.from('notifications').insert([{
              user_id: userId || null,
              type: 'catalyst_found',
              title: `Catalyst discovered: ${bridge.name || 'Unknown'}`,
              message: detail,
              icon: '⚡',
            }]).catch(() => {});
          }
        }
      } catch (e) { /* notifications are optional */ }
    }

    // Auto-detect accepted pending requests: if a pending person just showed up as d1
    if (degree === 1 && records.length > 0) {
      try {
        const d1Urls = records.map(r => r.profile_url).filter(Boolean);
        // Find pending people whose URL matches a new d1 connection
        const { data: pendingAccepted } = await supabase
          .from('linkedin_connections')
          .select('id, name, profile_url')
          .eq('outreach_status', 'sent')
          .in('profile_url', d1Urls.slice(0, 200));

        if (pendingAccepted && pendingAccepted.length > 0) {
          // Get full records for tier-based XP
          const { data: fullRecords } = await supabase
            .from('linkedin_connections')
            .select('id, name, tier, profile_url, source_connection_id')
            .in('id', pendingAccepted.map(p => p.id));

          // Mark them as accepted
          const acceptedIds = pendingAccepted.map(p => p.id);
          await supabase
            .from('linkedin_connections')
            .update({ outreach_status: 'accepted' })
            .in('id', acceptedIds);

          // Award XP for each accepted connection
          const XP_ACCEPT = { S: 100, A: 60, B: 35, C: 15, D: 5 };
          let totalXP = 0;
          (fullRecords || []).forEach(p => { totalXP += XP_ACCEPT[p.tier] || 5; });
          if (totalXP > 0 && userId) {
            const { data: stats } = await supabase.from('user_stats').select('xp').eq('id', userId).single();
            if (stats) {
              await supabase.from('user_stats').update({ xp: (stats.xp || 0) + totalXP }).eq('id', userId);
            } else {
              await supabase.from('user_stats').insert([{ id: userId, xp: totalXP, level: 1 }]).catch(() => {});
            }
          }

          // Notification for each accepted — includes XP earned
          await supabase.from('notifications').insert(
            (fullRecords || pendingAccepted).slice(0, 5).map(p => ({
              user_id: userId || null,
              type: 'request_accepted',
              title: `${p.name} accepted! +${XP_ACCEPT[p.tier] || 5} XP`,
              message: `${p.tier}-Tier connection — bridge their cluster to reach D3`,
              icon: '🤝',
            }))
          ).catch(() => {});
        }
      } catch (e) { /* auto-detect is optional */ }
    }

    // Create notifications for new connections on refresh
    if (degree === 1 && records.length > 0) {
      try {
        // Check which are actually new (not already in DB)
        const urls = records.map(r => r.profile_url).filter(Boolean);
        const { data: existing } = await supabase
          .from('linkedin_connections')
          .select('profile_url')
          .in('profile_url', urls.slice(0, 100));
        const existingUrls = new Set((existing || []).map(e => e.profile_url));
        const brandNew = records.filter(r => !existingUrls.has(r.profile_url));

        if (brandNew.length > 0) {
          // Summary notification
          await supabase.from('notifications').insert([{
            user_id: userId || null,
            type: 'refresh_summary',
            title: `${brandNew.length} new connection${brandNew.length > 1 ? 's' : ''} found!`,
            message: brandNew.slice(0, 3).map(r => r.name).join(', ') + (brandNew.length > 3 ? ` +${brandNew.length - 3} more` : ''),
            icon: '🔄',
          }]);

          // Individual notifications for S/A tier new connections
          const eliteNew = brandNew.filter(r => {
            const hl = (r.headline || '').toLowerCase();
            return hl.match(/ceo|chief|founder|president|vp|vice president|director|head of/i)
              || hl.match(/snap|google|meta|apple|amazon|microsoft|blackrock|stripe|palantir/i);
          });
          if (eliteNew.length > 0) {
            await supabase.from('notifications').insert(
              eliteNew.slice(0, 5).map(r => ({
                user_id: userId || null,
                type: 'new_elite_connection',
                title: `High-value connection: ${r.name}`,
                message: r.headline?.substring(0, 60),
                icon: '👑',
              }))
            );
          }
        } else {
          // No new connections found
          await supabase.from('notifications').insert([{
            user_id: userId || null,
            type: 'refresh_summary',
            title: 'Network up to date',
            message: `Checked ${records.length} connections — no new additions`,
            icon: '✓',
          }]);
        }
      } catch (e) { /* notifications are optional */ }
    }

    return Response.json({
      success: true,
      received: connections.length,
      processed: records.length,
      // What actually happened, so the scraper can say it instead of implying
      // everything it sent was added.
      saved: newRecords.length,
      alreadyKnown: existingRecords.length,
      alreadyConnected,
      duplicates,
      promoted,
    });
  } catch (err) {
    console.error('Ingest error:', err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
