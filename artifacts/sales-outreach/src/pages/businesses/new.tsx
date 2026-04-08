import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useCreateBusiness } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft } from "lucide-react";
import { Link } from "wouter";

const formSchema = z.object({
  name: z.string().min(2, "Name is required"),
  sector: z.string().min(2, "Sector is required"),
  address: z.string().optional(),
  phone: z.string().optional(),
  priority: z.enum(["high", "medium", "low"]).default("medium"),
  status: z.enum(["not_contacted", "contacted", "follow_up", "converted", "not_interested"]).default("not_contacted"),
  notes: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

export default function NewBusiness() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const createBusiness = useCreateBusiness();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      sector: "",
      address: "",
      phone: "",
      priority: "medium",
      status: "not_contacted",
      notes: "",
    },
  });

  function onSubmit(data: FormValues) {
    createBusiness.mutate(
      { data },
      {
        onSuccess: (business) => {
          toast({ title: "Business created successfully" });
          setLocation(`/businesses/${business.id}`);
        },
        onError: () => {
          toast({ title: "Error creating business", variant: "destructive" });
        },
      }
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
        <Link href="/businesses" className="hover:text-foreground flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" /> Back to Directory
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Add New Business</CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Business Name *</FormLabel>
                      <FormControl>
                        <Input placeholder="Acme Roofing" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="sector"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Sector *</FormLabel>
                      <FormControl>
                        <Input placeholder="Roofing, HVAC, etc." {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Phone Number</FormLabel>
                      <FormControl>
                        <Input placeholder="(555) 123-4567" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="priority"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Priority</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select priority" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="high">High</SelectItem>
                          <SelectItem value="medium">Medium</SelectItem>
                          <SelectItem value="low">Low</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="address"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Full Address</FormLabel>
                    <FormControl>
                      <Input placeholder="123 Main St, City, ST 12345" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Initial Notes</FormLabel>
                    <FormControl>
                      <Textarea 
                        placeholder="Any context before visiting?" 
                        className="min-h-[100px]"
                        {...field} 
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="pt-4 flex justify-end">
                <Button type="submit" disabled={createBusiness.isPending}>
                  {createBusiness.isPending ? "Saving..." : "Save Business"}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
