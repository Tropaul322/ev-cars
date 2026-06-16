"use client";

import { Bookmark, SearchCheck, Users, Zap } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { DemoAuthButton } from "@/components/demo-auth-button";

const navItems = [
  { href: "/", label: "Search", icon: SearchCheck },
  { href: "/saved", label: "Saved", icon: Bookmark },
  { href: "/social", label: "Social", icon: Users },
  { href: "/perks", label: "Perks", icon: Zap }
] as const;

export function FlowRydShell({
  children,
  transparentHeader = false,
  hideFooter = false,
  fullHeight = false
}: {
  children: ReactNode;
  transparentHeader?: boolean;
  hideFooter?: boolean;
  fullHeight?: boolean;
}) {
  const pathname = usePathname();

  return (
    <div className={fullHeight ? "flow-shell flow-shell-full" : "flow-shell"}>
      <header className={transparentHeader ? "flow-header flow-header-transparent" : "flow-header"}>
        <div className="flow-header-inner">
          <Link className="flow-brand" href="/">
            FlowRyd
          </Link>
          <nav className="flow-nav" aria-label="Primary">
            {navItems.map(({ href, label, icon: Icon }) => {
              const active = pathname === href || (href === "/" && pathname === "/chat");
              return (
                <Link
                  className={active ? "flow-nav-link flow-nav-link-active" : "flow-nav-link"}
                  href={href}
                  key={href}
                >
                  <Icon size={16} aria-hidden="true" />
                  {label}
                </Link>
              );
            })}
          </nav>
          <div className="flow-auth">
            <DemoAuthButton shell />
          </div>
        </div>
      </header>

      <main className={fullHeight ? "flow-main flow-main-full" : "flow-main"} key={pathname}>
        <div className="flow-page-transition">{children}</div>
      </main>

      {!hideFooter ? (
        <footer className="app-footer">
          <div className="footer-grid">
            <div>
              <h2>FlowRyd</h2>
              <p>The first car-buying experience for your life.</p>
            </div>
            <nav aria-label="Discover">
              <h3>Discover</h3>
              <a href="#">New EVs</a>
              <a href="#">Used EVs</a>
              <a href="#">Lease deals</a>
              <a href="#">Compare</a>
            </nav>
            <nav aria-label="Company">
              <h3>Company</h3>
              <a href="#">About</a>
              <a href="#">Press</a>
              <a href="#">Careers</a>
              <a href="#">Contact</a>
            </nav>
            <nav aria-label="Legal">
              <h3>Legal</h3>
              <a href="#">Privacy</a>
              <a href="#">Terms</a>
              <a href="#">Cookies</a>
            </nav>
          </div>
          <div className="footer-bottom">© 2026 FlowRyd. All rights reserved.</div>
        </footer>
      ) : null}
    </div>
  );
}
