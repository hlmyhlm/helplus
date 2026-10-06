"use client";

import { Bell, Search, Sun, Moon, LogOut, User } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { useTheme } from "@/lib/hooks/use-theme";
import { useRouter } from "next/navigation";
import { clearCompanyCache } from "@/lib/hooks/use-company";

interface HeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}

export function Header({ title, description, actions }: HeaderProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const router = useRouter();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleLogout = async () => {
    await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "logout" }),
    });
    clearCompanyCache(); // next login may be another company
    router.push("/login");
  };

  return (
    <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 px-4 md:px-6 py-3 md:py-4 bg-helplus-surface border-b border-helplus-border transition-theme">
      <div className="animate-fade-in min-w-0">
        <h2 className="text-lg md:text-xl font-semibold text-helplus-text line-clamp-2 md:truncate">{title}</h2>
        {description && (
          <p className="text-sm text-helplus-text-light mt-0.5">{description}</p>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {searchOpen && (
          <input
            type="text"
            placeholder="Search..."
            className="hidden md:block px-3 py-1.5 text-sm border border-helplus-border rounded-lg bg-helplus-surface text-helplus-text focus:outline-none focus:ring-2 focus:ring-helplus-primary/30 focus:border-helplus-primary w-64 animate-slide-in-down transition-theme"
            autoFocus
            onBlur={() => setSearchOpen(false)}
          />
        )}
        {/* not wired up yet */}
        <button
          onClick={() => setSearchOpen(!searchOpen)}
          className="hidden md:inline-flex p-2 text-helplus-text-light hover:text-helplus-text hover:bg-helplus-primary-50 rounded-lg transition-colors"
          title="Search"
        >
          <Search className="h-5 w-5" />
        </button>

        {/* only theme switch on phones */}
        <button
          onClick={toggleTheme}
          className="p-2 text-helplus-text-light hover:text-helplus-text hover:bg-helplus-primary-50 rounded-lg transition-colors"
          title={theme === "light" ? "Dark mode" : "Light mode"}
        >
          {theme === "light" ? (
            <Moon className="h-5 w-5" />
          ) : (
            <Sun className="h-5 w-5" />
          )}
        </button>

        {/* not wired up yet */}
        <button className="hidden md:inline-flex relative p-2 text-helplus-text-light hover:text-helplus-text hover:bg-helplus-primary-50 rounded-lg transition-colors">
          <Bell className="h-5 w-5" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-helplus-danger rounded-full" />
        </button>

        {actions}

        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            className="flex items-center justify-center w-8 h-8 rounded-full bg-helplus-primary text-white text-sm font-medium hover:bg-helplus-primary-dark transition-colors"
          >
            A
          </button>

          {userMenuOpen && (
            <div className="absolute right-0 mt-2 w-48 bg-helplus-surface border border-helplus-border rounded-lg shadow-lg py-1 z-50 animate-scale-in transition-theme">
              <button
                onClick={() => {
                  setUserMenuOpen(false);
                  router.push("/settings");
                }}
                className="flex items-center gap-2 w-full px-4 py-2 text-sm text-helplus-text hover:bg-helplus-primary-50 transition-colors"
              >
                <User className="h-4 w-4" />
                Profile & Settings
              </button>
              <div className="border-t border-helplus-border my-1" />
              <button
                onClick={handleLogout}
                className="flex items-center gap-2 w-full px-4 py-2 text-sm text-helplus-danger hover:bg-red-50 transition-colors"
              >
                <LogOut className="h-4 w-4" />
                Sign Out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
