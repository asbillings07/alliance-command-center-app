'use client'

import { useState } from "react";
import { useRouter } from "next/navigation";

type Alliance = {
    id: string;
    name: string;
    server: string;
};

export function AllianceSelector({ alliances }: { alliances: Alliance[] }) {
    const [selectedAlliance, setSelectedAlliance] = useState<string>(alliances[0]?.id ?? "");
    const router = useRouter();
    const handleSubmit = () => {
        if (selectedAlliance) {
            router.push(`/alliances/${selectedAlliance}`);
        }
    };

    return (
        <div className="flex flex-col items-center justify-center">
            <select
                className="w-full border border-border bg-surface-secondary text-text-primary rounded-md p-2 focus:outline-none focus:ring-2 focus:ring-primary"
                aria-label="Select an Alliance"
                value={selectedAlliance}
                onChange={(e) => setSelectedAlliance(e.target.value)}
            >
                {alliances.map((alliance) => (
                    <option key={alliance.id} value={alliance.id}>
                        {alliance.name} (Server {alliance.server})
                    </option>
                ))}
            </select>
            <button
                className="p-2 bg-primary-hover hover:bg-primary-active text-white w-full rounded-md mt-2 cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary"
                type="button"
                onClick={handleSubmit}
            >
                Select Alliance
            </button>
        </div>
    );
}
