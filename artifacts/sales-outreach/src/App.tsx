import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { Layout } from "@/components/layout";

import Dashboard from "@/pages/dashboard";
import BusinessesList from "@/pages/businesses/index";
import BusinessDetail from "@/pages/businesses/detail";
import NewBusiness from "@/pages/businesses/new";
import VisitsList from "@/pages/visits/index";
import VisitDetail from "@/pages/visits/detail";
import NewVisit from "@/pages/visits/new";

const queryClient = new QueryClient();

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        
        <Route path="/businesses" component={BusinessesList} />
        <Route path="/businesses/new" component={NewBusiness} />
        <Route path="/businesses/:id" component={BusinessDetail} />
        
        <Route path="/visits" component={VisitsList} />
        <Route path="/visits/new" component={NewVisit} />
        <Route path="/visits/:id" component={VisitDetail} />
        
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
