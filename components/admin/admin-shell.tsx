"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Car, LogOut, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/vehicles", label: "Vehicles", icon: Car }
];

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/admin/logout", { method: "POST" });
    router.push("/admin");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-card">
        <div className="flex flex-col gap-1 px-6 py-6">
          <p className="font-display text-lg font-extrabold">FlowRyd Admin</p>
          <p className="text-sm text-muted-foreground">Operations panel</p>
        </div>
        <Separator />
        <nav className="flex flex-col gap-1 px-3 py-4">
          {navItems.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
                  active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <Icon data-icon="inline-start" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto border-t border-border p-4">
          <Button variant="outline" className="w-full" onClick={handleLogout}>
            <LogOut data-icon="inline-start" />
            Log out
          </Button>
        </div>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-6 py-8 lg:px-10">
          {children}
        </div>
      </main>
    </div>
  );
}
