import { supabaseAdmin as supabase } from '../../../lib/supabase-admin';
import { demoGuard } from '../../../lib/api-guard';

function parseHeadline(h) {
  if (!h) return { role: '', company: '' };
  const m = h.match(/^(.+?)\s+(?:at|@)\s+(.+?)(?:\s*\|.*)?$/i);
  return m ? { role: m[1].trim(), company: m[2].trim() } : { role: h.split('|')[0].trim(), company: '' };
}

// Score company prestige using user-specific config
function getCompanyPrestige(headline, config) {
  if (!config || !headline) return 2; // default D-tier
  const h = headline.toLowerCase();
  const tiers = [
    { list: config.s_tier || [], score: config.s_score || 10 },
    { list: config.a_tier || [], score: config.a_score || 8 },
    { list: config.b_tier || [], score: config.b_score || 6 },
    { list: config.c_tier || [], score: config.c_score || 4 },
  ];
  for (const tier of tiers) {
    for (const company of tier.list) {
      if (h.includes(company)) return tier.score;
    }
  }
  return config.d_score || 2;
}

export async function POST(request) {
  const _demo = demoGuard(); if (_demo) return _demo;
  try {
    const body = await request.json();
    const { connections, type, bridgeId, userId, companyName } = body;

    if (!connections || !Array.isArray(connections)) {
      return Response.json({ error: 'Missing connections array' }, { status: 400 });
    }

    const degree = type === 'degree2' ? 2 : type === 'company' ? 3 : 1;

    // Fetch user's company prestige config for bespoke scoring
    let prestigeConfig = null;
    if (userId) {
      const { data: userData } = await supabase
        .from('users')
        .select('company_prestige_config')
        .eq('id', userId)
        .single();
      if (userData?.company_prestige_config) {
        prestigeConfig = userData.company_prestige_config;
      }
    }

    const records = connections.map(c => {
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
        connected_date: c.connectedDate ? new Date(c.connectedDate).toISOString().split('T')[0] : null,
      };
      // Apply user-specific company prestige scoring
      if (prestigeConfig) {
        const prestige = getCompanyPrestige(c.headline || '', prestigeConfig);
        rec.company_prestige_score = prestige;
        // Calculate seniority from headline
        const hl = (c.headline || '').toLowerCase();
        let seniority = 5; // default
        if (hl.match(/ceo|chief|founder|president|chairman|co-founder/i)) seniority = 10;
        else if (hl.match(/\bvp\b|vice president|svp|evp|managing director/i)) seniority = 9;
        else if (hl.match(/director|head of|senior director/i)) seniority = 8;
        else if (hl.match(/manager|lead|principal|staff/i)) seniority = 7;
        else if (hl.match(/senior|sr\.|sr /i)) seniority = 6;
        else if (hl.match(/engineer|developer|analyst|designer|scientist/i)) seniority = 5;
        else if (hl.match(/intern|student|aspiring/i)) seniority = 3;
        rec.seniority_score = seniority;
        const score = Math.round((seniority * 0.5 + prestige * 0.3) * 10) / 10;
        rec.power_score = score;
        rec.tier = score >= 7 ? 'S' : score >= 5.5 ? 'A' : score >= 4 ? 'B' : score >= 2.5 ? 'C' : 'D';
      }
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

    // Score new unscored connections
    try { await supabase.rpc('score_new_connections'); } catch (e) { /* function may not exist yet */ }

    // Recalculate Circle Power for the bridge if this was a degree-2 scrape
    if (degree === 2 && bridgeId) {
      try {
        // Count cluster composition
        const { data: cluster } = await supabase
          .from('linkedin_connections')
          .select('tier')
          .eq('source_connection_id', bridgeId)
          .eq('degree', 2);

        if (cluster && cluster.length > 0) {
          const total = cluster.length;
          const sCount = cluster.filter(c => c.tier === 'S').length;
          const aCount = cluster.filter(c => c.tier === 'A').length;
          const elitePct = (sCount + aCount) / total;
          const circlePower = (sCount * 3) + (aCount * 1.5) + (elitePct * 10) + (Math.log(total + 1) * 1.5);
          const circleBonus = Math.min(3.0, circlePower / 20);

          // Get bridge's base scores
          const { data: bridge } = await supabase
            .from('linkedin_connections')
            .select('seniority_score, company_prestige_score, power_score')
            .eq('id', bridgeId)
            .single();

          if (bridge) {
            const baseScore = (bridge.seniority_score * 0.5) + (bridge.company_prestige_score * 0.3);
            const newScore = Math.round(Math.min(baseScore + circleBonus, 13) * 10) / 10;
            const newTier = newScore >= 7 ? 'S' : newScore >= 5.5 ? 'A' : newScore >= 4 ? 'B' : newScore >= 2.5 ? 'C' : 'D';

            // Catalyst detection: abnormal circle quality
            const isCatalyst = (sCount >= 5 && elitePct >= 0.25) || circlePower >= 50 || (sCount >= 3 && elitePct >= 0.30);

            const finalScore = Math.max(bridge.power_score, newScore);
            const finalTier = finalScore >= 7 ? 'S' : finalScore >= 5.5 ? 'A' : finalScore >= 4 ? 'B' : finalScore >= 2.5 ? 'C' : 'D';

            await supabase.from('linkedin_connections').update({
              circle_power: Math.round(circlePower * 100) / 100,
              circle_s_count: sCount,
              circle_a_count: aCount,
              circle_elite_pct: Math.round(elitePct * 100) / 100,
              power_score: finalScore,
              tier: finalTier,  // Always sync tier with score
              is_catalyst: isCatalyst,
              catalyst_score: isCatalyst ? sCount + aCount : 0,
            }).eq('id', bridgeId);

            // Notification: bridge score updated
            const oldScore = parseFloat(bridge.power_score) || 0;
            if (finalScore > oldScore) {
              const oldTier = oldScore >= 7 ? 'S' : oldScore >= 5.5 ? 'A' : oldScore >= 4 ? 'B' : 'C';
              const promoted = finalTier !== oldTier;
              await supabase.from('notifications').insert([{
                user_id: userId || null,
                type: 'bridge_scored',
                title: promoted
                  ? `Bridge promoted: ${oldTier} → ${finalTier}`
                  : `Bridge score updated: ${oldScore.toFixed(1)} → ${finalScore.toFixed(1)}`,
                message: `${sCount} S-tier, ${aCount} A-tier, ${Math.round(elitePct * 100)}% elite density in cluster`,
                icon: promoted ? '⬆️' : '📊',
              }]).catch(() => {});
            }

            // Create notification if new catalyst detected
            if (isCatalyst) {
              await supabase.from('notifications').insert([{
                user_id: userId || null,
                type: 'catalyst_found',
                title: `Catalyst discovered: ${bridge.name || 'Unknown'}`,
                message: `${sCount} S-tier, ${aCount} A-tier, ${Math.round(elitePct * 100)}% elite density`,
                icon: '⚡',
              }]).catch(() => {});
            }
          }
        }
      } catch (e) { /* circle power calc is optional */ }
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
    });
  } catch (err) {
    console.error('Ingest error:', err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
