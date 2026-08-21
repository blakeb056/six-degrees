-- CANONICAL SCORER — the scoring model this project's tiers are derived from.
--
-- This is the reference implementation: any other scorer in the codebase
-- (lib/csv.js for CSV imports, the inline scorer in app/api/ingest/route.js)
-- should be diffed against it. Written for Postgres; the local build ports the
-- same CASE ladders to SQLite.
--
-- Note it differs from the inline JS scorer in two ways the JS omits entirely:
-- the headline influence bonus (+2 / +1.5) and the 30-day recency bonus (+0.5).
--
-- Scores only rows WHERE tier IS NULL, so it is safe to re-run.

CREATE OR REPLACE FUNCTION public.score_new_connections()
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Seniority score
  UPDATE linkedin_connections SET seniority_score = CASE
    WHEN role ~* '(CEO|Chief|Founder|President|Owner)' THEN 10
    WHEN role ~* '(VP|Vice President|SVP|EVP|Managing Director|Global Head|Country Director)' THEN 9
    WHEN role ~* '(Senior Director|Director|Head of|Country Lead)' THEN 8
    WHEN role ~* '(Senior Manager|Manager,|Engineering Manager|Group Product)' THEN 7
    WHEN role ~* '(Lead|Principal|Staff|Senior.*Engineer|Senior.*Designer|Senior.*Manager)' THEN 6
    WHEN role ~* '(Partner|Client Partner|Account Manager|Strategist)' THEN 5
    WHEN role ~* '(Engineer|Developer|Designer|Analyst|Coordinator)' THEN 4
    WHEN role ~* '(Intern|Student|Undergraduate|Junior|Entry)' THEN 2
    WHEN headline ~* '(Student|UCF|University)' AND role !~* '(Manager|Lead|Director|VP|CEO)' THEN 1
    ELSE 3
  END
  WHERE tier IS NULL;

  -- Company prestige score
  UPDATE linkedin_connections SET company_prestige_score = CASE
    WHEN company ~* '(^Google|^Meta |^Apple$|^Microsoft|^Amazon|^NVIDIA|^Tesla$)' THEN 10
    WHEN company ~* '(Snap|Snapchat)' THEN 9
    WHEN company ~* '(Goldman Sachs|BlackRock|Merrill Lynch|McKinsey|BCG|^Deloitte|Heidrick|Boies Schiller)' THEN 9
    WHEN company ~* '(Polymarket|Anduril|CoreWeave|^Stripe$|Palantir)' THEN 9
    WHEN company ~* '(Coca-Cola|The Coca-Cola)' THEN 9
    WHEN company ~* '(Pinterest|TikTok|Roku|Netflix|Uber|Spotify|Databricks|Datadog|OpenAI|Anthropic)' THEN 8
    WHEN company ~* '(SpaceX|Lockheed Martin|Northrop|Siemens|Boeing|Raytheon|Disney)' THEN 8
    WHEN company ~* '(Nike|LVMH|Unilever|Danone|Beiersdorf|Starbucks|PepsiCo|Pepsico)' THEN 8
    WHEN company ~* '(Whatnot|BNY|Bank of New York|ServiceNow|Salesforce|Visa|Oracle|IBM)' THEN 8
    WHEN company ~* '(World Bank|Goodyear|Kellanova|Kellogg|Campbell)' THEN 8
    WHEN company ~* '(U\.S\. Space Force|Space Force)' THEN 8
    WHEN company ~* '(Mercury|Credit Karma|Capital One|PayPal|Plaid|Coinbase|Scale AI|Chick-fil-A)' THEN 7
    WHEN company ~* '(WPP|Intel|AMD|Figma|Notion|Vercel)' THEN 7
    WHEN company ~* '(Hard Rock Digital|Beam|Later|Vanta|Kaseya)' THEN 6
    WHEN company = '' OR company IS NULL THEN 2
    ELSE 4
  END
  WHERE tier IS NULL;

  -- Power score
  UPDATE linkedin_connections SET power_score =
    (seniority_score * 0.5) + (company_prestige_score * 0.3) +
    CASE
      WHEN headline ~* '(billion|million|M\+|B\+|Forbes|YC|a16z|venture|investor|Wharton|MIT|Stanford)' THEN 2
      WHEN headline ~* '(award|patent|speaker|author|TEDx|Board Member|Board Director)' THEN 1.5
      ELSE 0
    END +
    CASE WHEN degree = 1 AND connected_date >= CURRENT_DATE - INTERVAL '30 days' THEN 0.5 ELSE 0 END
  WHERE tier IS NULL;

  -- Tier assignment
  UPDATE linkedin_connections SET tier = CASE
    WHEN power_score >= 7 THEN 'S'
    WHEN power_score >= 5.5 THEN 'A'
    WHEN power_score >= 4 THEN 'B'
    WHEN power_score >= 2.5 THEN 'C'
    ELSE 'D'
  END
  WHERE tier IS NULL;
END;
$function$;
