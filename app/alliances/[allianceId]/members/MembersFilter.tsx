"use client";

import Link from "next/link";

type FilterType = "active" | "archived" | "all";

interface MembersFilterProps {
    currentFilter: FilterType;
    activeCount: number;
    archivedCount: number;
    allianceId: string;
    periodId?: string;
}

export function MembersFilter({
    currentFilter,
    activeCount,
    archivedCount,
    allianceId,
    periodId,
}: MembersFilterProps) {
    const totalCount = activeCount + archivedCount;

    const filters: { id: FilterType; label: string; count: number }[] = [
        { id: "active", label: "Active", count: activeCount },
        { id: "archived", label: "Archived", count: archivedCount },
        { id: "all", label: "All", count: totalCount },
    ];

    return (
        <div className="flex gap-1 p-1 bg-surface-secondary rounded-lg mb-6 w-fit">
            {filters.map((filter) => {
                const isActive = currentFilter === filter.id;
                const href = `/alliances/${allianceId}/members?filter=${filter.id}${periodId ? `&periodId=${encodeURIComponent(periodId)}` : ""}`;
                return (
                    <Link
                        key={filter.id}
                        href={href}
                        className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                            isActive
                                ? "bg-surface text-primary-light shadow-sm"
                                : "text-text-secondary hover:text-text-primary"
                        }`}
                    >
                        {filter.label}
                        <span
                            className={`ml-1.5 ${
                                isActive ? "text-text-secondary" : "text-text-muted"
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
