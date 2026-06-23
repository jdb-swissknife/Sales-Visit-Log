import { Switch, Route, Redirect, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Show, SignIn, SignUp, useAuth, UserButton } from "@clerk/react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import NotFound from "@/pages/not-found";
import { Layout } from "@/components/layout";

import Dashboard from "@/pages/dashboard";
import MapPage from "@/pages/map/index";
import BusinessesList from "@/pages/businesses/index";
import BusinessDetail from "@/pages/businesses/detail";
import NewBusiness from "@/pages/businesses/new";
import VisitsList from "@/pages/visits/index";
import VisitDetail from "@/pages/visits/detail";
import NewVisit from "@/pages/visits/new";
import RoutesPage from "@/pages/routes/index";
import ScriptPage from "@/pages/script/index";
import ColdCallPage from "@/pages/coldcall/index";

const queryClient = new QueryClient();

/** Wire Clerk's session token into the API client's auth header. */
function AuthTokenBridge() {
  const { getToken } = useAuth();
  setAuthTokenGetter(async () => {
    const token = await getToken();
    return token ?? null;
  });
  return null;
}

function AuthenticatedApp() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={MapPage} />
        <Route path="/dashboard" component={Dashboard} />

        <Route path="/businesses" component={BusinessesList} />
        <Route path="/businesses/new" component={NewBusiness} />
        <Route path="/businesses/:id" component={BusinessDetail} />

        <Route path="/visits" component={VisitsList} />
        <Route path="/visits/new" component={NewVisit} />
        <Route path="/visits/:id" component={VisitDetail} />

        <Route path="/routes" component={RoutesPage} />
        <Route path="/script" component={ScriptPage} />
        <Route path="/coldcall" component={ColdCallPage} />

        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function Router() {
  return (
    <>
      <AuthTokenBridge />
      <Show when="signed-out">
        <Switch>
          <Route path="/sign-in">
            <div className="flex min-h-screen items-center justify-center bg-background p-4">
              <SignIn routing="path" path="/sign-in" />
            </div>
          </Route>
          <Route path="/sign-up">
            <div className="flex min-h-screen items-center justify-center bg-background p-4">
              <SignUp routing="path" path="/sign-up" />
            </div>
          </Route>
          <Route>
            <Redirect to="/sign-in" />
          </Route>
        </Switch>
      </Show>
      <Show when="signed-in">
        <AuthenticatedApp />
      </Show>
    </>
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
