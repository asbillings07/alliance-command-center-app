"use client";

import { useState, useEffect, useRef } from "react";

type Member = {
  id: string;
  playerName: string;
};

type Selection =
  | { type: "existing"; member: Member }
  | { type: "new"; playerName: string };

type PlayerNameComboboxProps = {
  allianceId: string;
  onSelect: (selection: Selection | null) => void;
  searchMembers: (query: string) => Promise<Member[]>;
};

export function PlayerNameCombobox({
  allianceId,
  onSelect,
  searchMembers,
}: PlayerNameComboboxProps) {
  const [query, setQuery] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedDisplay, setSelectedDisplay] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(async () => {
      if (!isOpen) return;
      setIsLoading(true);
      try {
        const results = await searchMembers(query);
        setMembers(results);
      } catch (error) {
        console.error("Failed to search members:", error);
        setMembers([]);
      } finally {
        setIsLoading(false);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [query, isOpen, searchMembers]);

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

  const handleSelectMember = (member: Member) => {
    setSelectedDisplay(member.playerName);
    setQuery("");
    setIsOpen(false);
    onSelect({ type: "existing", member });
  };

  const handleCreateNew = () => {
    if (!query.trim()) return;
    setSelectedDisplay(query.trim());
    setIsOpen(false);
    onSelect({ type: "new", playerName: query.trim() });
    setQuery("");
  };

  const handleClear = () => {
    setSelectedDisplay(null);
    setQuery("");
    onSelect(null);
    inputRef.current?.focus();
  };

  const exactMatch = members.find(
    (m) => m.playerName.toLowerCase() === query.toLowerCase()
  );
  const showCreateOption = query.trim() && !exactMatch;

  return (
    <div ref={containerRef} className="relative">
      <label
        htmlFor="playerName"
        className="block text-sm font-medium text-[#D1D5DB] mb-1.5"
      >
        Player Name
      </label>

      {selectedDisplay ? (
        <div className="flex items-center gap-2 px-3 py-2 border border-[#374151] rounded-md bg-[#1F2937]">
          <svg
            className="w-4 h-4 text-[#9CA3AF]"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
            />
          </svg>
          <span className="flex-1 text-[#F9FAFB] text-sm">{selectedDisplay}</span>
          <button
            type="button"
            onClick={handleClear}
            className="text-[#9CA3AF] hover:text-[#D1D5DB]"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      ) : (
        <input
          ref={inputRef}
          type="text"
          id="playerName"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setIsOpen(true)}
          placeholder="Search existing members or type a new name..."
          className="w-full px-3 py-2 border border-[#374151] rounded-md bg-[#1F2937] text-[#F9FAFB] placeholder-[#6B7280] focus:outline-none focus:ring-2 focus:ring-[#3B82F6] focus:border-transparent text-sm"
          autoComplete="off"
        />
      )}

      {isOpen && !selectedDisplay && (
        <div className="absolute z-10 w-full mt-1 bg-[#273449] border border-[#374151] rounded-md shadow-lg max-h-60 overflow-auto">
          {isLoading && (
            <div className="px-3 py-2.5 text-[#9CA3AF] text-sm">Searching...</div>
          )}

          {!isLoading && members.length > 0 && (
            <>
              {members.map((member) => (
                <button
                  key={member.id}
                  type="button"
                  onClick={() => handleSelectMember(member)}
                  className="w-full px-3 py-2.5 text-left hover:bg-[#1F2937] flex items-center gap-2 text-sm"
                >
                  <svg
                    className="w-4 h-4 text-[#9CA3AF]"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                    />
                  </svg>
                  <span className="text-[#F9FAFB]">{member.playerName}</span>
                </button>
              ))}
            </>
          )}

          {!isLoading && members.length === 0 && query.trim() && (
            <div className="px-3 py-2.5 text-[#9CA3AF] text-sm">
              No existing members match
            </div>
          )}

          {showCreateOption && (
            <>
              {members.length > 0 && (
                <div className="border-t border-[#374151]" />
              )}
              <button
                type="button"
                onClick={handleCreateNew}
                className="w-full px-3 py-2.5 text-left hover:bg-[#1F2937] text-[#D1D5DB] flex items-center gap-2 text-sm"
              >
                <svg
                  className="w-4 h-4 text-[#9CA3AF]"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M12 4v16m8-8H4"
                  />
                </svg>
                <span>Create new member &quot;{query.trim()}&quot;</span>
              </button>
            </>
          )}

          {!isLoading && members.length === 0 && !query.trim() && (
            <div className="px-3 py-2.5 text-[#9CA3AF] text-sm">
              Start typing to search or create
            </div>
          )}
        </div>
      )}
    </div>
  );
}
