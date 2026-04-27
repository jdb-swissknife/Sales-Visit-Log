import { useState } from "react";
import { useListBusinesses, getListBusinessesQueryKey } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { Search, Plus, MapPin, Phone, Star } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const STATUS_COLORS: Record<string, string> = {
  not_contacted: "bg-muted text-muted-foreground",
  contacted: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  follow_up: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300",
  converted: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  not_interested: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
};

const DAY_FILTER_OPTIONS = [
  { label: "All", value: "all" },
  { label: "Day 1", value: "1" },
  { label: "Day 2", value: "2" },
  { label: "Day 3", value: "3" },
  { label: "Day 4", value: "4" },
  { label: "Bonus", value: "bonus" },
];

export default function BusinessesList() {
  const [search, setSearch] = useState("");
  const [dayFilter, setDayFilter] = useState<string>("all");
  const params = { callType: "walk_in" as const };
  const { data: businesses, isLoading } = useListBusinesses(params, { query: { queryKey: getListBusinessesQueryKey(params) } });

  const filtered = businesses?.filter((b) => {
    const matchesSearch =
      b.name.toLowerCase().includes(search.toLowerCase()) ||
      b.sector.toLowerCase().includes(search.toLowerCase());
    if (!matchesSearch) return false;

    if (dayFilter === "all") return true;
    if (dayFilter === "bonus") return b.isBonus === true;
    return b.routeDay === Number(dayFilter);
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Directory</h1>
          <p className="text-sm text-muted-foreground">Manage your prospect businesses.</p>
        </div>
        <Link href="/businesses/new">
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Add Business
          </Button>
        </Link>
      </div>

      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Search by name or sector..." 
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {DAY_FILTER_OPTIONS.map((option) => (
            <button
              key={option.value}
              onClick={() => setDayFilter(option.value)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                dayFilter === option.value
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground border-border hover:border-foreground hover:text-foreground"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse h-32" />
          ))}
        </div>
      ) : filtered?.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground bg-muted/30 rounded-lg border border-dashed border-border">
          No businesses found.
        </div>
      ) : (
        <div className="space-y-3">
          {filtered?.map((business) => (
            <Link key={business.id} href={`/businesses/${business.id}`}>
              <Card className="hover:bg-muted/50 transition-colors cursor-pointer">
                <CardContent className="p-4 sm:p-5 flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-lg">{business.name}</h3>
                      <Badge variant="outline" className="capitalize text-[10px]">
                        {business.sector}
                      </Badge>
                      {business.priority === 'high' && (
                        <Star className="h-4 w-4 text-red-500 fill-red-500" />
                      )}
                    </div>
                    
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                      {business.address && (
                        <div className="flex items-center gap-1">
                          <MapPin className="h-3.5 w-3.5" />
                          <span className="truncate max-w-[200px]">{business.address}</span>
                        </div>
                      )}
                      {business.phone && (
                        <div className="flex items-center gap-1">
                          <Phone className="h-3.5 w-3.5" />
                          <span>{business.phone}</span>
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex sm:flex-col items-center sm:items-end gap-2 w-full sm:w-auto justify-between sm:justify-center">
                    <Badge className={`capitalize shadow-none ${STATUS_COLORS[business.status] || ""}`} variant="secondary">
                      {business.status.replace(/_/g, " ")}
                    </Badge>
                    <Link href={`/visits/new?businessId=${business.id}`} onClick={(e) => e.stopPropagation()}>
                      <Button variant="outline" size="sm" className="h-8">
                        Log Visit
                      </Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
