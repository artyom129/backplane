import { Check, Copy } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/Button";

function syntaxHighlight(value: unknown): React.ReactNode[] {
  const text = JSON.stringify(value, null, 2) ?? "null";
  const pattern = /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"\s*:?)|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) nodes.push(text.slice(cursor, index));
    const token = match[0];
    let color = "text-amber-300";
    if (token.startsWith('"')) color = token.endsWith(":") ? "text-sky-300" : "text-[#a7e3c4]";
    else if (["true", "false"].includes(token)) color = "text-violet-300";
    else if (token === "null") color = "text-muted";
    nodes.push(
      <span className={color} key={`${index}-${token}`}>
        {token}
      </span>,
    );
    cursor = index + token.length;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

export function JsonViewer({ value, className = "" }: { value: unknown; className?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(JSON.stringify(value, null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };
  return (
    <div className={`relative overflow-hidden rounded-lg border border-line bg-[#090c0f] ${className}`}>
      <Button
        aria-label="Copy JSON"
        className="absolute right-2 top-2 z-10 bg-[#0d1115]/90"
        onClick={() => void copy()}
        size="icon"
        variant="secondary"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-accent" /> : <Copy className="h-3.5 w-3.5" />}
      </Button>
      <pre className="max-h-[30rem] overflow-auto p-4 pr-12 font-mono text-xs leading-5 text-[#c4cbd2]">
        {syntaxHighlight(value)}
      </pre>
    </div>
  );
}

