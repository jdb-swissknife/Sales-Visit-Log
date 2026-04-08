import { db, businessesTable } from "./index.ts";
import { eq } from "drizzle-orm";

interface BusinessSeed {
  name: string;
  address?: string;
  phone?: string;
  sector: string;
  rating?: number;
  reviewCount?: number;
  mapsUrl?: string;
  priority: "high" | "medium" | "low";
  routeDay: number;
  isBonus: boolean;
  buildingGroup?: string | null;
}

const BUSINESSES: BusinessSeed[] = [
  // ── DAY 1 — North Minneapolis + Brooklyn Center + Columbia Heights ──
  {
    name: "Central Roofing Company",
    address: "4550 Main St NE, Minneapolis, MN 55421",
    phone: "(763) 572-0660",
    sector: "ROOFING",
    rating: 4.5,
    reviewCount: 61,
    mapsUrl: "https://maps.google.com/?cid=1111272801552340184",
    priority: "high",
    routeDay: 1,
    isBonus: false,
    buildingGroup: null,
  },
  {
    name: "Bolechowski Construction",
    address: "3031 Croft Dr, Minneapolis, MN 55418",
    phone: "(612) 965-1509",
    sector: "GENERAL CONTRACTOR",
    rating: 4.8,
    reviewCount: 66,
    mapsUrl: "https://maps.google.com/?cid=4676986517101676837",
    priority: "high",
    routeDay: 1,
    isBonus: false,
    buildingGroup: null,
  },
  {
    name: "Roof Repair PHD",
    address: "3201 N Humboldt Ave, Minneapolis, MN 55412",
    phone: "(612) 418-4240",
    sector: "ROOFING",
    rating: 5,
    reviewCount: 54,
    mapsUrl: "https://maps.google.com/?cid=18040947368546163432",
    priority: "high",
    routeDay: 1,
    isBonus: false,
    buildingGroup: null,
  },
  {
    name: "Johnny Five Construction",
    address: "338 24th Ave NE, Minneapolis, MN 55418",
    phone: "(612) 293-5778",
    sector: "GENERAL CONTRACTOR",
    rating: 5,
    reviewCount: 19,
    mapsUrl: "https://maps.google.com/?cid=18040947368546163432",
    priority: "medium",
    routeDay: 1,
    isBonus: false,
    buildingGroup: null,
  },
  // Day 1 Bonus
  {
    name: "Paris Painting",
    address: "3515 48th Ave N, Brooklyn Center, MN 55429",
    phone: "(763) 515-4463",
    sector: "PAINTING",
    rating: 4.8,
    reviewCount: 868,
    mapsUrl: "https://paris-painting.com/",
    priority: "medium",
    routeDay: 1,
    isBonus: true,
    buildingGroup: null,
  },
  {
    name: "Edison Electric",
    address: "3134 California St NE #126, Minneapolis, MN 55418",
    phone: "(612) 441-2728",
    sector: "ELECTRICAL",
    rating: 4.9,
    reviewCount: 1029,
    mapsUrl: "https://www.electrician-minneapolis.com/",
    priority: "medium",
    routeDay: 1,
    isBonus: true,
    buildingGroup: null,
  },

  // ── DAY 2 — South Minneapolis + Nokomis + Richfield ──
  {
    name: "Garlock-French Corporation",
    address: "2301 E 25th St, Minneapolis, MN 55406",
    phone: "(612) 722-7129",
    sector: "ROOFING",
    rating: 4.7,
    reviewCount: 143,
    mapsUrl: "https://maps.google.com/?cid=13692711712261859388",
    priority: "high",
    routeDay: 2,
    isBonus: false,
    buildingGroup: null,
  },
  {
    name: "Nokomis Roofing",
    address: "5053 36th Ave S, Minneapolis, MN 55417",
    phone: "(612) 221-4736",
    sector: "ROOFING",
    rating: 4.7,
    reviewCount: 58,
    mapsUrl: "https://maps.google.com/?cid=8685256349586553152",
    priority: "high",
    routeDay: 2,
    isBonus: false,
    buildingGroup: null,
  },
  {
    name: "Liberte Construction",
    address: "1406 W Lake St Suite 202, Minneapolis, MN 55408",
    phone: "(612) 712-6420",
    sector: "REMODELING",
    rating: 4.9,
    reviewCount: 205,
    mapsUrl: "https://maps.google.com/?cid=3271339792345538938",
    priority: "medium",
    routeDay: 2,
    isBonus: false,
    buildingGroup: null,
  },
  {
    name: "3 Bears Landscaping",
    address: "3916 Cheatham Ave, Minneapolis, MN 55406",
    phone: "(612) 806-3012",
    sector: "LANDSCAPING",
    rating: 4.8,
    reviewCount: 179,
    mapsUrl: "https://3bearslandscaping.com/",
    priority: "medium",
    routeDay: 2,
    isBonus: false,
    buildingGroup: null,
  },
  // Day 2 Bonus
  {
    name: "Roell Painting Company",
    address: "7301 Penn Ave S, Minneapolis, MN 55423",
    phone: "(763) 559-5296",
    sector: "PAINTING",
    rating: 4.9,
    reviewCount: 388,
    mapsUrl: "https://www.roellpainting.com/",
    priority: "medium",
    routeDay: 2,
    isBonus: true,
    buildingGroup: null,
  },
  {
    name: "Bratt Tree",
    address: "2423 E 26th St, Minneapolis, MN 55406",
    phone: "(612) 429-3904",
    sector: "TREE SERVICE",
    rating: 4.8,
    reviewCount: 440,
    mapsUrl: "https://www.bratttree.com/",
    priority: "medium",
    routeDay: 2,
    isBonus: true,
    buildingGroup: null,
  },
  {
    name: "Vineland Tree Care",
    address: "2504 25th Ave S, Minneapolis, MN 55406",
    phone: "(612) 872-0205",
    sector: "TREE SERVICE",
    rating: 4.9,
    reviewCount: 461,
    mapsUrl: "http://www.vinelandtree.com/",
    priority: "medium",
    routeDay: 2,
    isBonus: true,
    buildingGroup: null,
  },
  {
    name: "Big Mike's Gutters",
    address: "235 N Irving Ave, Minneapolis, MN 55405",
    phone: "(612) 275-2222",
    sector: "GUTTERS",
    rating: 4.7,
    reviewCount: 201,
    mapsUrl: "https://bigmikesgutters.net/",
    priority: "medium",
    routeDay: 2,
    isBonus: true,
    buildingGroup: null,
  },

  // ── DAY 3 — Bloomington + South Suburbs ──
  {
    name: "Twin Cities Contracting Services",
    address: "140 W 98th St #202, Bloomington, MN 55420",
    phone: "(952) 405-6201",
    sector: "GENERAL CONTRACTOR",
    rating: 5,
    reviewCount: 485,
    mapsUrl: "https://maps.google.com/?cid=2264026134366600485",
    priority: "high",
    routeDay: 3,
    isBonus: false,
    buildingGroup: null,
  },
  {
    name: "R & R Roofing Inc.",
    address: "8609 Lyndale Ave S, Bloomington, MN 55420",
    phone: "(952) 210-4988",
    sector: "ROOFING",
    rating: 5,
    reviewCount: 312,
    mapsUrl: "https://maps.google.com/?cid=1779344381757415722",
    priority: "high",
    routeDay: 3,
    isBonus: false,
    buildingGroup: null,
  },
  {
    name: "Snap Construction Inc.",
    address: "951 American Blvd E, Minneapolis, MN 55420",
    phone: "(612) 333-7627",
    sector: "GENERAL CONTRACTOR",
    rating: 4.9,
    reviewCount: 419,
    mapsUrl: "https://www.snapconstruction.com/",
    priority: "high",
    routeDay: 3,
    isBonus: false,
    buildingGroup: "951-american-blvd-e",
  },
  {
    name: "Your Home Improvement Company",
    address: "9555 James Ave S #250, Bloomington, MN 55431",
    phone: "(952) 522-3088",
    sector: "HOME IMPROVEMENT",
    rating: 4.7,
    reviewCount: 584,
    mapsUrl: "https://www.yourhomeimprovementco.com/",
    priority: "high",
    routeDay: 3,
    isBonus: false,
    buildingGroup: null,
  },
  // Day 3 Bonus
  {
    name: "USA Insulation of Minneapolis",
    address: "8055 Ranchers Rd NE, Minneapolis, MN 55432",
    phone: "(612) 767-3030",
    sector: "INSULATION",
    rating: 5,
    reviewCount: 564,
    mapsUrl: "https://usainsulation.com/minneapolis/",
    priority: "medium",
    routeDay: 3,
    isBonus: true,
    buildingGroup: null,
  },
  {
    name: "Affordable Insulation",
    address: "951 American Blvd E, Bloomington, MN 55420",
    phone: "(612) 435-2780",
    sector: "INSULATION",
    rating: 4.9,
    reviewCount: 128,
    mapsUrl: "http://www.affordableinsulationmn.com/",
    priority: "medium",
    routeDay: 3,
    isBonus: true,
    buildingGroup: "951-american-blvd-e",
  },

  // ── DAY 4 — St. Louis Park + West Suburbs ──
  {
    name: "Sela Roofing & Remodeling",
    address: "4521 MN-7 Suite A, Minneapolis, MN 55416",
    phone: "(612) 482-8213",
    sector: "ROOFING",
    rating: 5,
    reviewCount: 647,
    mapsUrl: "https://maps.google.com/?cid=15297467086839306215",
    priority: "high",
    routeDay: 4,
    isBonus: false,
    buildingGroup: null,
  },
  {
    name: "Minnesota Roofing Company",
    address: "1071 County Hwy 10 Ste 230, Spring Lake Park, MN 55432",
    phone: "(612) 888-7663",
    sector: "ROOFING",
    rating: 4.8,
    reviewCount: 262,
    mapsUrl: "https://maps.google.com/?cid=3330275434023154631",
    priority: "high",
    routeDay: 4,
    isBonus: false,
    buildingGroup: null,
  },
  {
    name: "Blue Yeti HVAC & Plumbing",
    address: "6325 Cambridge St #2, St Louis Park, MN 55416",
    phone: "(952) 209-7360",
    sector: "HVAC",
    rating: 4.9,
    reviewCount: 671,
    mapsUrl: "https://maps.google.com/?cid=2264026134366600485",
    priority: "high",
    routeDay: 4,
    isBonus: false,
    buildingGroup: "6325-cambridge-st",
  },
  // Day 4 Bonus
  {
    name: "Harrison Electric",
    address: "3440 Kilmer Ln N, Minneapolis, MN 55441",
    phone: "(763) 544-3300",
    sector: "ELECTRICAL",
    rating: 4.8,
    reviewCount: 959,
    mapsUrl: "https://harrison-electric.com/",
    priority: "medium",
    routeDay: 4,
    isBonus: true,
    buildingGroup: null,
  },
  {
    name: "ONYX Plumbing & Gas",
    address: "6325 Cambridge St #7, Minneapolis, MN 55416",
    phone: "(612) 234-6699",
    sector: "PLUMBING",
    rating: 4.9,
    reviewCount: 115,
    mapsUrl: "https://calltheonyx.com/",
    priority: "medium",
    routeDay: 4,
    isBonus: true,
    buildingGroup: "6325-cambridge-st",
  },
];

async function main() {
  process.stdout.write("Seeding businesses...\n");

  const existing = await db
    .select({ id: businessesTable.id, name: businessesTable.name })
    .from(businessesTable);
  const existingByName = new Map(existing.map((b) => [b.name.toLowerCase(), b.id]));

  let inserted = 0;
  let updated = 0;

  for (const business of BUSINESSES) {
    const existingId = existingByName.get(business.name.toLowerCase());
    if (existingId !== undefined) {
      await db
        .update(businessesTable)
        .set({
          address: business.address,
          phone: business.phone,
          sector: business.sector,
          rating: business.rating,
          reviewCount: business.reviewCount,
          mapsUrl: business.mapsUrl,
          priority: business.priority,
          routeDay: business.routeDay,
          isBonus: business.isBonus,
          buildingGroup: business.buildingGroup ?? null,
        })
        .where(eq(businessesTable.id, existingId));
      process.stdout.write(`  Updated: ${business.name}\n`);
      updated++;
    } else {
      await db.insert(businessesTable).values(business);
      process.stdout.write(`  Inserted: ${business.name}\n`);
      inserted++;
    }
  }

  const all = await db
    .select({ id: businessesTable.id, name: businessesTable.name, routeDay: businessesTable.routeDay })
    .from(businessesTable);
  process.stdout.write(`\nTotal businesses: ${all.length} (inserted: ${inserted}, updated: ${updated})\n`);
  process.stdout.write("Done!\n");
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(String(err) + "\n");
  process.exit(1);
});
