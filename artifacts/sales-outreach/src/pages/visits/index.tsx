import { useListVisits, getListVisitsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MapPin, Calendar, User, ArrowRight } from "lucide-react";
import { Link } from "wouter";
import { format, parseISO } from "date-fns";

const OUTCOME_STYLES: Record<string, string> = {
  positive: "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800",
  neutral: "bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700",
  negative: "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800",
  follow_up_needed: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800",
};

export default function VisitsList() {
  const { data: visits, isLoading } = useListVisits({ query: { queryKey: getListVisitsQueryKey() } });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Field Notes</h1>
        <p className="text-sm text-muted-foreground">Log of all prospecting visits.</p>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="animate-pulse h-24" />
          ))}
        </div>
      ) : visits?.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground bg-muted/30 rounded-lg border border-dashed border-border">
          No visits recorded. Start visiting businesses to build your field notes.
        </div>
      ) : (
        <div className="space-y-3">
          {visits?.map((visit) => (
            <Link key={visit.id} href={`/visits/${visit.id}`}>
              <Card className="hover:border-primary/50 transition-colors cursor-pointer border-l-4" style={{ 
                borderLeftColor: 
                  visit.outcome === 'positive' ? 'hsl(var(--primary))' : 
                  visit.outcome === 'negative' ? 'hsl(var(--destructive))' : 
                  visit.outcome === 'follow_up_needed' ? 'hsl(var(--accent))' : 
                  'hsl(var(--muted-foreground))'
              }}>
                <CardContent className="p-4 flex flex-col sm:flex-row gap-4 justify-between sm:items-center">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-lg">{visit.businessName}</h3>
                      <Badge variant="outline" className={`text-[10px] uppercase border ${OUTCOME_STYLES[visit.outcome]}`}>
                        {visit.outcome.replace(/_/g, " ")}
                      </Badge>
                    </div>
                    
                    <div className="flex flex-wrap text-sm text-muted-foreground gap-4">
                      <div className="flex items-center gap-1">
                        <Calendar className="h-3.5 w-3.5" />
                        <span>{format(parseISO(visit.visitedAt), "MMM d, h:mm a")}</span>
                      </div>
                      {visit.contactName && (
                        <div className="flex items-center gap-1">
                          <User className="h-3.5 w-3.5" />
                          <span>{visit.contactName}</span>
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <div className="flex gap-3">
                      <span>{visit.noteCount} notes</span>
                      <span>{visit.mediaCount} media</span>
                    </div>
                    <ArrowRight className="h-4 w-4 hidden sm:block" />
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
