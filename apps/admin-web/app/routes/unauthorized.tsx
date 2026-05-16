import { Link } from "react-router";
import { ShieldOff } from "lucide-react";
import { Button } from "~/components/ui/button";

export function meta() {
  return [{ title: "Unauthorized | GDGoC Admin" }];
}

export default function UnauthorizedPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--canvas)]">
      <div className="w-full max-w-sm px-4 text-center">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-destructive/10 mb-6">
          <ShieldOff className="w-7 h-7 text-destructive" />
        </div>
        <h1 className="text-2xl font-semibold text-foreground mb-2">Access Denied</h1>
        <p className="text-sm text-muted-foreground mb-8">
          Your account does not have permission to access this application.
          Contact your chapter administrator to request access.
        </p>
        <Button asChild variant="outline" size="sm">
          <Link to="/auth/logout" reloadDocument={false}>
            Sign out
          </Link>
        </Button>
      </div>
    </div>
  );
}
