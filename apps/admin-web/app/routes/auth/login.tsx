import { useState } from "react";
import { loginUrl } from "~/lib/api/auth";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";

export function meta() {
  return [{ title: "Sign In | GDGoC Admin" }];
}

export default function LoginPage() {
  const [loading, setLoading] = useState(false);

  const handleLogin = () => {
    setLoading(true);
    window.location.href = loginUrl();
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--canvas)]">
      <div className="w-full max-w-sm px-4">
        {/* Logo / branding */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center mb-4">
            <img src="/logo.svg" alt="GDGoC" className="w-14 h-14" />
          </div>
          <h1 className="text-2xl font-semibold text-foreground">GDGoC Admin</h1>
          <p className="text-sm text-muted-foreground mt-1">Sign in to manage your chapter</p>
        </div>

        {/* Sign-in card */}
        <Card>
          <CardContent className="p-8">
            <Button
              variant="outline"
              className="w-full h-10 gap-3 text-foreground"
              onClick={handleLogin}
              disabled={loading}
            >
              {loading ? (
                <svg className="w-4 h-4 animate-spin text-muted-foreground" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
              ) : (
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
              )}
              {loading ? "Redirecting…" : "Sign in with Google"}
            </Button>

            <p className="text-xs text-center text-muted-foreground mt-5">
              Access is restricted to whitelisted accounts only.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
