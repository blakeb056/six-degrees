-- Power Scoring Algorithm
-- Run this after importing connections to calculate scores and assign tiers

-- Seniority score based on title keywords (0-10)
UPDATE linkedin_connections SET seniority_score = CASE
  WHEN role ~* '(CEO|Chief|Founder|President|Owner)' THEN 10
  WHEN role ~* '(VP|Vice President|SVP|EVP|Global Head|Country Director|Managing Director)' THEN 9
  WHEN role ~* '(Senior Director|Director|Head of|Country Lead)' THEN 8
  WHEN role ~* '(Senior Manager|Manager,|Engineering Manager|Product Leader)' THEN 7
  WHEN role ~* '(Lead|Principal|Staff|Senior.*Engineer|Senior.*Designer|Senior.*Manager)' THEN 6
  WHEN role ~* '(Partner|Client Partner|Account Manager|Strategist)' THEN 5
  WHEN role ~* '(Engineer|Developer|Designer|Analyst|Coordinator)' THEN 4
  WHEN role ~* '(Intern|Student|Undergraduate|Junior|Entry)' THEN 2
  WHEN headline ~* '(Student|UCF|University)' AND role !~* '(Manager|Lead|Director|VP|CEO)' THEN 1
  ELSE 3
END;

-- Company prestige score (0-10)
-- Note: use word boundaries or exact match to avoid false positives (e.g. "Appleton" matching "Apple")
UPDATE linkedin_connections SET company_prestige_score = CASE
  -- Tier 10: FAANG / Mag7
  WHEN company ~* '(^Google|^Meta |^Apple$|^Microsoft|^Amazon|^NVIDIA|^Tesla$)' THEN 10
  -- Tier 9: Elite tech, top finance, top consulting, Snap, elite unicorns
  WHEN company ~* '(Snap|Snapchat)' THEN 9
  WHEN company ~* '(Goldman Sachs|BlackRock|Merrill Lynch|McKinsey|BCG|^Deloitte|Heidrick|Egon Zehnder|Boies Schiller)' THEN 9
  WHEN company ~* '(Polymarket|Anduril|CoreWeave|^Stripe$|Palantir)' THEN 9
  WHEN company ~* '(Coca-Cola|The Coca-Cola)' THEN 9
  -- Tier 8: Major tech, defense, consumer brands, unicorns, major banks
  WHEN company ~* '(Pinterest|TikTok|Roku|Netflix|Uber|Spotify|Databricks|Datadog|OpenAI|Anthropic)' THEN 8
  WHEN company ~* '(SpaceX|Lockheed Martin|Northrop|Siemens|Boeing|Raytheon)' THEN 8
  WHEN company ~* '(Nike|Disney|LVMH|Unilever|Danone|Beiersdorf|Starbucks|PepsiCo|Pepsico)' THEN 8
  WHEN company ~* '(Whatnot|BNY|Bank of New York|ServiceNow|Salesforce|Visa|Oracle|IBM|Qualcomm)' THEN 8
  WHEN company ~* '(World Bank|Goodyear|Kellanova|Kellogg|Campbell)' THEN 8
  WHEN company ~* '(U\.S\. Space Force|Space Force)' THEN 8
  -- Tier 7: Strong tech/fintech, notable companies
  WHEN company ~* '(Mercury|Credit Karma|Capital One|PayPal|Plaid|Brex|Coinbase|Scale AI|Chick-fil-A)' THEN 7
  WHEN company ~* '(WPP|Intel|AMD|Figma|Notion|Vercel)' THEN 7
  -- Tier 6: Notable mid-tier
  WHEN company ~* '(Hard Rock Digital|Beam|Later|Vanta|Kaseya)' THEN 6
  WHEN company = '' OR company IS NULL THEN 2
  ELSE 4
END;

-- Calculate overall power score (weighted combination)
UPDATE linkedin_connections SET power_score =
  (seniority_score * 0.5) + (company_prestige_score * 0.3) +
  CASE
    WHEN headline ~* '(billion|million|M\+|B\+|Forbes|YC|a16z|venture|investor)' THEN 2
    WHEN headline ~* '(award|patent|speaker|author|TEDx)' THEN 1.5
    ELSE 0
  END +
  CASE WHEN degree = 1 AND connected_date >= CURRENT_DATE - INTERVAL '30 days' THEN 0.5 ELSE 0 END;

-- Assign tiers based on power score
UPDATE linkedin_connections SET tier = CASE
  WHEN power_score >= 7 THEN 'S'
  WHEN power_score >= 5.5 THEN 'A'
  WHEN power_score >= 4 THEN 'B'
  WHEN power_score >= 2.5 THEN 'C'
  ELSE 'D'
END;

-- Set influence signals JSON
UPDATE linkedin_connections SET influence_signals = jsonb_build_object(
  'is_executive', role ~* '(CEO|VP|Director|Head|President|SVP|EVP|Managing Director|Country Lead|Country Director)',
  'is_recruiter', headline ~* '(recruit|talent|hiring|people|staffing)',
  'is_founder', headline ~* '(founder|co-founder|cofounder)',
  'is_at_faang', company ~* '(Google|Meta|Apple|Amazon|Microsoft|Netflix)',
  'is_at_snap', company ~* '(Snap|Snapchat)',
  'is_investor', headline ~* '(investor|venture|angel|VC|capital)',
  'ai_relevant', headline ~* '(AI|ML|machine learning|artificial intelligence|LLM|GPT|deep learning)'
);

-- Summary
SELECT tier, count(*) as count, round(avg(power_score)::numeric, 1) as avg_score
FROM linkedin_connections
GROUP BY tier
ORDER BY avg_score DESC;
