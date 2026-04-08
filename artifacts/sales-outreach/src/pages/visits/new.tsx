import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useCreateVisit, useListBusinesses, getListBusinessesQueryKey } from "@workspace/api-client-react";
import { useLocation, useSearch } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, CalendarIcon } from "lucide-react";
import { Link } from "wouter";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

const formSchema = z.object({
  businessId: z.coerce.number().min(1, "Business is required"),
  visitedAt: z.date({
    required_error: "A date is required.",
  }),
  outcome: z.enum(["positive", "neutral", "negative", "follow_up_needed"]),
  contactName: z.string().optional(),
  contactPhone: z.string().optional(),
  nextActionDate: z.date().optional(),
});

type FormValues = z.infer<typeof formSchema>;

export default function NewVisit() {
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const searchParams = new URLSearchParams(searchString);
  const initialBusinessId = searchParams.get("businessId");

  const { toast } = useToast();
  const createVisit = useCreateVisit();
  const { data: businesses } = useListBusinesses({ query: { queryKey: getListBusinessesQueryKey() } });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      businessId: initialBusinessId ? Number(initialBusinessId) : undefined,
      visitedAt: new Date(),
      outcome: "neutral",
      contactName: "",
      contactPhone: "",
    },
  });

  function onSubmit(data: FormValues) {
    createVisit.mutate(
      { 
        data: {
          ...data,
          visitedAt: data.visitedAt.toISOString(),
          nextActionDate: data.nextActionDate?.toISOString()
        } 
      },
      {
        onSuccess: (visit) => {
          toast({ title: "Visit logged successfully" });
          setLocation(`/visits/${visit.id}`);
        },
        onError: () => {
          toast({ title: "Error logging visit", variant: "destructive" });
        },
      }
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
        <Link href="/visits" className="hover:text-foreground flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" /> Back to Field Notes
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Log Visit</CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              
              <FormField
                control={form.control}
                name="businessId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Business *</FormLabel>
                    <Select 
                      onValueChange={(val) => field.onChange(Number(val))} 
                      defaultValue={field.value?.toString()}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select business" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {businesses?.map(b => (
                          <SelectItem key={b.id} value={b.id.toString()}>
                            {b.name} - {b.address}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="visitedAt"
                  render={({ field }) => (
                    <FormItem className="flex flex-col pt-2">
                      <FormLabel>Date of Visit *</FormLabel>
                      <Popover>
                        <PopoverTrigger asChild>
                          <FormControl>
                            <Button
                              variant={"outline"}
                              className={cn(
                                "w-full pl-3 text-left font-normal",
                                !field.value && "text-muted-foreground"
                              )}
                            >
                              {field.value ? (
                                format(field.value, "PPP")
                              ) : (
                                <span>Pick a date</span>
                              )}
                              <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                            </Button>
                          </FormControl>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={field.value}
                            onSelect={field.onChange}
                            disabled={(date) =>
                              date > new Date() || date < new Date("1900-01-01")
                            }
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="outcome"
                  render={({ field }) => (
                    <FormItem className="pt-2">
                      <FormLabel>Outcome *</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select outcome" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="positive">Positive / Interested</SelectItem>
                          <SelectItem value="neutral">Neutral / Info Left</SelectItem>
                          <SelectItem value="follow_up_needed">Follow-up Needed</SelectItem>
                          <SelectItem value="negative">Negative / Not Interested</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="border-t border-border pt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="contactName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contact Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Who did you speak with?" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="contactPhone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contact Phone</FormLabel>
                      <FormControl>
                        <Input placeholder="Direct line if provided" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                  control={form.control}
                  name="nextActionDate"
                  render={({ field }) => (
                    <FormItem className="flex flex-col md:w-1/2">
                      <FormLabel>Next Action Date (Optional)</FormLabel>
                      <Popover>
                        <PopoverTrigger asChild>
                          <FormControl>
                            <Button
                              variant={"outline"}
                              className={cn(
                                "w-full pl-3 text-left font-normal",
                                !field.value && "text-muted-foreground"
                              )}
                            >
                              {field.value ? (
                                format(field.value, "PPP")
                              ) : (
                                <span>Pick a date to follow up</span>
                              )}
                              <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                            </Button>
                          </FormControl>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={field.value}
                            onSelect={field.onChange}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                      <FormMessage />
                    </FormItem>
                  )}
                />

              <div className="pt-4 flex justify-end">
                <Button type="submit" disabled={createVisit.isPending}>
                  {createVisit.isPending ? "Saving..." : "Log Visit"}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
