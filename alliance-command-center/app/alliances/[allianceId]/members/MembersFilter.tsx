"use client";

import Link from "next/link";

type FilterType = "active" | "archived" | "all";

interface MembersFilterProps {
    currentFilter: FilterType;
    activeCount: number;
    archivedCount: number;
    allianceId: string;
}

export function MembersFilter({
    currentFilter,
    activeCount,
    archivedCount,
    allianceId,
}: MembersFilterProps) {
    const totalCount = activeCount + archivedCount;

    const filters: { id: FilterType; label: string; count: number }[] = [
        { id: "active", label: "Active", count: activeCount },
        { id: "archived", label: "Archived", count: archivedCount },
        { id: "all", label: "All", count: totalCount },
    ];

    return (
        <div className="flex gap-1 p-1 bg-gray-100 rounded-lg mb-6 w-fit">
            {filters.map((filter) => {
                const isActive = currentFilter === filter.id;
                return (
                    <Link
                        key={filter.id}
                        href={`/alliances/${allianceId}/members?filter=${filter.id}`}
                        className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                            isActive
                                ? "bg-white text-gray-900 shadow-sm"
                                : "text-gray-600 hover:text-gray-900"
                        }`}
                    >
                        {filter.label}
                        <span
                            className={`ml-1.5 ${
                                isActive ? "text-gray-500" : "text-gray-400"
                            }`}
                        >
                            {filter.count}
                        </span>
                    </Link>
                );
            })}
        </div>
    );
}
