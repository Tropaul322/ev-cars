"use client";

import { Bookmark, LayoutGrid, SearchCheck } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { DemoAuthButton } from "@/components/demo-auth-button";
import { PageTransition } from "@/components/PageTransition";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutGrid },
  { href: "/chat", label: "Search", icon: SearchCheck, matchPrefix: "/chat" },
  { href: "/saved", label: "Saved", icon: Bookmark },
] as const;

function isNavActive(
  pathname: string,
  href: string,
  matchPrefix?: string,
) {
  if (matchPrefix) return pathname === matchPrefix || pathname.startsWith(`${matchPrefix}/`);
  return pathname === href;
}

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

    if (transparentHeader) {
      setScrolled(false);
    } else {
      onScroll();
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [pathname, transparentHeader]);

  return (
    <div
      className={`${fullHeight ? "h-screen overflow-hidden" : "min-h-screen"} flex flex-col bg-background`}
    >
      <header
        className={cn(
          "sticky top-0 z-30 transition-[background-color,backdrop-filter,border-color] duration-300",
          heroHeader
            ? "bg-transparent"
            : "bg-background/85 backdrop-blur border-b border-border",
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
            {navItems.map((item) => {
              const { href, label, icon: Icon } = item;
              const matchPrefix = "matchPrefix" in item ? item.matchPrefix : undefined;
              const active = isNavActive(pathname, href, matchPrefix);
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
            "md:hidden flex justify-around transition-colors duration-300",
            heroHeader
              ? "border-t border-white/15 bg-transparent"
              : "border-t border-border bg-background",
          )}
          aria-label="Primary mobile"
        >
          {navItems.map((item) => {
            const { href, label, icon: Icon } = item;
            const matchPrefix = "matchPrefix" in item ? item.matchPrefix : undefined;
            const active = isNavActive(pathname, href, matchPrefix);
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
          <div className="mx-auto max-w-7xl px-6 lg:px-10 py-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between text-sm">
            <div>
              <div className="font-display font-extrabold">FlowRyd</div>
              <p className="text-muted-foreground mt-1 text-xs">
                The first car-buying experience for your life.
              </p>
            </div>
            <nav
              className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground"
              aria-label="Footer"
            >
              <Link href="/chat" className="hover:text-foreground">
                Search
              </Link>
              <Link href="/saved" className="hover:text-foreground">
                Saved
              </Link>
              <Link href="/perks" className="hover:text-foreground">
                Perks
              </Link>
              <Link href="/social" className="hover:text-foreground">
                Social
              </Link>
            </nav>
            <div className="text-xs text-muted-foreground">
              © {new Date().getFullYear()} FlowRyd
            </div>
          </div>
        </footer>
      ) : null}
    </div>
  );
}
