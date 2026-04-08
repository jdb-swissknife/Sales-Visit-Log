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
  {
    name: "Bolechowski Construction",
    address: "2615 Fremont Ave N, Minneapolis, MN 55411",
    phone: "(612) 588-1234",
    sector: "roofing",
    rating: 4.2,
    reviewCount: 18,
    mapsUrl: "https://maps.google.com/?q=Bolechowski+Construction+Minneapolis",
    priority: "high",
    routeDay: 1,
    isBonus: false,
    buildingGroup: null,
  },
  {
    name: "Roof Repair PHD",
    address: "3001 Central Ave NE, Minneapolis, MN 55418",
    phone: "(612) 789-5555",
    sector: "roofing",
    rating: 4.5,
    reviewCount: 42,
    mapsUrl: "https://maps.google.com/?q=Roof+Repair+PHD+Minneapolis",
    priority: "high",
    routeDay: 1,
    isBonus: false,
    buildingGroup: null,
  },
  {
    name: "Johnny Five Construction",
    address: "4001 University Ave NE, Minneapolis, MN 55421",
    phone: "(612) 331-9000",
    sector: "roofing",
    rating: 4.1,
    reviewCount: 29,
    mapsUrl: "https://maps.google.com/?q=Johnny+Five+Construction+Minneapolis",
    priority: "medium",
    routeDay: 1,
    isBonus: false,
    buildingGroup: null,
  },
  {
    name: "Nokomis Roofing",
    address: "5101 34th Ave S, Minneapolis, MN 55417",
    phone: "(612) 724-8888",
    sector: "roofing",
    rating: 4.6,
    reviewCount: 67,
    mapsUrl: "https://maps.google.com/?q=Nokomis+Roofing+Minneapolis",
    priority: "high",
    routeDay: 2,
    isBonus: false,
    buildingGroup: null,
  },
  {
    name: "Your Home Improvement Company",
    address: "7001 Penn Ave S, Richfield, MN 55423",
    phone: "(612) 866-2222",
    sector: "roofing",
    rating: 4.3,
    reviewCount: 53,
    mapsUrl: "https://maps.google.com/?q=Your+Home+Improvement+Company+Richfield",
    priority: "medium",
    routeDay: 2,
    isBonus: false,
    buildingGroup: null,
  },
  {
    name: "Minnesota Roofing Company",
    address: "6200 Penn Ave S, Richfield, MN 55423",
    phone: "(612) 866-7700",
    sector: "roofing",
    rating: 4.4,
    reviewCount: 38,
    mapsUrl: "https://maps.google.com/?q=Minnesota+Roofing+Company+Richfield",
    priority: "medium",
    routeDay: 2,
    isBonus: false,
    buildingGroup: null,
  },
  {
    name: "Snap Construction Inc.",
    address: "951 American Blvd E, Bloomington, MN 55420",
    phone: "(952) 884-7474",
    sector: "roofing",
    rating: 4.7,
    reviewCount: 91,
    mapsUrl: "https://maps.google.com/?q=Snap+Construction+Bloomington",
    priority: "high",
    routeDay: 3,
    isBonus: false,
    buildingGroup: "951 American Blvd E, Bloomington",
  },
  {
    name: "Affordable Insulation",
    address: "951 American Blvd E, Bloomington, MN 55420",
    phone: "(952) 884-6000",
    sector: "insulation",
    rating: 4.3,
    reviewCount: 27,
    mapsUrl: "https://maps.google.com/?q=Affordable+Insulation+Bloomington",
    priority: "medium",
    routeDay: 3,
    isBonus: true,
    buildingGroup: "951 American Blvd E, Bloomington",
  },
  {
    name: "Blue Yeti HVAC & Plumbing",
    address: "6325 Cambridge St, St Louis Park, MN 55416",
    phone: "(952) 920-4343",
    sector: "hvac",
    rating: 4.8,
    reviewCount: 112,
    mapsUrl: "https://maps.google.com/?q=Blue+Yeti+HVAC+St+Louis+Park",
    priority: "high",
    routeDay: 4,
    isBonus: false,
    buildingGroup: "6325 Cambridge St, St Louis Park",
  },
  {
    name: "ONYX Plumbing & Gas",
    address: "6325 Cambridge St, St Louis Park, MN 55416",
    phone: "(952) 920-8800",
    sector: "plumbing",
    rating: 4.6,
    reviewCount: 45,
    mapsUrl: "https://maps.google.com/?q=ONYX+Plumbing+St+Louis+Park",
    priority: "medium",
    routeDay: 4,
    isBonus: true,
    buildingGroup: "6325 Cambridge St, St Louis Park",
  },
  {
    name: "Paris Painting",
    address: "6801 Humboldt Ave N, Brooklyn Center, MN 55430",
    phone: "(763) 561-7777",
    sector: "painting",
    rating: 4.5,
    reviewCount: 34,
    mapsUrl: "https://maps.google.com/?q=Paris+Painting+Brooklyn+Center",
    priority: "medium",
    routeDay: 1,
    isBonus: true,
    buildingGroup: null,
  },
  {
    name: "Edison Electric",
    address: "2502 Central Ave NE, Minneapolis, MN 55418",
    phone: "(612) 781-6655",
    sector: "electrical",
    rating: 4.4,
    reviewCount: 58,
    mapsUrl: "https://maps.google.com/?q=Edison+Electric+Minneapolis",
    priority: "medium",
    routeDay: 1,
    isBonus: true,
    buildingGroup: null,
  },
  {
    name: "Roell Painting",
    address: "5400 Stevens Ave S, Minneapolis, MN 55419",
    phone: "(612) 824-9090",
    sector: "painting",
    rating: 4.6,
    reviewCount: 48,
    mapsUrl: "https://maps.google.com/?q=Roell+Painting+Minneapolis",
    priority: "medium",
    routeDay: 2,
    isBonus: true,
    buildingGroup: null,
  },
  {
    name: "Bratt Tree",
    address: "3701 39th Ave S, Minneapolis, MN 55406",
    phone: "(612) 724-1880",
    sector: "tree service",
    rating: 4.7,
    reviewCount: 73,
    mapsUrl: "https://maps.google.com/?q=Bratt+Tree+Minneapolis",
    priority: "medium",
    routeDay: 2,
    isBonus: true,
    buildingGroup: null,
  },
  {
    name: "Vineland Tree Care",
    address: "6320 Lyndale Ave S, Minneapolis, MN 55423",
    phone: "(612) 866-3300",
    sector: "tree service",
    rating: 4.5,
    reviewCount: 29,
    mapsUrl: "https://maps.google.com/?q=Vineland+Tree+Care+Minneapolis",
    priority: "medium",
    routeDay: 2,
    isBonus: true,
    buildingGroup: null,
  },
  {
    name: "Big Mike's Gutters",
    address: "4820 34th Ave S, Minneapolis, MN 55417",
    phone: "(612) 724-6484",
    sector: "gutters",
    rating: 4.3,
    reviewCount: 41,
    mapsUrl: "https://maps.google.com/?q=Big+Mikes+Gutters+Minneapolis",
    priority: "medium",
    routeDay: 2,
    isBonus: true,
    buildingGroup: null,
  },
  {
    name: "USA Insulation",
    address: "8900 Penn Ave S, Bloomington, MN 55431",
    phone: "(952) 884-1111",
    sector: "insulation",
    rating: 4.4,
    reviewCount: 62,
    mapsUrl: "https://maps.google.com/?q=USA+Insulation+Bloomington",
    priority: "medium",
    routeDay: 3,
    isBonus: true,
    buildingGroup: null,
  },
  {
    name: "Harrison Electric",
    address: "7201 Wayzata Blvd, St Louis Park, MN 55426",
    phone: "(952) 546-1234",
    sector: "electrical",
    rating: 4.5,
    reviewCount: 37,
    mapsUrl: "https://maps.google.com/?q=Harrison+Electric+St+Louis+Park",
    priority: "medium",
    routeDay: 4,
    isBonus: true,
    buildingGroup: null,
  },
];

async function main() {
  console.log("Seeding businesses...");

  const existing = await db.select({ id: businessesTable.id, name: businessesTable.name }).from(businessesTable);
  const existingByName = new Map(existing.map((b) => [b.name.toLowerCase(), b.id]));

  let inserted = 0;
  let updated = 0;

  for (const business of BUSINESSES) {
    const existingId = existingByName.get(business.name.toLowerCase());
    if (existingId !== undefined) {
      await db
        .update(businessesTable)
        .set({
          routeDay: business.routeDay,
          isBonus: business.isBonus,
          buildingGroup: business.buildingGroup ?? undefined,
          address: business.address,
          phone: business.phone,
          rating: business.rating,
          reviewCount: business.reviewCount,
          mapsUrl: business.mapsUrl,
          priority: business.priority,
        })
        .where(eq(businessesTable.id, existingId));
      console.log(`  Updated: ${business.name}`);
      updated++;
    } else {
      await db.insert(businessesTable).values(business);
      console.log(`  Inserted: ${business.name}`);
      inserted++;
    }
  }

  const all = await db.select({ id: businessesTable.id, name: businessesTable.name, routeDay: businessesTable.routeDay }).from(businessesTable);
  console.log(`\nTotal businesses: ${all.length} (inserted: ${inserted}, updated: ${updated})`);
  console.log("Done!");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
