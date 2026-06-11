'use client'

import { useState } from "react";
import { redirect } from "next/navigation";

type Alliance = {
    id: string;
    name: string;
    server: string;
};

export function AllianceSelector({ alliances }: { alliances: Alliance[] }) {
    const [selectedAlliance, setSelectedAlliance] = useState<string>(alliances[0]?.id ?? "");
    const handleSubmit = () => {
        console.log("redirecting to", `/alliances/${selectedAlliance}`);
        if (selectedAlliance) {
            redirect(`/alliances/${selectedAlliance}`);
        }
    };

    return (
        <div className="flex flex-col items-center justify-center">
            <select 
                className="border border-gray-300 rounded-md p-2"
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
                className="p-2 bg-blue-500 text-white w-full rounded-md mt-2 cursor-pointer" 
                type="button"
                onClick={handleSubmit}
            >
                Select Alliance
            </button>
        </div>
    );
}
