"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";

type SearchResult = {
  id: string;
  type: "alliance" | "user" | "member" | "invitation";
  title: string;
  subtitle: string;
  href: string;
};

export function PlatformSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const search = useCallback(async (searchQuery: string) => {
    if (searchQuery.length < 2) {
      setResults([]);
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch(
        `/api/platform/search?q=${encodeURIComponent(searchQuery)}`
      );
      if (response.ok) {
        const data = await response.json();
        setResults(data.results);
      } else {
        // Clear results on non-ok response to avoid showing stale data
        setResults([]);
      }
    } catch (error) {
      console.error("Search error:", error);
      // Clear results on error to avoid showing stale data
      setResults([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      search(query);
    }, 300);
    return () => clearTimeout(timeoutId);
  }, [query, search]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (result: SearchResult) => {
    router.push(result.href);
    setQuery("");
    setIsOpen(false);
  };

  const typeIcons: Record<string, string> = {
    alliance: "🏰",
    user: "👤",
    member: "🎮",
    invitation: "✉️",
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          placeholder="Search alliances, users..."
          className="
            w-full px-3 py-2 pl-9
            bg-surface-secondary border border-border rounded-lg
            text-text-primary placeholder:text-text-muted
            focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary
            text-sm
          "
        />
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        {isLoading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>

      {/* Results dropdown */}
      {isOpen && query.length >= 2 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-surface border border-border rounded-lg shadow-lg overflow-hidden z-50">
          {results.length === 0 && !isLoading ? (
            <div className="px-4 py-3 text-sm text-text-muted">
              No results for &quot;{query}&quot;
            </div>
          ) : (
            <ul className="max-h-64 overflow-auto">
              {results.map((result) => (
                <li key={`${result.type}-${result.id}`}>
                  <button
                    onClick={() => handleSelect(result)}
                    className="
                      w-full px-4 py-2 text-left
                      hover:bg-surface-secondary
                      flex items-center gap-3
                      transition-colors
                    "
                  >
                    <span className="text-lg">{typeIcons[result.type]}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-text-primary truncate">
                        {result.title}
                      </div>
                      <div className="text-xs text-text-muted truncate">
                        {result.subtitle}
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
