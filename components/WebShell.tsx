"use client";

import { Bookmark, LayoutGrid, SearchCheck, Users, Zap } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { DemoAuthButton } from "@/components/demo-auth-button";
import { PageTransition } from "@/components/PageTransition";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutGrid },
  { href: "/chat", label: "Search", icon: SearchCheck },
  { href: "/saved", label: "Saved", icon: Bookmark },
  { href: "/social", label: "Social", icon: Users },
  { href: "/perks", label: "Perks", icon: Zap },
] as const;

export function WebShell({
  children,
  transparentHeader = false,
  hideFooter = false,
  fullHeight = false,
}: {
  children: ReactNode;
  transparentHeader?: boolean;
  hideFooter?: boolean;
  fullHeight?: boolean;
}) {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const heroHeader = transparentHeader && !scrolled;

  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 16);
    }

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div
      className={`${fullHeight ? "h-screen overflow-hidden" : "min-h-screen"} flex flex-col bg-background`}
    >
      <header
        className={cn(
          "sticky top-0 z-30 transition-[background-color,backdrop-filter,border-color] duration-300",
          scrolled || !transparentHeader
            ? "bg-background/85 backdrop-blur border-b border-border"
            : "bg-transparent border-b border-transparent",
        )}
      >
        <div className="mx-auto max-w-7xl px-6 lg:px-10 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <span
              className={cn(
                "text-xl font-display font-extrabold tracking-tight transition-colors duration-300",
                heroHeader ? "text-white drop-shadow-sm" : "text-foreground",
              )}
            >
              FlowRyd
            </span>
          </Link>

          <nav className="hidden md:flex items-center gap-1" aria-label="Primary">
            {navItems.map(({ href, label, icon: Icon }) => {
              const active = pathname === href;
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition-colors duration-300",
                    active
                      ? "bg-accent text-accent-foreground"
                      : heroHeader
                        ? "text-white/90 hover:bg-white/15"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <Icon className="size-4" aria-hidden="true" />
                  {label}
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-2">
            <DemoAuthButton shell transparentHeader={heroHeader} />
          </div>
        </div>

        <nav
          className={cn(
            "md:hidden flex justify-around border-t transition-colors duration-300",
            scrolled || !transparentHeader
              ? "border-border bg-background"
              : "border-white/15 bg-background/70 backdrop-blur",
          )}
          aria-label="Primary mobile"
        >
          {navItems.map(({ href, label, icon: Icon }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-xs font-medium ${
                  active ? "text-primary" : "text-muted-foreground"
                }`}
              >
                <Icon className="size-5" strokeWidth={active ? 2.5 : 2} aria-hidden="true" />
                {label}
              </Link>
            );
          })}
        </nav>
      </header>

      <main className={`flex-1 flex flex-col ${fullHeight ? "min-h-0 overflow-hidden" : ""}`}>
        <PageTransition fullHeight={fullHeight}>{children}</PageTransition>
      </main>

      {!hideFooter ? (
        <footer className="border-t border-border mt-12">
          <div className="mx-auto max-w-7xl px-6 lg:px-10 py-10 grid grid-cols-2 md:grid-cols-4 gap-8 text-sm">
            <div>
              <div className="font-display font-extrabold text-lg">FlowRyd</div>
              <p className="text-muted-foreground mt-2">
                The first car-buying experience for your life.
              </p>
            </div>
            <FooterCol title="Discover" links={["New EVs", "Used EVs", "Lease deals", "Compare"]} />
            <FooterCol title="Company" links={["About", "Press", "Careers", "Contact"]} />
            <FooterCol title="Legal" links={["Privacy", "Terms", "Cookies"]} />
          </div>
          <div className="border-t border-border py-5 text-center text-xs text-muted-foreground">
            © {new Date().getFullYear()} FlowRyd. All rights reserved.
          </div>
        </footer>
      ) : null}
    </div>
  );
}

function FooterCol({ title, links }: { title: string; links: string[] }) {
  return (
    <div>
      <div className="font-semibold text-foreground">{title}</div>
      <ul className="mt-2 space-y-1.5 text-muted-foreground">
        {links.map((link) => (
          <li key={link}>
            <a href="#" className="hover:text-foreground">
              {link}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
