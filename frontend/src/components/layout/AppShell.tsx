import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  Bell,
  Braces,
  ChevronDown,
  CircleGauge,
  Clock3,
  Command,
  KeyRound,
  Layers3,
  Menu,
  ScrollText,
  Search,
  Settings,
  ShieldCheck,
  Webhook,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";

import { Logo } from "@/components/brand/Logo";
import { CommandPalette } from "@/components/layout/CommandPalette";
import { WorkspaceGate } from "@/components/layout/WorkspaceGate";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatRelative } from "@/lib/format";
import { useAuth } from "@/providers/AuthProvider";
import { useWorkspace } from "@/providers/WorkspaceProvider";
import type { Activity as ActivityEvent } from "@/types";

const sections = [
  {
    label: null,
    links: [{ label: "Overview", path: "/", icon: CircleGauge }],
  },
  {
    label: "Operations",
    links: [
      { label: "Requests", path: "/requests", icon: Braces },
      { label: "Webhooks", path: "/webhooks", icon: Webhook },
      { label: "Jobs", path: "/jobs", icon: Clock3 },
      { label: "Incidents", path: "/incidents", icon: AlertTriangle },
    ],
  },
  {
    label: "Configuration",
    links: [
      { label: "Endpoints", path: "/endpoints", icon: Activity },
      { label: "Environments", path: "/environments", icon: Layers3 },
      { label: "Secrets", path: "/secrets", icon: ShieldCheck },
      { label: "API Keys", path: "/api-keys", icon: KeyRound },
    ],
  },
  {
    label: "System",
    links: [
      { label: "Audit Log", path: "/audit", icon: ScrollText },
      { label: "Settings", path: "/settings", icon: Settings },
    ],
  },
];

function Sidebar({ mobile, onClose }: { mobile?: boolean; onClose?(): void }) {
  const { user, logout } = useAuth();
  const workspace = useWorkspace();
  return (
    <aside
      className={cn(
        "flex h-screen w-[232px] shrink-0 flex-col border-r border-line bg-[#0a0d10]",
        mobile ? "fixed inset-y-0 left-0 z-50 shadow-panel" : "sticky top-0 hidden lg:flex",
      )}
    >
      <div className="flex h-16 items-center justify-between border-b border-line px-4">
        <Logo />
        {mobile && (
          <Button aria-label="Close navigation" onClick={onClose} size="icon" variant="ghost">
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
      <nav className="flex-1 overflow-y-auto px-2.5 py-4">
        {sections.map((section, sectionIndex) => (
          <div className={cn(sectionIndex > 0 && "mt-5")} key={section.label ?? "main"}>
            {section.label && <div className="eyebrow mb-2 px-2">{section.label}</div>}
            <div className="space-y-0.5">
              {section.links.map((link) => {
                const Icon = link.icon;
                return (
                  <NavLink
                    className={({ isActive }) =>
                      cn(
                        "flex h-9 items-center gap-3 rounded-[7px] px-2.5 text-[13px] text-muted hover:bg-white/[0.035] hover:text-ink",
                        isActive && "bg-white/[0.055] text-ink",
                      )
                    }
                    end={link.path === "/"}
                    key={link.path}
                    onClick={onClose}
                    to={link.path}
                  >
                    <Icon className="h-[15px] w-[15px]" />
                    {link.label}
                  </NavLink>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
      <div className="border-t border-line p-2.5">
        <label className="block">
          <span className="sr-only">Organization</span>
          <div className="relative">
            <select
              className="h-10 w-full appearance-none rounded-[7px] border border-transparent bg-transparent px-2.5 pr-7 text-xs font-medium text-[#cbd1d7] hover:border-line hover:bg-raised"
              onChange={(event) => workspace.setOrganizationId(event.target.value)}
              value={workspace.organization?.id ?? ""}
            >
              {workspace.organizations.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-3 h-3.5 w-3.5 text-muted" />
          </div>
        </label>
        <button
          className="mt-1 flex w-full items-center gap-2.5 rounded-[7px] px-2.5 py-2 text-left hover:bg-white/[0.035]"
          onClick={() => void logout()}
          title="Click to sign out"
          type="button"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent/10 text-[11px] font-semibold text-accent">
            {user?.full_name
              .split(" ")
              .map((part) => part[0])
              .join("")
              .slice(0, 2)
              .toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium text-ink">{user?.full_name}</span>
            <span className="block truncate text-[10px] text-muted">{user?.email}</span>
          </span>
        </button>
      </div>
    </aside>
  );
}

function Topbar({ onMenu, onCommand }: { onMenu(): void; onCommand(): void }) {
  const workspace = useWorkspace();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const activity = useQuery({
    queryKey: ["activity", workspace.project?.id],
    queryFn: () =>
      api.get<ActivityEvent[]>(
        `/activity?project_id=${workspace.project?.id}`,
        workspace.headers,
      ),
    enabled: Boolean(workspace.project),
  });
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b border-line bg-canvas/90 px-3 backdrop-blur-md sm:px-5">
      <Button aria-label="Open navigation" className="lg:hidden" onClick={onMenu} size="icon" variant="ghost">
        <Menu className="h-4 w-4" />
      </Button>
      <div className="flex min-w-0 items-center gap-1">
        <div className="relative hidden sm:block">
          <select
            aria-label="Project"
            className="h-8 max-w-[180px] appearance-none rounded-[6px] border border-transparent bg-transparent py-0 pl-2 pr-7 text-xs font-medium text-[#d7dce1] hover:border-line hover:bg-raised"
            onChange={(event) => workspace.setProjectId(event.target.value)}
            value={workspace.project?.id ?? ""}
          >
            {workspace.projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-2.5 h-3 w-3 text-muted" />
        </div>
        <span className="hidden text-muted/40 sm:block">/</span>
        <div className="relative">
          <select
            aria-label="Environment"
            className="h-8 max-w-[150px] appearance-none rounded-[6px] border border-transparent bg-transparent py-0 pl-6 pr-7 text-xs text-muted hover:border-line hover:bg-raised hover:text-ink"
            onChange={(event) => workspace.setEnvironmentId(event.target.value)}
            value={workspace.environment?.id ?? ""}
          >
            {workspace.environments.map((environment) => (
              <option key={environment.id} value={environment.id}>
                {environment.name}
              </option>
            ))}
          </select>
          <span className="pointer-events-none absolute left-2 top-[13px] h-1.5 w-1.5 rounded-full bg-accent" />
          <ChevronDown className="pointer-events-none absolute right-2 top-2.5 h-3 w-3 text-muted" />
        </div>
      </div>
      <div className="ml-auto flex items-center gap-1.5">
        <button
          className="hidden h-8 min-w-[11rem] items-center gap-2 rounded-[7px] border border-line bg-surface px-2.5 text-xs text-muted hover:border-[#39414b] hover:text-ink md:flex"
          onClick={onCommand}
          type="button"
        >
          <Search className="h-3.5 w-3.5" />
          <span>Search commands</span>
          <kbd className="ml-auto rounded border border-line px-1 py-0.5 font-mono text-[9px]">⌘ K</kbd>
        </button>
        <Button aria-label="Open command palette" className="md:hidden" onClick={onCommand} size="icon" variant="ghost">
          <Command className="h-4 w-4" />
        </Button>
        <div className="relative">
          <Button
            aria-expanded={notificationsOpen}
            aria-label="Notifications"
            onClick={() => setNotificationsOpen((value) => !value)}
            size="icon"
            variant="ghost"
          >
            <Bell className="h-4 w-4" />
          </Button>
          {notificationsOpen && (
            <div className="absolute right-0 top-10 z-50 w-[320px] overflow-hidden rounded-[9px] border border-line bg-raised shadow-panel">
              <div className="flex h-11 items-center justify-between border-b border-line px-3.5">
                <span className="text-xs font-medium text-[#d7dde2]">Recent activity</span>
                <Link
                  className="text-[10px] text-accent hover:text-[#82ebbe]"
                  onClick={() => setNotificationsOpen(false)}
                  to="/audit"
                >
                  Open audit log
                </Link>
              </div>
              {activity.data?.length ? (
                activity.data.slice(0, 6).map((item) => (
                  <div className="data-row flex gap-3 px-3.5 py-3" key={item.id}>
                    <span
                      className={cn(
                        "mt-1 h-1.5 w-1.5 shrink-0 rounded-full",
                        item.status === "error"
                          ? "bg-danger"
                          : item.status === "warning"
                            ? "bg-warning"
                            : "bg-accent",
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[11px] text-[#d2d8de]">{item.title}</div>
                      <div className="mt-1 text-[9px] text-muted">{formatRelative(item.created_at)}</div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="px-4 py-8 text-center text-xs text-muted">No recent activity</div>
              )}
            </div>
          )}
        </div>
        {workspace.organization && (
          <Badge className="hidden sm:inline-flex" tone="neutral">
            {workspace.organization.role}
          </Badge>
        )}
      </div>
    </header>
  );
}

export function AppShell() {
  const [mobileNav, setMobileNav] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);
  useEffect(() => setMobileNav(false), [location.pathname]);

  return (
    <div className="min-h-screen lg:flex">
      <Sidebar />
      {mobileNav && (
        <>
          <button
            aria-label="Close navigation"
            className="fixed inset-0 z-40 bg-black/70 lg:hidden"
            onClick={() => setMobileNav(false)}
          />
          <Sidebar mobile onClose={() => setMobileNav(false)} />
        </>
      )}
      <div className="min-w-0 flex-1">
        <Topbar onCommand={() => setCommandOpen(true)} onMenu={() => setMobileNav(true)} />
        <main>
          <WorkspaceGate>
            <Outlet />
          </WorkspaceGate>
        </main>
      </div>
      <CommandPalette open={commandOpen} onClose={() => setCommandOpen(false)} />
    </div>
  );
}
