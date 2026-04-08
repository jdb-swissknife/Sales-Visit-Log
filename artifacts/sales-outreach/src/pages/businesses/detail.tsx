import { useGetBusiness, useListVisitsForBusiness, getGetBusinessQueryKey, getListVisitsForBusinessQueryKey } from "@workspace/api-client-react";
import { Link, useParams } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MapPin, Phone, Star, Map, Plus, Clock, FileText, ArrowLeft } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { format, parseISO } from "date-fns";

const STATUS_COLORS: Record<string, string> = {
  not_contacted: "bg-muted text-muted-foreground",
  contacted: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  follow_up: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300",
  converted: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  not_interested: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
};

export default function BusinessDetail() {
  const params = useParams();
  const id = Number(params.id);

  const { data: business, isLoading: businessLoading } = useGetBusiness(id, { 
    query: { enabled: !!id, queryKey: getGetBusinessQueryKey(id) } 
  });

  const { data: visits, isLoading: visitsLoading } = useListVisitsForBusiness(id, {
    query: { enabled: !!id, queryKey: getListVisitsForBusinessQueryKey(id) }
  });

  if (businessLoading) {
    return <div className="animate-pulse space-y-6">
      <div className="h-8 w-1/3 bg-muted rounded"></div>
      <div className="h-48 bg-muted rounded"></div>
    </div>;
  }

  if (!business) {
    return <div>Business not found.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
        <Link href="/businesses" className="hover:text-foreground flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" /> Back to Directory
        </Link>
      </div>

      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-3xl font-bold tracking-tight">{business.name}</h1>
            <Badge variant="outline" className="capitalize">{business.sector}</Badge>
            {business.priority === 'high' && <Star className="h-5 w-5 text-red-500 fill-red-500" />}
          </div>
          <Badge className={`capitalize shadow-none ${STATUS_COLORS[business.status] || ""}`} variant="secondary">
            {business.status.replace(/_/g, " ")}
          </Badge>
        </div>
        
        <Link href={`/visits/new?businessId=${business.id}`}>
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Log Visit
          </Button>
        </Link>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        <Card className="md:col-span-1 border-primary/10 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {business.address && (
              <div className="flex items-start gap-3 text-sm">
                <MapPin className="h-4 w-4 mt-0.5 text-primary" />
                <span>{business.address}</span>
              </div>
            )}
            {business.phone && (
              <div className="flex items-start gap-3 text-sm">
                <Phone className="h-4 w-4 mt-0.5 text-primary" />
                <a href={`tel:${business.phone}`} className="hover:underline text-primary">{business.phone}</a>
              </div>
            )}
            {business.mapsUrl && (
              <div className="flex items-start gap-3 text-sm">
                <Map className="h-4 w-4 mt-0.5 text-primary" />
                <a href={business.mapsUrl} target="_blank" rel="noreferrer" className="hover:underline text-primary truncate">
                  View on Maps
                </a>
              </div>
            )}
            {(business.rating || business.reviewCount) && (
              <div className="flex items-start gap-3 text-sm">
                <Star className="h-4 w-4 mt-0.5 text-primary" />
                <span>
                  {business.rating ? `${business.rating} stars` : 'No rating'} 
                  {business.reviewCount ? ` (${business.reviewCount} reviews)` : ''}
                </span>
              </div>
            )}
            
            {business.notes && (
              <div className="pt-4 mt-4 border-t border-border">
                <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-2">Internal Notes</h4>
                <p className="text-sm whitespace-pre-wrap">{business.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="md:col-span-2 space-y-4">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Clock className="h-5 w-5" /> Visit History
          </h3>
          
          {visitsLoading ? (
            <div className="animate-pulse space-y-3">
              <div className="h-20 bg-muted rounded"></div>
              <div className="h-20 bg-muted rounded"></div>
            </div>
          ) : visits?.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground bg-muted/30 rounded-lg border border-dashed border-border">
              No visits recorded yet.
            </div>
          ) : (
            <div className="space-y-3">
              {visits?.map((visit) => (
                <Link key={visit.id} href={`/visits/${visit.id}`}>
                  <Card className="hover:border-primary/50 transition-colors cursor-pointer">
                    <CardContent className="p-4 flex justify-between items-center">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">
                            {format(parseISO(visit.visitedAt), "MMM d, yyyy")}
                          </span>
                          <Badge variant={
                            visit.outcome === 'positive' ? 'default' :
                            visit.outcome === 'negative' ? 'destructive' :
                            visit.outcome === 'follow_up_needed' ? 'outline' : 'secondary'
                          } className="text-[10px] uppercase">
                            {visit.outcome.replace(/_/g, " ")}
                          </Badge>
                        </div>
                        {visit.contactName && (
                          <div className="text-sm text-muted-foreground">
                            Spoke with: {visit.contactName}
                          </div>
                        )}
                      </div>
                      
                      <div className="flex gap-3 text-muted-foreground">
                        <div className="flex items-center gap-1 text-xs" title="Notes">
                          <FileText className="h-3.5 w-3.5" />
                          <span>{visit.noteCount}</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
