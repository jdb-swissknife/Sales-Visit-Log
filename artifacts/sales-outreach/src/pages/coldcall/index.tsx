import { useState } from "react";
import { Phone, Globe, Star, Search, ChevronDown, ChevronUp } from "lucide-react";
import { Input } from "@/components/ui/input";

interface ColdCallCompany {
  id: number;
  name: string;
  type: string;
  industry: string;
  address: string;
  rating: number;
  reviews: number;
  phone: string;
  website: string;
}

const COMPANIES: ColdCallCompany[] = [
  { id: 1, name: "Hero Plumbing, Heating, Cooling & Electrical", type: "HVAC/Plumbing/Electrical", industry: "HVAC", address: "10900 Hampshire Ave S #120, Bloomington", rating: 4.7, reviews: 18342, phone: "(612) 504-1620", website: "callhero.com" },
  { id: 2, name: "Standard Heating & Air Conditioning", type: "HVAC", industry: "HVAC", address: "130 Plymouth Ave N, Minneapolis", rating: 4.9, reviews: 6603, phone: "(612) 824-2656", website: "standardheating.com" },
  { id: 3, name: "Randy's Electric & Plumbing", type: "Electrical/Plumbing", industry: "Electrical", address: "13400 67th Ave N, Maple Grove", rating: 4.8, reviews: 6230, phone: "(612) 712-4183", website: "randyselectric.com" },
  { id: 4, name: "Pronto Heating and Air Conditioning", type: "HVAC", industry: "HVAC", address: "7415 Cahill Rd, Minneapolis", rating: 4.9, reviews: 5505, phone: "(952) 835-7777", website: "prontoheat.com" },
  { id: 5, name: "Blue Ox Heating & Air", type: "HVAC", industry: "HVAC", address: "5720 International Pkwy, Minneapolis", rating: 4.8, reviews: 4052, phone: "(651) 300-1636", website: "goblueox.com" },
  { id: 6, name: "EarlyBird Electric", type: "Electrical", industry: "Electrical", address: "5720 International Pkwy, New Hope", rating: 4.8, reviews: 3572, phone: "(612) 217-7756", website: "earlybirdelectricians.com" },
  { id: 7, name: "Total Comfort Heating & Cooling", type: "HVAC", industry: "HVAC", address: "8818 7th Ave N, Golden Valley", rating: 4.8, reviews: 3379, phone: "(763) 299-7433", website: "tcomfort.com" },
  { id: 8, name: "Home Energy Heating & Cooling", type: "HVAC", industry: "HVAC", address: "2415 Annapolis Ln N #170, Plymouth", rating: 4.9, reviews: 3246, phone: "(763) 200-1886", website: "homeenergycenter.com" },
  { id: 9, name: "All American Door Co.", type: "Garage Doors", industry: "Garage Doors", address: "1634 County Hwy 10 #6, Minneapolis", rating: 4.9, reviews: 2703, phone: "(763) 244-1605", website: "allamericandoormn.com" },
  { id: 10, name: "Metro Heating & Cooling", type: "HVAC", industry: "HVAC", address: "1220 Cope Ave E, Maplewood", rating: 4.9, reviews: 2203, phone: "(651) 294-7798", website: "metroheating.net" },
  { id: 11, name: "A1 Garage Door Service", type: "Garage Doors", industry: "Garage Doors", address: "3801 W 50th St #250b, Minneapolis", rating: 4.9, reviews: 1828, phone: "(612) 238-5253", website: "a1garage.com" },
  { id: 12, name: "Plunkett's Pest Control", type: "Pest Control", industry: "Pest Control", address: "40 52nd Way NE, Fridley", rating: 4.8, reviews: 1451, phone: "(763) 265-7812", website: "plunketts.net" },
  { id: 13, name: "Rove Pest Control", type: "Pest Control", industry: "Pest Control", address: "301 4th Ave S #272h, Minneapolis", rating: 4.9, reviews: 1370, phone: "(763) 400-8989", website: "rovepestcontrol.com" },
  { id: 14, name: "Superior Garage Door Repair", type: "Garage Doors", industry: "Garage Doors", address: "1405 Lilac Dr N #160B, Minneapolis", rating: 4.9, reviews: 1326, phone: "(612) 999-1228", website: "247superiorgaragedoor.com" },
  { id: 15, name: "Northland Fence", type: "Fencing", industry: "Fencing/Decks", address: "7703 Main St NE, Fridley", rating: 4.9, reviews: 1208, phone: "(763) 373-4906", website: "northlandfence.com" },
  { id: 16, name: "Stafford Home Service", type: "HVAC/Plumbing", industry: "HVAC", address: "6225 Cambridge St, Minneapolis", rating: 4.9, reviews: 1160, phone: "(612) 895-6883", website: "staffordhomeservice.com" },
  { id: 17, name: "Champion Replacement Windows", type: "Windows", industry: "Windows", address: "5100 US-169 N Suite B, New Hope", rating: 4.5, reviews: 1015, phone: "(763) 515-8426", website: "championwindow.com" },
  { id: 18, name: "Countryside Heating & Cooling", type: "HVAC", industry: "HVAC", address: "1960 County Rd 90 #200, Maple Plain", rating: 4.9, reviews: 1013, phone: "(763) 299-9996", website: "countryside-solutions.com" },
  { id: 19, name: "Bloomington Heating & Air", type: "HVAC", industry: "HVAC", address: "1101 W 80th St, Bloomington", rating: 5.0, reviews: 956, phone: "(952) 395-5808", website: "bloomingtonheating.com" },
  { id: 20, name: "Advantage Electric", type: "Electrical", industry: "Electrical", address: "9257 W River Rd, Minneapolis", rating: 5.0, reviews: 939, phone: "(612) 751-1772", website: "advantageelectricmn.com" },
  { id: 21, name: "Valor Pest Solutions", type: "Pest Control", industry: "Pest Control", address: "530 N 3rd St Unit C, Minneapolis", rating: 4.9, reviews: 863, phone: "(763) 777-7010", website: "valorpestsolutions.com" },
  { id: 22, name: "Rainbow Lawncare", type: "Lawn Care", industry: "Tree/Landscape/Lawn", address: "11571 K-Tel Dr, Minnetonka", rating: 4.8, reviews: 601, phone: "(952) 252-0535", website: "rainbowlawncare.com" },
  { id: 23, name: "NMC Exteriors / Apple Roofing", type: "Roofing", industry: "Roofing/Gutters", address: "14505 21st Ave N #226, Plymouth", rating: 4.8, reviews: 585, phone: "(763) 325-1439", website: "appleroof.com" },
  { id: 24, name: "Norske Electric", type: "Electrical", industry: "Electrical", address: "3540 Kilkerry Ln #100, Hamel", rating: 5.0, reviews: 571, phone: "(952) 443-4113", website: "norskeelectric.com" },
  { id: 25, name: "Window Nation Minneapolis", type: "Windows", industry: "Windows", address: "8862 W 35W Service Dr NE, Blaine", rating: 4.5, reviews: 523, phone: "(612) 213-0485", website: "windownation.com" },
  { id: 26, name: "Showcase Lawn Care", type: "Lawn Care", industry: "Tree/Landscape/Lawn", address: "9210 Wyoming Ave N #260, Brooklyn Park", rating: 4.8, reviews: 520, phone: "(763) 425-1200", website: "lawn.pro" },
  { id: 27, name: "Minnesota Tree Experts", type: "Tree Service", industry: "Tree/Landscape/Lawn", address: "7527 Oliver Ave, Brooklyn Park", rating: 4.8, reviews: 507, phone: "(763) 560-9616", website: "minnesotatreeexperts.com" },
  { id: 28, name: "Aladdin Doors Inc.", type: "Garage Doors", industry: "Garage Doors", address: "800 SE Washington Ave #205, Minneapolis", rating: 4.9, reviews: 466, phone: "(612) 314-3040", website: "aladdindoors.com" },
  { id: 29, name: "Craftsmen Home Improvements", type: "Home Improvement", industry: "General Contractor", address: "7455 France Ave S #194, Edina", rating: 5.0, reviews: 442, phone: "(952) 930-3777", website: "craftsmenhomeimprovements.com" },
  { id: 30, name: "Shared Solar Advisors USA", type: "Solar", industry: "Solar", address: "3800 American Blvd W #1500, Bloomington", rating: 5.0, reviews: 435, phone: "(952) 900-2837", website: "sharedsolaradvisors.com" },
  { id: 31, name: "Kaufman Roofing", type: "Roofing", industry: "Roofing/Gutters", address: "14330 Ewing Ave S, Burnsville", rating: 4.8, reviews: 426, phone: "(612) 722-0965", website: "kaufmanroofing.com" },
  { id: 32, name: "Green Clean", type: "Cleaning", industry: "Restoration/Cleaning", address: "5301 E River Rd #115, Fridley", rating: 4.9, reviews: 403, phone: "(612) 789-9600", website: "teamgreenclean.com" },
  { id: 33, name: "Abra Kadabra Environmental", type: "Restoration/Environmental", industry: "Restoration/Cleaning", address: "1101 Pierce St NE, Minneapolis", rating: 4.9, reviews: 381, phone: "(763) 645-5948", website: "abrakadabraenvironmental.com" },
  { id: 34, name: "KNO Woodworks", type: "Woodworking/Remodel", industry: "General Contractor", address: "4649 Bloomington Ave, Minneapolis", rating: 5.0, reviews: 367, phone: "(612) 226-5172", website: "knowoodworks.com" },
  { id: 35, name: "Presidential Construction", type: "General Contractor", industry: "General Contractor", address: "6885 Sycamore Ln N #220, Maple Grove", rating: 5.0, reviews: 361, phone: "(651) 766-3464", website: "presidentialconstructioninc.com" },
  { id: 36, name: "Superior Fence & Rail", type: "Fencing", industry: "Fencing/Decks", address: "5340 Quam Ave NE, St Michael", rating: 5.0, reviews: 358, phone: "(763) 340-0010", website: "superiorfenceandrail.com" },
  { id: 37, name: "The Brothers That Just Do Gutters", type: "Gutters", industry: "Roofing/Gutters", address: "7256 Commerce Cir E #A, Fridley", rating: 4.9, reviews: 316, phone: "(763) 328-0118", website: "brothersgutters.com" },
  { id: 38, name: "Headwaters Painting", type: "Painting", industry: "Painting", address: "1101 Stinson Blvd NE #102, Minneapolis", rating: 5.0, reviews: 311, phone: "(612) 208-6383", website: "headwaterspainting.com" },
  { id: 39, name: "Five Star Bath Solutions", type: "Bathroom Remodeling", industry: "General Contractor", address: "3572 Hoffman Rd E, Vadnais Heights", rating: 4.7, reviews: 282, phone: "(612) 261-0101", website: "fivestarbathsolutions.com" },
  { id: 40, name: "Bayport Roofing and Siding", type: "Roofing/Siding", industry: "Roofing/Gutters", address: "2240 Edgewood Ave S #201, St Louis Park", rating: 4.6, reviews: 279, phone: "(612) 235-7663", website: "bayportroofing.com" },
  { id: 41, name: "Nordeast Electric", type: "Electrical", industry: "Electrical", address: "4219 Central Ave NE, Minneapolis", rating: 4.8, reviews: 276, phone: "(763) 789-4800", website: "nordeastelectric.com" },
  { id: 42, name: "Rosebud Decks & Porches", type: "Deck Builder", industry: "Fencing/Decks", address: "2275 McKnight Rd N #8, North St Paul", rating: 4.9, reviews: 244, phone: "(651) 409-5606", website: "rosebudconstruction.com" },
  { id: 43, name: "Centauri Systems", type: "Solar", industry: "Solar", address: "9278 Isanti St NE, Blaine", rating: 5.0, reviews: 176, phone: "(763) 248-2734", website: "solarbycentauri.com" },
  { id: 44, name: "American Sewer LLC", type: "Sewer/Plumbing", industry: "Plumbing", address: "9001 Emerson Ave S, Bloomington", rating: 4.8, reviews: 166, phone: "(612) 246-4800", website: "americansewers.com" },
  { id: 45, name: "Twin Cities Siding & Roofing", type: "Siding/Roofing", industry: "Roofing/Gutters", address: "1053 Grand Ave, St Paul", rating: 4.9, reviews: 165, phone: "(651) 390-1806", website: "tcsidingprofessionals.com" },
  { id: 46, name: "Mid-State Seamless Gutters", type: "Gutters", industry: "Roofing/Gutters", address: "8401 73rd Ave N #44, Brooklyn Park", rating: 4.8, reviews: 154, phone: "(612) 801-1151", website: "onegutter.com" },
  { id: 47, name: "KRA Tree & Stump Services", type: "Tree Service", industry: "Tree/Landscape/Lawn", address: "9731 4th Ave S, Bloomington", rating: 5.0, reviews: 149, phone: "(612) 516-8118", website: "facebook.com/KRATree" },
  { id: 48, name: "Skyline Electric", type: "Electrical", industry: "Electrical", address: "2500 Cleveland Ave N #J, Roseville", rating: 4.9, reviews: 134, phone: "(651) 504-3448", website: "skylineelectricmn.com" },
  { id: 49, name: "Pro Window Repair & Service", type: "Windows", industry: "Windows", address: "9101 Davenport St NE, Blaine", rating: 5.0, reviews: 128, phone: "(612) 240-0772", website: "prowindowrepair.com" },
  { id: 50, name: "Sela Gutter Connection", type: "Gutters", industry: "Roofing/Gutters", address: "3400 48th Ave N, Brooklyn Center", rating: 4.8, reviews: 126, phone: "(612) 442-1080", website: "selagutterconnection.com" },
  { id: 51, name: "Mill City Concrete and Masonry", type: "Concrete", industry: "Concrete/Masonry", address: "1822 Monroe St NE, Minneapolis", rating: 4.7, reviews: 126, phone: "(612) 723-3963", website: "millcityconcrete.com" },
  { id: 52, name: "iFlooring", type: "Flooring", industry: "Flooring", address: "1710 Douglas Dr N #224V, Golden Valley", rating: 5.0, reviews: 125, phone: "(612) 759-0620", website: "ifloormn.com" },
  { id: 53, name: "Dean Bjorkstrand Landscaping", type: "Landscaping", industry: "Tree/Landscape/Lawn", address: "5508 Clinton Ave, Minneapolis", rating: 4.9, reviews: 122, phone: "(612) 861-3919", website: "deanbjorkstrand.com" },
  { id: 54, name: "Signature Electric Co", type: "Electrical", industry: "Electrical", address: "4675 Balsam Ln N, Plymouth", rating: 4.8, reviews: 120, phone: "(763) 588-0090", website: "signatureelectric.net" },
  { id: 55, name: "Lifetime Garage Door Repair", type: "Garage Doors", industry: "Garage Doors", address: "2920 Bryant Ave S #333, Minneapolis", rating: 4.9, reviews: 117, phone: "(952) 333-4818", website: "lifetimegaragedoorrepair.com" },
  { id: 56, name: "ONYX Plumbing & Gas", type: "Plumbing", industry: "Plumbing", address: "6325 Cambridge St #7, Minneapolis", rating: 4.9, reviews: 115, phone: "(612) 234-6699", website: "calltheonyx.com" },
  { id: 57, name: "US Solar Corporation", type: "Solar", industry: "Solar", address: "323 N Washington Ave #350, Minneapolis", rating: 4.6, reviews: 117, phone: "(612) 260-2230", website: "us-solar.com" },
  { id: 58, name: "TruNorth Solar", type: "Solar", industry: "Solar", address: "3735 Dunlap St N, Arden Hills", rating: 4.9, reviews: 71, phone: "(612) 888-9599", website: "trunorthsolar.com" },
  { id: 59, name: "MN Solar", type: "Solar", industry: "Solar", address: "9841 13th Ave N, Plymouth", rating: 4.9, reviews: 113, phone: "(320) 444-5696", website: "mnsolarandmore.com" },
  { id: 60, name: "Erik Nelson Plumbing LLC", type: "Plumbing", industry: "Plumbing", address: "2617 37th Ave S, Minneapolis", rating: 4.9, reviews: 223, phone: "(612) 242-6483", website: "eriknelsonplumbing.com" },
  { id: 61, name: "Allstar Construction", type: "General Contractor", industry: "General Contractor", address: "5145 Industrial St #103, Maple Plain", rating: 4.8, reviews: 219, phone: "(763) 296-7771", website: "allstartoday.com" },
  { id: 62, name: "Hayes Window Restoration", type: "Windows", industry: "Windows", address: "2508 24th Ave S, Minneapolis", rating: 5.0, reviews: 209, phone: "(612) 259-7855", website: "hayeswindows.com" },
  { id: 63, name: "Deck Science", type: "Deck Builder", industry: "Fencing/Decks", address: "5200 Willson Rd, Edina", rating: 5.0, reviews: 202, phone: "(612) 778-4141", website: "deckscience.com" },
  { id: 64, name: "Keyprime Roofing and Remodeling", type: "Roofing/Remodeling", industry: "Roofing/Gutters", address: "1000 Boone Ave N #760, Golden Valley", rating: 4.9, reviews: 197, phone: "(952) 230-1269", website: "keyprimeroofing.com" },
  { id: 65, name: "Bedrock Restoration", type: "Restoration", industry: "Restoration/Cleaning", address: "7000 Oxford St, St Louis Park", rating: 4.9, reviews: 193, phone: "(612) 778-3044", website: "bedrockrestoration.com" },
  { id: 66, name: "A to Z Construction", type: "Roofing/Remodeling", industry: "Roofing/Gutters", address: "124 County Rd 81, Maple Grove", rating: 5.0, reviews: 189, phone: "(612) 366-1386", website: "atoz-construction.com" },
  { id: 67, name: "Bold North Roofing and Contracting", type: "Roofing", industry: "Roofing/Gutters", address: "1620 W 98th St #100, Minneapolis", rating: 5.0, reviews: 182, phone: "(952) 260-2293", website: "boldnorthroofing.com" },
  { id: 68, name: "TWS Remodeling", type: "Windows/Remodeling", industry: "Windows", address: "8616 Xylon Ave N #A, Minneapolis", rating: 4.5, reviews: 1033, phone: "(612) 353-5780", website: "twsremodeling.com" },
  { id: 69, name: "Grounded Earth", type: "Landscaping", industry: "Tree/Landscape/Lawn", address: "603 Ontario St SE Unit 1, Minneapolis", rating: 4.9, reviews: 119, phone: "(612) 223-6441", website: "groundedearthservices.com" },
  { id: 70, name: "Brennan Heikes Professional Painting", type: "Painting", industry: "Painting", address: "612 Morgan Ave S, Minneapolis", rating: 5.0, reviews: 83, phone: "(612) 743-4458", website: "brennanheikespainting.com" },
  { id: 71, name: "Varsity Painters", type: "Painting", industry: "Painting", address: "5416 Chicago Ave, Minneapolis", rating: 4.9, reviews: 108, phone: "(952) 938-3886", website: "varsitypainters.com" },
  { id: 72, name: "Lakeside Floor Coverings", type: "Flooring", industry: "Flooring", address: "7500 University Ave NE APT 1, Fridley", rating: 4.8, reviews: 102, phone: "(763) 503-0100", website: "lakesidefloorcovering.com" },
  { id: 73, name: "Ridgeline Fence and Deck", type: "Fencing/Decks", industry: "Fencing/Decks", address: "3463 Hiawatha Ave, Minneapolis", rating: 5.0, reviews: 676, phone: "(612) 868-4879", website: "ridgelinefenceanddeck.com" },
  { id: 74, name: "Cedar Creek Energy", type: "Solar", industry: "Solar", address: "3155 104th Ln NE, Blaine", rating: 4.9, reviews: 71, phone: "(763) 432-5261", website: "cedarcreekenergy.com" },
  { id: 75, name: "Refuge Design & Landscape", type: "Landscaping", industry: "Tree/Landscape/Lawn", address: "3021 10th Ave S, Minneapolis", rating: 4.9, reviews: 65, phone: "(952) 236-4843", website: "refugemn.com" },
];

const INDUSTRIES = [
  "All",
  "HVAC",
  "Electrical",
  "Plumbing",
  "Roofing/Gutters",
  "Solar",
  "Garage Doors",
  "Painting",
  "Tree/Landscape/Lawn",
  "Fencing/Decks",
  "Windows",
  "Restoration/Cleaning",
  "Pest Control",
  "General Contractor",
  "Concrete/Masonry",
  "Flooring",
];

const INDUSTRY_COLORS: Record<string, string> = {
  "HVAC": "bg-blue-500/10 text-blue-400 border-blue-500/20",
  "Electrical": "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
  "Plumbing": "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
  "Roofing/Gutters": "bg-orange-500/10 text-orange-400 border-orange-500/20",
  "Solar": "bg-amber-500/10 text-amber-400 border-amber-500/20",
  "Garage Doors": "bg-stone-500/10 text-stone-400 border-stone-500/20",
  "Painting": "bg-purple-500/10 text-purple-400 border-purple-500/20",
  "Tree/Landscape/Lawn": "bg-green-500/10 text-green-400 border-green-500/20",
  "Fencing/Decks": "bg-lime-500/10 text-lime-400 border-lime-500/20",
  "Windows": "bg-sky-500/10 text-sky-400 border-sky-500/20",
  "Restoration/Cleaning": "bg-teal-500/10 text-teal-400 border-teal-500/20",
  "Pest Control": "bg-red-500/10 text-red-400 border-red-500/20",
  "General Contractor": "bg-slate-500/10 text-slate-400 border-slate-500/20",
  "Concrete/Masonry": "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
  "Flooring": "bg-rose-500/10 text-rose-400 border-rose-500/20",
};

function formatReviews(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

function ScriptPanel() {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <span className="font-semibold text-sm text-primary">Cold Call Script</span>
        {open ? <ChevronUp className="h-4 w-4 text-primary" /> : <ChevronDown className="h-4 w-4 text-primary" />}
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-4 border-t border-primary/20">
          <div className="rounded-lg bg-card border border-border p-4 mt-3">
            <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider mb-2">Opening</p>
            <p className="text-sm text-foreground leading-relaxed">
              "Hey [Owner Name], this is [Your Name]. I help service businesses like yours automate their phone calls, scheduling, and follow-ups using AI. I noticed you guys have a great reputation — [reference reviews] — and I had a couple ideas that could save your team 10–15 hours a week. Do you have 2 minutes?"
            </p>
          </div>
          <div className="grid sm:grid-cols-3 gap-3">
            <div className="rounded-lg bg-green-500/10 border border-green-500/20 p-3">
              <p className="text-xs font-bold text-green-400 uppercase tracking-wider mb-1.5">If yes →</p>
              <p className="text-xs text-foreground leading-relaxed">Show the 2-min demo: <span className="text-green-400 font-medium">daily-brief-live.base44.app</span></p>
            </div>
            <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-3">
              <p className="text-xs font-bold text-amber-400 uppercase tracking-wider mb-1.5">If no / not interested →</p>
              <p className="text-xs text-foreground leading-relaxed">"No worries. Can I send you a quick email with a 2-minute video? You can check it out when it's convenient." → Get email.</p>
            </div>
            <div className="rounded-lg bg-muted border border-border p-3">
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1.5">If gatekeeper / voicemail →</p>
              <p className="text-xs text-foreground leading-relaxed">"Hey, this is [Name] calling for [Owner Name] about AI automation tools that could help with [company]'s scheduling and follow-ups. I'll try back at a better time. My number is [number]."</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ColdCallPage() {
  const [search, setSearch] = useState("");
  const [industry, setIndustry] = useState("All");

  const filtered = COMPANIES.filter((c) => {
    const matchesSearch =
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.type.toLowerCase().includes(search.toLowerCase());
    const matchesIndustry = industry === "All" || c.industry === industry;
    return matchesSearch && matchesIndustry;
  });

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Phone className="h-6 w-6 text-primary" />
          Cold Call List
        </h1>
        <p className="text-muted-foreground mt-1">
          75 mid-size service businesses · Minneapolis area · {COMPANIES.length} total prospects
        </p>
      </div>

      {/* Script panel */}
      <ScriptPanel />

      {/* Filters */}
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name or type..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
          {INDUSTRIES.map((ind) => (
            <button
              key={ind}
              onClick={() => setIndustry(ind)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                industry === ind
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground border-border hover:border-foreground hover:text-foreground"
              }`}
            >
              {ind}
            </button>
          ))}
        </div>
      </div>

      {/* Count */}
      <p className="text-xs text-muted-foreground">
        Showing {filtered.length} of {COMPANIES.length}
      </p>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground bg-muted/30 rounded-lg border border-dashed border-border">
          No companies match your search.
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((company) => (
            <div
              key={company.id}
              className="rounded-xl border border-border bg-card p-4 flex flex-col sm:flex-row sm:items-center gap-3"
            >
              {/* Left: rank + name */}
              <div className="flex-1 min-w-0">
                <div className="flex items-start gap-2 flex-wrap">
                  <span className="text-xs text-muted-foreground font-mono mt-0.5 shrink-0">
                    #{company.id}
                  </span>
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground leading-snug">{company.name}</p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold border ${INDUSTRY_COLORS[company.industry] ?? "bg-muted text-muted-foreground border-border"}`}>
                        {company.type}
                      </span>
                      <span className="flex items-center gap-0.5 text-xs text-amber-400 font-semibold">
                        <Star className="h-3 w-3 fill-amber-400" />
                        {company.rating}
                        <span className="text-muted-foreground font-normal ml-0.5">({formatReviews(company.reviews)})</span>
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right: actions */}
              <div className="flex items-center gap-2 shrink-0">
                <a
                  href={`tel:${company.phone}`}
                  className="flex items-center gap-1.5 rounded-lg bg-primary/10 border border-primary/20 hover:bg-primary/20 px-3 py-2 text-sm font-semibold text-primary transition-colors"
                  title={company.phone}
                >
                  <Phone className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{company.phone}</span>
                  <span className="sm:hidden">Call</span>
                </a>
                <a
                  href={`https://${company.website}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 rounded-lg bg-muted hover:bg-muted/80 border border-border px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                  title={company.website}
                >
                  <Globe className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline truncate max-w-[120px]">{company.website}</span>
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
