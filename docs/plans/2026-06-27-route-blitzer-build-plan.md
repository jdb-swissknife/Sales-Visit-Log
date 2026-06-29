# Route Blitzer - Build Plan
## Daily D2D Route Planning for Erica's HVAC/Solar Team

Date: 2026-06-27
Owner: John / MindVault
For: Erica's Atlanta HVAC D2D reps
Clone base: Sales-Visit-Log (/root/projects/sales-visit-log)

---

## 1. THE PROBLEM

Erica's reps are evaluating neighborhoods one at a time in ChatGPT. Bob's ChatGPT conversation shows exactly what they need: a "Bob Knock Score" that ranks subdivisions by HVAC replacement + solar opportunity, then refines by HEAR eligibility likelihood. Right now this is manual, slow, and not repeatable.

They need a tool that says, every morning:
"Here are today's 3 neighborhoods, the route between them, and why each scored high."

## 2. TARGETING STRATEGY (confirmed)

Layer 1 - HVAC Replacement Opportunity (the gate):
- Homes built 1985-2005 (20-40 year old HVAC systems at replacement age)
- Gas neighborhoods (gas furnace = replacement target)
- Owner-occupied (not rentals)
- Home value up to $300K (proxy: hasn't already upgraded HVAC)

Layer 2 - HEAR Likelihood Refiner (the ranker within the gate):
- Neighborhoods with lower median incomes (higher % likely to qualify)
- Gwinnett/DeKalb AMI context: 150% AMI for family of 4 is ~$156K
- Target income sweet spot: $50K-$95K median HH income
- Below $50K: may have financing friction
- Above $95K: HEAR qualification less likely
- This is neighborhood probability only. Individual HEAR qualification is confirmed at the door.

## 3. ZIP CODE INTEL (initial data)

Census ACS data pulled 2026-06-27:

| ZIP   | City          | Median HH Income | Avg HH Income | % >$200K | County    |
|-------|---------------|------------------|---------------|----------|-----------|
| 30039 | Snellville    | $93,701          | $106,441      | 8.3%     | Gwinnett  |
| 30087 | Stone Mtn area| $96,491          | $120,957      | 14.9%    | DeKalb    |
| 30047 | Lilburn       | $88,652          | $113,248      | 12.0%    | Gwinnett  |
| 30084 | Tucker        | $81,304          | $110,924      | 12.5%    | DeKalb    |
| 30021 | Doraville     | TBD              | TBD           | TBD      | DeKalb    |
| 30071 | Norcross      | TBD              | TBD           | TBD      | Gwinnett  |

Observations:
- 30084 (Tucker) and 30047 (Lilburn) have the lowest median incomes = highest HEAR likelihood
- 30039 (Snellville) has the lowest % of high earners (8.3%) = also strong
- 30087 has the highest incomes = lowest HEAR likelihood but may have more financing-qualified homeowners
- Home values in 30039 are ~$360K (city-data) which is above the $300K cap the rep mentioned. Need subdivision-level filtering, not zip-level.

PRICE RANGE CHECK: The rep said $300K max. Census/city-data shows median home values in these zips are $360K+. The rep is not a real estate professional and is likely guessing based on individual listings or older data. Do NOT bake his $300K into the model as a hard filter. Instead:
- Use actual parcel-level data to compute real subdivision-level median values
- Make home value a configurable threshold in settings (default wide open, not capped)
- Score downward for very high values ($450K+) since those homeowners likely already upgraded HVAC
- Score upward for moderate values ($200K-$350K) = sweet spot for old HVAC + financing capacity
- The tool SHOWS reps the real median values so they stop guessing

The rep's $300K was really a proxy for "homes that haven't been upgraded yet." The data should determine that, not a guessed number. Older subdivisions with lower values are the real signal, and parcel data will find them regardless of what zip they're in.

## 4. THE "KNOCK SCORE" MODEL

Based on Bob's ChatGPT scoring model, adapted for the confirmed strategy:

| Factor                          | Max Points | Data Source              |
|---------------------------------|------------|--------------------------|
| Built 1985-2005                 | 20         | County parcel data       |
| Gas neighborhood                | 20         | Utility maps / ACS fuel  |
| Owner occupancy > 75%           | 15         | Census ACS               |
| Median HH income $50K-$95K      | 15         | Census ACS               |
| Long ownership (15+ years)      | 10         | County parcel / ACS      |
| Home value under $300K          | 10         | Parcel / Zillow Zestimate|
| Roof quality (solar)            | 5          | Satellite / Google       |
| English-speaking likelihood     | 5          | Census ACS               |
| **TOTAL**                       | **100**    |                          |

Scoring tiers:
- 90-100: Priority knock (green)
- 80-89: Strong (green)
- 70-79: Backup (yellow)
- Below 70: Skip (red)

## 5. WHAT TO CLONE FROM SVL

Reuse from Sales-Visit-Log:
- Full pnpm monorepo structure
- Express 5 + Drizzle ORM + PostgreSQL backend
- React 19 + Vite + Tailwind + shadcn/ui frontend
- MapLibre GL map component (adapt center to Atlanta area)
- Visit logging + notes + outcomes system
- Geocoding pipeline
- OpenAPI spec + Orval codegen

Do NOT reuse:
- Business target schema (SVL targets businesses, not residential homes)
- Minneapolis coordinates
- Seed data

## 6. NEW SCHEMA (what changes from SVL)

### Table: neighborhoods
Replaces SVL businesses table. One row per subdivision/neighborhood.

```
id: serial PK
name: text (e.g., "Eagle Point Landing")
city: text
zip: text
county: text
startAddress: text (entrance street address for routing)
latitude: real
longitude: real
knockScore: integer (0-100)
scoreTier: text (priority / strong / backup / skip)

# Scoring factors
yearBuiltMin: integer (earliest home in subdivision)
yearBuiltMax: integer
yearBuiltAvg: integer
isGas: boolean
ownerOccupancyPct: real
medianIncome: integer
medianHomeValue: integer
longOwnershipPct: real (% owned 15+ years)
roofScore: integer (1-10)
englishSpeakingPct: real

# Route planning
routeDay: integer (0=Mon ... 6=Sun)
routePriority: integer (order within day)
lastKnockedAt: timestamp
doorsKnnocked: integer (running count)

# Metadata
notes: text
createdAt: timestamp
updatedAt: timestamp
```

### Table: route_plans
New. A daily route covering multiple neighborhoods.

```
id: serial PK
repId: text
routeDate: date
neighborhoodIds: integer[] (ordered list)
status: text (planned / active / completed)
totalDoors: integer
estimatedTimeMin: integer
createdAt: timestamp
```

### Table: home_visits
Replaces SVL visits. Logs individual door knocks.

```
id: serial PK
neighborhoodId: integer FK -> neighborhoods.id
repId: text
streetAddress: text
visitedAt: timestamp
outcome: text (answered / not_home / not_interested / callback / sale)
contactName: text
contactPhone: text
hvacAge: text (confirmed at door)
hvacBrand: text
hasGas: boolean
heareEligible: text (yes / no / unknown)
financingStatus: text
nextActionDate: timestamp
notes: text
createdAt: timestamp
```

### Tables reused from SVL (unchanged):
- notes
- media (voice notes, photos of equipment)
- coaching_profiles / coaching_knowledge_docs (Erica's coaching brain)

## 7. DATA PIPELINE

### Phase A: Seed neighborhoods (one-time + refreshable)

Gwinnett County parcel data (free):
- https://www.gwinnettcounty.com/portal/gwinnett/Departments/ TaxAssessor/PropertyRecords
- Bulk parcel export with year built, owner, value

DeKalb County parcel data (free):
- https://dekalbcountyga.gov/tax-commissioner

Census ACS (neighborhood demographics):
- Requires free API key: https://api.census.gov/data/2022/acs/acs5
- Use key for: median income, owner occupancy, heating fuel type, language
- Query at census tract level (more granular than zip)

Gas availability:
- ACS table B25040 (House Heating Fuel) tells us % using utility gas per tract
- Atlanta Gas Light service area map confirms pipeline coverage

Script: scripts/src/seed-neighborhoods.ts
1. Fetch parcel data for target zips
2. Group parcels into subdivisions by subdivision name field
3. For each subdivision, compute: avg year built, owner occupancy, avg value
4. Join census tract data for income, heating fuel, language
5. Calculate Knock Score
6. Insert into neighborhoods table

### Phase B: Score calculator

Script: scripts/src/calculate-scores.ts
- Reads all neighborhoods
- Applies scoring model
- Updates knockScore + scoreTier
- Can be re-run after data corrections

### Phase C: Route optimizer

Endpoint: POST /routes/generate
Input: { date, repId, maxNeighborhoods (default 3), maxDriveMin (default 30) }
Logic:
1. Get unscored neighborhoods for target zips, sorted by knockScore desc
2. Filter out neighborhoods already knocked in last 14 days
3. Greedy nearest-neighbor routing: pick highest score, then next closest high score, etc.
4. Output ordered route plan with drive estimates

Routing: OSRM (open source, self-hostable) or OSRM demo server for dev
- API: http://router.project-osrm.org/route/v1/driving/{coords}
- Returns drive time + distance between points

## 8. FRONTEND PAGES

### Page 1: Daily Route (home page)
- Shows today's route plan for the logged-in rep
- Map with numbered markers showing neighborhood order
- List below: neighborhoods in route order with score, drive time to next
- "Start Route" button
- Each neighborhood card: score breakdown, # doors knocked previously, key stats

### Page 2: Neighborhood Detail
- Full score breakdown (the 8 factors with values)
- List of streets to knock
- Previous visit history for this neighborhood
- Quick-log: tap to record outcome per door
- Map zoomed to subdivision with parcel outlines

### Page 3: Territory Map (manager view)
- All neighborhoods plotted by score tier (green/yellow/red)
- Filter by zip, score range, gas/electric
- Click to see detail or assign to route
- Heat map overlay option

### Page 4: Door Log (adapted from SVL map page)
- Per-door knock logging
- Voice note recording (reuse SVL voice recorder)
- Photo upload (nameplate, old equipment)
- Outcome buttons: Sale / Callback / Not Home / Not Interested
- HEAR qualification checkbox

## 9. BUILD SEQUENCE

### Sprint 1: Foundation (Days 1-2)
1. Clone SVL repo, rename project
2. Strip Minneapolis-specific data and business schema
3. Create neighborhoods, route_plans, home_visits schema
4. Set Atlanta center coordinates on map
5. Update API routes for new schema
6. Basic typecheck + build passing

### Sprint 2: Data Pipeline (Days 3-4)
7. Get Census API key
8. Write seed-neighborhoods.ts for Gwinnett County
9. Score calculator script
10. Seed 50-100 subdivisions across the 6 target zips
11. Verify scores against the ChatGPT analysis (Eagle Point Landing should score 85+)

### Sprint 3: Route Engine (Days 5-6)
12. Route generation endpoint with OSRM integration
13. 14-day dedup logic
14. Greedy nearest-neighbor optimizer
15. 2-week route generation (10 working days of routes)
16. Verify no neighborhood repeats within 14 days

### Sprint 4: Frontend (Days 7-9)
17. Daily Route page (home)
18. Map with route markers + drive times
19. Neighborhood detail with score breakdown
20. Door log page (adapted from SVL map page)
21. Territory map for manager view

### Sprint 5: Polish + Deploy (Days 10-11)
22. Mobile responsive pass (reps use phones in field)
23. Rep identity (simple: name select on login, no Clerk yet)
24. Deploy to erica-route subdomain
25. Seed with real data
26. 2-week route plan pre-generated

## 10. TECH DECISIONS

Database: Separate PostgreSQL instance (not shared with SVL prod)
Deploy: New VPS or shared with Erica portal (erica.mindvaultstudio.net)
Domain: route.erica.mindvaultstudio.net (or similar)
Routing: OSRM self-hosted (free) vs Google Maps Directions API (paid)
  - OSRM: free, open, less accurate drive times
  - Google: $0.005/route, 12-month free trial credit
  - Recommend OSRM for MVP, Google optional later

Parcel data refresh: Monthly (property records don't change often)
Census data refresh: Annual (ACS updates yearly)

## 11. WHAT THE REP SEES (daily flow)

Morning:
1. Open app on phone
2. See today's route: 3 neighborhoods, ordered by score + drive efficiency
3. Each shows: score, why it scored high (gas homes, built 2001, income in range)
4. Tap first neighborhood -> see streets to walk, map

At the door:
5. Tap "Log Visit" -> select outcome
6. Record voice note if conversation happened
7. Check HEAR qualification question if relevant
8. Photo of existing equipment nameplate if allowed

End of day:
9. Manager sees all door logs
10. App suggests tomorrow's route based on today's results
11. Callbacks auto-scheduled

## 12. ANSWERED QUESTIONS

1. Login/auth: NO. Single rep, no login. Shared tool for MVP.
2. Number of reps: 1 for initial test.
3. Route loading: 2 DAYS AT A TIME. Generate today + tomorrow so if day 1 neighborhoods underperform, rep has day 2 ready.
4. Manager access: NOT FOR MVP. Just the rep tool.
5. Manager dashboard: later. No managerial access now.

## 13. DATA SOURCES BUDGET

Free:
- Census ACS API (with key): $0
- Gwinnett County parcel data: $0
- DeKalb County parcel data: $0
- OSRM routing: $0 (self-hosted)
- OpenStreetMap tiles: $0

Optional paid (for scaling):
- PropStream: $150/mo (property intelligence, pre-foreclosures, equity)
- Regrid API: $250/mo (parcel boundaries + owner data, API access)

MVP cost: $0 (all free sources)
Next level: PropStream for richer per-home data

## 14. SUCCESS METRICS

For Erica:
1. Reps stop asking ChatGPT where to knock
2. Every rep has a clear route within 30 seconds of opening the app
3. Door knock productivity increases (more doors/hour from better territory selection)
4. HEAR-qualified leads identified faster
5. Callback tracking prevents lost leads

Technical:
6. 50+ neighborhoods scored across 6 zips
7. Route generation completes in <5 seconds
8. 14 days of unique routes without neighborhood repeats
9. Mobile-responsive on field phones
