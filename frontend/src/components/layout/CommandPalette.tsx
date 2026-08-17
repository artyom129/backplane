import {
  Activity,
  AlertTriangle,
  Box,
  Braces,
  Clock3,
  Command,
  KeyRound,
  Plus,
  Search,
  Webhook,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { cn } from "@/lib/cn";

const commands = [
  { label: "Go to Overview", group: "Navigation", path: "/", icon: Activity },
  { label: "Go to Requests", group: "Navigation", path: "/requests", icon: Braces },
  { label: "Go to Webhooks", group: "Navigation", path: "/webhooks", icon: Webhook },
  { label: "Go to Jobs", group: "Navigation", path: "/jobs", icon: Clock3 },
  { label: "Go to Incidents", group: "Navigation", path: "/incidents", icon: AlertTriangle },
  { label: "Create Endpoint", group: "Create", path: "/endpoints?new=1", icon: Plus },
  { label: "Create Webhook", group: "Create", path: "/webhooks?new=1", icon: Plus },
  { label: "Create Secret", group: "Create", path: "/secrets?new=1", icon: KeyRound },
  { label: "Search Requests", group: "Search", path: "/requests?focus=search", icon: Search },
  { label: "Search Events", group: "Search", path: "/webhooks?focus=search", icon: Search },
  { label: "Open API Registry", group: "Configuration", path: "/endpoints", icon: Box },
];

export function CommandPalette({ open, onClose }: { open: boolean; onClose(): void }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const results = useMemo(
    () => commands.filter((command) => command.label.toLowerCase().includes(query.toLowerCase())),
    [query],
  );

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelected(0);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  const run = (path: string) => {
    navigate(path);
    onClose();
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex justify-center px-4 pt-[12vh]">
      <button
        aria-label="Close command palette"
        className="absolute inset-0 cursor-default bg-black/65 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        aria-label="Command palette"
        aria-modal="true"
        className="relative z-10 h-fit w-full max-w-xl overflow-hidden rounded-[11px] border border-[#303741] bg-[#101419] shadow-panel"
        role="dialog"
      >
        <div className="flex h-14 items-center gap-3 border-b border-line px-4">
          <Command className="h-4 w-4 text-accent" />
          <input
            aria-label="Search commands"
            className="min-w-0 flex-1 bg-transparent text-sm text-ink placeholder:text-muted"
            onChange={(event) => {
              setQuery(event.target.value);
              setSelected(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setSelected((value) => Math.min(value + 1, results.length - 1));
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setSelected((value) => Math.max(value - 1, 0));
              }
              if (event.key === "Enter" && results[selected]) run(results[selected].path);
              if (event.key === "Escape") onClose();
            }}
            placeholder="Search pages and actions…"
            ref={inputRef}
            value={query}
          />
          <kbd className="rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-[10px] text-muted">
            ESC
          </kbd>
        </div>
        <div className="max-h-[22rem] overflow-auto p-2">
          {results.length ? (
            results.map((command, index) => {
              const Icon = command.icon;
              return (
                <button
                  className={cn(
                    "flex w-full items-center gap-3 rounded-[7px] px-3 py-2.5 text-left text-sm text-[#c7ced5]",
                    index === selected && "bg-white/[0.055] text-ink",
                  )}
                  key={command.label}
                  onClick={() => run(command.path)}
                  onMouseEnter={() => setSelected(index)}
                >
                  <Icon className="h-4 w-4 text-muted" />
                  <span className="flex-1">{command.label}</span>
                  <span className="text-[10px] uppercase tracking-wider text-muted/70">
                    {command.group}
                  </span>
                </button>
              );
            })
          ) : (
            <div className="px-3 py-10 text-center text-sm text-muted">No matching commands</div>
          )}
        </div>
        <footer className="flex items-center gap-4 border-t border-line px-4 py-2 text-[10px] text-muted">
          <span>↑↓ Navigate</span>
          <span>↵ Open</span>
          <span className="ml-auto">BACKPLANE command center</span>
        </footer>
      </div>
    </div>
  );
}

