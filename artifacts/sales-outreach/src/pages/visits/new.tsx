import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useState } from "react";
import { useCreateVisit, useUploadMedia, useListBusinesses, getListBusinessesQueryKey } from "@workspace/api-client-react";
import { useLocation, useSearch } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, CalendarIcon, Mic } from "lucide-react";
import { Link } from "wouter";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { VoiceRecorder } from "@/components/voice-recorder";

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
  const uploadMedia = useUploadMedia();
  const businessesParams = { callType: "walk_in" as const };
  const { data: businesses } = useListBusinesses(businessesParams, { query: { queryKey: getListBusinessesQueryKey(businessesParams) } });
  const [voiceNote, setVoiceNote] = useState<{ blob: Blob; durationSec: number; mimeType: string } | null>(null);
  const [isSaving, setIsSaving] = useState(false);

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

  async function onSubmit(data: FormValues) {
    setIsSaving(true);
    try {
      const visit = await createVisit.mutateAsync({
        data: {
          ...data,
          visitedAt: data.visitedAt.toISOString(),
          nextActionDate: data.nextActionDate?.toISOString(),
        },
      });

      if (voiceNote) {
        const ext = voiceNote.mimeType.includes("mp4") ? "m4a"
          : voiceNote.mimeType.includes("ogg") ? "ogg"
          : "webm";
        const filename = `voice-note-${Date.now()}.${ext}`;
        const file = new File([voiceNote.blob], filename, { type: voiceNote.mimeType });
        try {
          await uploadMedia.mutateAsync({
            params: { id: visit.id },
            data: { file, type: "voice_note" },
          });
          toast({ title: "Visit logged with voice note" });
        } catch {
          toast({
            title: "Visit saved, but voice note upload failed",
            description: "You can re-upload it from the visit detail page.",
            variant: "destructive",
          });
        }
      } else {
        toast({ title: "Visit logged successfully" });
      }

      setLocation(`/visits/${visit.id}`);
    } catch {
      toast({ title: "Error logging visit", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
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

              <div className="border-t border-border pt-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Mic className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-semibold">Voice Note <span className="text-muted-foreground font-normal">(Optional)</span></h3>
                </div>
                <p className="text-xs text-muted-foreground">
                  Capture a hands-free note while everything is fresh. Saved automatically with this visit.
                </p>
                <VoiceRecorder onChange={setVoiceNote} />
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
                <Button type="submit" disabled={isSaving}>
                  {isSaving ? "Saving..." : voiceNote ? "Log Visit + Voice Note" : "Log Visit"}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
