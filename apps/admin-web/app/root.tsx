import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
} from "react-router";
import { useEffect } from "react";
import type { Route } from "./+types/root";
import "./app.css";

export const meta: Route.MetaFunction = () => [
  { title: "GDGoC Admin" },
];

export const links: Route.LinksFunction = () => [
  { rel: "icon", type: "image/svg+xml", href: "/logo.svg" },
];

type ThemeMode = "light" | "dark";

function parseThemeCookie(cookieStr: string): ThemeMode {
  const match = cookieStr.match(/(?:^|;\s*)theme=(dark|light)(?:;|$)/);
  return match?.[1] === "dark" ? "dark" : "light";
}

export async function clientLoader() {
  return {
    theme: parseThemeCookie(document.cookie),
  };
}

// Layout is the static document shell — must have no data dependencies
// to avoid hydration mismatches in SPA mode (ssr: false).
export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body className="h-full">
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  const { theme } = useLoaderData<typeof clientLoader>();

  useEffect(() => {
    const html = document.documentElement;
    if (theme === "dark") {
      html.classList.add("dark");
    } else {
      html.classList.remove("dark");
    }
  }, [theme]);

  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let status = 0;
  let message = "Something went wrong";
  let details = "An unexpected error occurred.";

  if (isRouteErrorResponse(error)) {
    status = error.status;
    if (status === 404) {
      message = "Page not found";
      details = "The page you're looking for doesn't exist.";
    } else if (status === 401) {
      message = "Not authenticated";
      details = "You need to sign in to access this page.";
    } else if (status === 403) {
      message = "Access denied";
      details = "You don't have permission to view this page.";
    } else {
      details = error.statusText || details;
    }
  } else if (error instanceof Error) {
    details = error.message;
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8 bg-canvas">
      <div className="text-center max-w-md">
        {status > 0 && (
          <p className="text-6xl font-bold text-border mb-4">{status}</p>
        )}
        <h1 className="text-2xl font-semibold text-text-1">{message}</h1>
        <p className="mt-2 text-text-2">{details}</p>
        <a
          href="/"
          className="mt-6 inline-block px-4 py-2 bg-g-blue text-white text-sm rounded-lg hover:bg-g-blue-hover"
        >
          Go home
        </a>
      </div>
    </main>
  );
}
