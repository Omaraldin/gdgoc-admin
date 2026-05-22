import { Outlet, redirect, useLoaderData, NavLink, Form } from "react-router";
import { useEffect, useState } from "react";
import { Menu, X, LayoutDashboard, FileText, Globe, Package, Mail, Building2, Settings, Users, ShieldCheck, LogOut, ChevronRight, ImagePlay, Code2, Type, Award, BookOpen } from "lucide-react";
import type { Route } from "./+types/admin-layout";
import { getMe } from "~/lib/api/auth";
import { ROLE_LABELS, isSuperAdminRole, isChapterLeaderRole } from "~/lib/roles";
import type { User } from "~/lib/types";
import { Button } from "~/components/ui/button";
import { Separator } from "~/components/ui/separator";
import { cn } from "~/lib/utils";

// Only re-fetch /me when the layout itself is first mounted.
// Navigating between child routes must not spam /me.
export function shouldRevalidate() {
  return false;
}

export async function clientLoader(): Promise<{ user: User }> {
  try {
    const user = await getMe();
    // Non-admin users without a chapter must create/join one first.
    // Super admins are not scoped to a chapter — they manage all.
    const needsChapter =
      !user.chapter_id &&
      isChapterLeaderRole(user.role) &&
      typeof window !== "undefined" &&
      window.location.pathname !== "/unauthorized";
    if (needsChapter) {
      throw redirect("/unauthorized");
    }
    return { user };
  } catch (e) {
    // Re-throw redirects as-is.
    if (e instanceof Response) throw e;
    // 403 = authenticated but not authorized → dedicated page (avoids login loop).
    const status = (e as { response?: { status?: number } })?.response?.status;
    if (status === 403) throw redirect("/unauthorized");
    // Any other error (401, network) → login.
    throw redirect("/auth/login");
  }
}

export default function AdminLayout() {
  const { user } = useLoaderData<typeof clientLoader>();
  const isSuperAdmin = isSuperAdminRole(user.role);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const close = () => setSidebarOpen(false);

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Brand header */}
      <div className="flex items-center justify-between px-4 h-14 border-b border-[var(--border-c)] flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <img src="/logo.svg" alt="GDGoC" className="w-7 h-7 flex-shrink-0" />
          <span className="text-sm font-semibold text-foreground">GDGoC Admin</span>
        </div>
        <ThemeToggle />
      </div>

      {/* User info */}
      <div className="px-4 py-3 border-b border-[var(--border-c)]">
        <p className="text-sm font-medium truncate text-foreground">{user.name}</p>
        <span className="inline-block mt-1 text-xs bg-accent text-accent-foreground px-2 py-0.5 rounded-full font-medium capitalize">
          {ROLE_LABELS[user.role]}
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
        <NavSection>
          <NavItem to="/dashboard" label="Dashboard" icon={LayoutDashboard} onClick={close} />
          <NavItem to="/templates" label="Templates" icon={FileText} onClick={close} />
          <NavItem to="/templates/public" label="Public Templates" icon={Globe} onClick={close} />
          <NavItem to="/dynamic-images" label="Dynamic Images" icon={ImagePlay} onClick={close} />
          <NavItem to="/fonts" label="Font Library" icon={Type} onClick={close} />
          <NavItem to="/batches" label="Issuance Batches" icon={Package} onClick={close} />
          <NavItem to="/certifications" label="Certifications" icon={Award} onClick={close} />
          {user.chapter_id && (
            <NavItem to="/cert-metadata" label="Cert Programmes" icon={BookOpen} onClick={close} />
          )}
          <NavItem to="/functions" label="Defined Functions" icon={Code2} onClick={close} />
          <NavItem to="/mail" label="Email" icon={Mail} onClick={close} />
          {isSuperAdmin && (
            <NavItem to="/chapters" label="Chapters" icon={Building2} onClick={close} />
          )}
          {isChapterLeaderRole(user.role) && user.chapter_id && (
            <NavItem to={`/chapters/${user.chapter_id}`} label="Chapter Settings" icon={Settings} onClick={close} />
          )}
        </NavSection>

        {isSuperAdmin && (
          <>
            <div className="px-3 pt-4 pb-1">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
                Super Admin
              </p>
            </div>
            <NavSection>
              <NavItem to="/users" label="Users" icon={Users} onClick={close} />
              <NavItem to="/whitelist" label="Whitelist" icon={ShieldCheck} onClick={close} />
            </NavSection>
          </>
        )}
        {isChapterLeaderRole(user.role) && user.chapter_id && (
          <>
            <div className="px-3 pt-4 pb-1">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
                Chapter
              </p>
            </div>
            <NavSection>
              <NavItem to="/users" label="Members" icon={Users} onClick={close} />
              <NavItem to="/whitelist" label="Whitelist" icon={ShieldCheck} onClick={close} />
            </NavSection>
          </>
        )}
      </nav>

      {/* Footer */}
      <div className="px-2 py-2 border-t border-[var(--border-c)]">
        <p className="px-3 pb-2 text-[11px] text-muted-foreground text-center leading-relaxed">
          Made with{" "}
          <span className="text-red-500" aria-label="love">❤</span>
          {" "}by{" "}
          <a
            href="https://linkedin.com/in/omaraldin"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-foreground hover:text-primary transition-colors underline underline-offset-2 decoration-dotted"
          >
            Omar El. Khashab
          </a>
        </p>
        <Form action="/auth/logout" method="post">
          <button
            type="submit"
            className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-[var(--canvas)] transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        </Form>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--canvas)]">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/40 md:hidden"
          onClick={close}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 w-60 bg-card border-r border-[var(--border-c)] transition-transform duration-200",
          "md:static md:translate-x-0 md:flex-shrink-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <SidebarContent />
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile top bar */}
        <header className="flex items-center gap-3 px-4 h-14 border-b border-[var(--border-c)] bg-card md:hidden flex-shrink-0">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5" />
          </Button>
          <span className="font-semibold text-primary text-sm">GDGoC Admin</span>
        </header>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto">
          <Outlet context={{ user }} />
        </main>
      </div>
    </div>
  );
}

function NavSection({ children }: { children: React.ReactNode }) {
  return <div className="space-y-0.5">{children}</div>;
}

function NavItem({
  to,
  label,
  icon: Icon,
  onClick,
}: {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick?: () => void;
}) {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
          isActive
            ? "bg-accent text-accent-foreground"
            : "text-muted-foreground hover:bg-[var(--canvas)] hover:text-foreground"
        )
      }
    >
      <Icon className="w-4 h-4 flex-shrink-0" />
      {label}
    </NavLink>
  );
}

function ThemeToggle() {
  const [isDark, setIsDark] = useState(
    () => typeof document !== "undefined" && document.documentElement.classList.contains("dark"),
  );

  const getThemeCookie = (): "dark" | "light" | null => {
    if (typeof document === "undefined") return null;
    const match = document.cookie.match(/(?:^|;\s*)theme=(dark|light)(?:;|$)/);
    return match?.[1] === "dark" || match?.[1] === "light" ? match[1] : null;
  };

  const setThemeCookie = (theme: "dark" | "light") => {
    if (typeof document === "undefined") return;
    document.cookie = `theme=${theme}; Path=/; Max-Age=31536000; SameSite=Lax`;
  };

  // Migration helper: if older sessions only have localStorage theme, seed the cookie once.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const cookieTheme = getThemeCookie();
    if (cookieTheme) return;

    const storedTheme = localStorage.getItem("theme");
    if (storedTheme !== "dark" && storedTheme !== "light") return;

    setThemeCookie(storedTheme);
    document.documentElement.classList.toggle("dark", storedTheme === "dark");
    setIsDark(storedTheme === "dark");
  }, []);

  const toggle = () => {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle("dark", next);
    const theme = next ? "dark" : "light";
    localStorage.setItem("theme", theme);
    setThemeCookie(theme);
  };

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={toggle}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {isDark ? (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <circle cx="12" cy="12" r="4" />
          <path strokeLinecap="round" d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      ) : (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
        </svg>
      )}
    </Button>
  );
}
