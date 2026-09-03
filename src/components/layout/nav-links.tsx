"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  Brain,
  ClipboardCheck,
  History,
  LayoutDashboard,
  Mic,
  PenLine,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/", label: "Início", icon: LayoutDashboard, compact: true },
  { href: "/nova-reflexao", label: "Nova reflexão", icon: Mic, compact: true },
  { href: "/biblioteca", label: "Biblioteca", icon: BookOpen, compact: true },
  { href: "/memoria", label: "Memória", icon: Brain, compact: true },
  { href: "/mesa", label: "Mesa de revisão", icon: ClipboardCheck, compact: false },
  { href: "/historico", label: "Histórico", icon: History, compact: true },
  { href: "/identidade", label: "Identidade de escrita", icon: PenLine, compact: false },
  { href: "/configuracoes", label: "Configurações", icon: Settings, compact: false },
];

export function NavLinks({ compact = false }: { compact?: boolean }) {
  const pathname = usePathname();
  const items = compact ? ITEMS.filter((i) => i.compact) : ITEMS;

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  if (compact) {
    return (
      <ul className="flex items-stretch justify-around">
        {items.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex flex-col items-center gap-1 px-1 py-2.5 text-[10px]",
                  active ? "text-accent" : "text-ink-faint",
                )}
              >
                <Icon aria-hidden size={19} strokeWidth={1.75} />
                <span className="leading-none">{item.label.split(" ")[0]}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <ul className="space-y-0.5">
      {items.map((item) => {
        const Icon = item.icon;
        const active = isActive(item.href);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-[var(--radius)] px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-accent-soft text-accent font-medium"
                  : "text-ink-soft hover:bg-surface-2 hover:text-ink",
              )}
            >
              <Icon aria-hidden size={17} strokeWidth={1.75} />
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
