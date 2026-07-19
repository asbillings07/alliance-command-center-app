import { describe, it, expect } from "vitest";
import {
    classifyTargets,
    deriveRequiredPermissions,
    type ImportMetricTarget,
} from "./metricResolution";
import { Permissions } from "@/app/src/lib/auth/permissions";

const library = [
    { id: "m-kp", name: "Kill Points" },
    { id: "m-vs", name: "VS Score" },
];

describe("classifyTargets", () => {
    it("classifies an existing metric already on the period as 'existing'", () => {
        const targets: ImportMetricTarget[] = [{ kind: "existing", metricId: "m-kp" }];
        const [result] = classifyTargets({
            targets,
            periodMetricIds: ["m-kp"],
            libraryMetrics: library,
        });
        expect(result).toEqual({ disposition: "existing", metricId: "m-kp", createName: null });
    });

    it("classifies a library metric not on the period as 'attach'", () => {
        const targets: ImportMetricTarget[] = [{ kind: "existing", metricId: "m-vs" }];
        const [result] = classifyTargets({
            targets,
            periodMetricIds: ["m-kp"],
            libraryMetrics: library,
        });
        expect(result).toEqual({ disposition: "attach", metricId: "m-vs", createName: null });
    });

    it("classifies a create for a truly new name as 'create'", () => {
        const targets: ImportMetricTarget[] = [{ kind: "create", name: "Donations" }];
        const [result] = classifyTargets({
            targets,
            periodMetricIds: ["m-kp"],
            libraryMetrics: library,
        });
        expect(result).toEqual({ disposition: "create", metricId: null, createName: "Donations" });
    });

    it("reclassifies a create whose name matches a library metric (not trusting the client)", () => {
        // Client thinks it's creating, but the metric already exists in the
        // library and just is not on this period -> attach, not create.
        const targets: ImportMetricTarget[] = [{ kind: "create", name: "  vs   score " }];
        const [result] = classifyTargets({
            targets,
            periodMetricIds: ["m-kp"],
            libraryMetrics: library,
        });
        expect(result).toEqual({ disposition: "attach", metricId: "m-vs", createName: null });
    });

    it("reclassifies a create to 'existing' when the matched metric is already on the period", () => {
        const targets: ImportMetricTarget[] = [{ kind: "create", name: "Kill Points" }];
        const [result] = classifyTargets({
            targets,
            periodMetricIds: ["m-kp"],
            libraryMetrics: library,
        });
        expect(result).toEqual({ disposition: "existing", metricId: "m-kp", createName: null });
    });
});

describe("deriveRequiredPermissions", () => {
    it("requires only IMPORT_METRICS when everything is already attached", () => {
        const perms = deriveRequiredPermissions([
            { disposition: "existing", metricId: "m-kp", createName: null },
        ]);
        expect(perms).toEqual([Permissions.IMPORT_METRICS]);
    });

    it("adds CONFIGURE_PERIODS when a metric must be attached", () => {
        const perms = deriveRequiredPermissions([
            { disposition: "existing", metricId: "m-kp", createName: null },
            { disposition: "attach", metricId: "m-vs", createName: null },
        ]);
        expect(perms).toEqual([Permissions.IMPORT_METRICS, Permissions.CONFIGURE_PERIODS]);
    });

    it("adds CONFIGURE_PERIODS and CONFIGURE_METRICS when a metric must be created", () => {
        const perms = deriveRequiredPermissions([
            { disposition: "create", metricId: null, createName: "Donations" },
        ]);
        expect(perms).toEqual([
            Permissions.IMPORT_METRICS,
            Permissions.CONFIGURE_PERIODS,
            Permissions.CONFIGURE_METRICS,
        ]);
    });
});
