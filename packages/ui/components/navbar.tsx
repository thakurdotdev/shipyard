"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { ModeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { LayoutDashboard, FolderGit2, Settings } from "lucide-react";

export function Navbar() {
  const pathname = usePathname();

  const routes = [
    {
      href: "/",
      label: "Dashboard",
      icon: LayoutDashboard,
      active: pathname === "/",
    },
    {
      href: "/projects",
      label: "Projects",
      icon: FolderGit2,
      active: pathname.startsWith("/projects"),
    },
    {
      href: "/settings",
      label: "Settings",
      icon: Settings,
      active: pathname === "/settings",
    },
  ];

  return (
    <nav className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <Link href="/" className="font-bold text-xl flex items-center gap-2">
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center text-primary-foreground">
              V
            </div>
            Mini Vercel
          </Link>
          <div className="hidden md:flex items-center gap-6">
            {routes.map((route) => (
              <Link
                key={route.href}
                href={route.href}
                className={cn(
                  "text-sm font-medium transition-colors hover:text-primary flex items-center gap-2",
                  route.active ? "text-foreground" : "text-muted-foreground",
                )}
              >
                <route.icon className="w-4 h-4" />
                {route.label}
              </Link>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-4">
          <ModeToggle />
          <Button>Sign In</Button>
        </div>
      </div>
    </nav>
  );
}
