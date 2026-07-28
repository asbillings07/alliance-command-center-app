import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));

vi.mock("@/app/src/lib/platform", () => ({
  getAllianceById: vi.fn(),
  getAllianceTimeline: vi.fn(),
  getAllianceActivity: vi.fn(),
  getAllianceSetupStatusById: vi.fn(),
}));

import {
  getAllianceById,
  getAllianceTimeline,
  getAllianceActivity,
  getAllianceSetupStatusById,
} from "@/app/src/lib/platform";
import AllianceDetailPage from "./page";

const ALLIANCE_ID = "alliance-165";
const DETAIL_PATH = `/platform/support/alliance/${ALLIANCE_ID}`;

function mockAlliance() {
  vi.mocked(getAllianceById).mockResolvedValue({
    id: ALLIANCE_ID,
    name: "Test Alliance",
    server: "1001",
    createdAt: new Date("2025-01-15T12:00:00Z"),
    updatedAt: new Date("2025-01-15T12:00:00Z"),
    memberships: [],
    _count: {
      allianceMembers: 12,
      metrics: 3,
      metricPeriods: 2,
      memberships: 1,
      invitations: 0,
    },
  } as unknown as Awaited<ReturnType<typeof getAllianceById>>);
}

describe("PlatformSupportAllianceDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAlliance();
    vi.mocked(getAllianceTimeline).mockResolvedValue({
      allianceId: ALLIANCE_ID,
      allianceName: "Test Alliance",
      events: [],
    });
    vi.mocked(getAllianceActivity).mockResolvedValue([]);
  });

  it("does not render Open in ACC or View Details", async () => {
    vi.mocked(getAllianceSetupStatusById).mockResolvedValue("complete");

    const page = await AllianceDetailPage({
      params: Promise.resolve({ allianceId: ALLIANCE_ID }),
    });
    const html = renderToStaticMarkup(page);

    expect(html).not.toContain("Open in ACC");
    expect(html).not.toContain("View Details");
  });

  it("does not render any link pointing back to the current detail URL", async () => {
    vi.mocked(getAllianceSetupStatusById).mockResolvedValue("complete");

    const page = await AllianceDetailPage({
      params: Promise.resolve({ allianceId: ALLIANCE_ID }),
    });
    const html = renderToStaticMarkup(page);

    expect(html).not.toContain(`href="${DETAIL_PATH}"`);
  });

  it("renders Setup complete when readiness is complete", async () => {
    vi.mocked(getAllianceSetupStatusById).mockResolvedValue("complete");

    const page = await AllianceDetailPage({
      params: Promise.resolve({ allianceId: ALLIANCE_ID }),
    });
    const html = renderToStaticMarkup(page);

    expect(html).toContain("Setup complete");
  });

  it("renders Setup incomplete when readiness is incomplete", async () => {
    vi.mocked(getAllianceSetupStatusById).mockResolvedValue("incomplete");

    const page = await AllianceDetailPage({
      params: Promise.resolve({ allianceId: ALLIANCE_ID }),
    });
    const html = renderToStaticMarkup(page);

    expect(html).toContain("Setup incomplete");
  });

  it("renders Status unavailable when readiness cannot be determined", async () => {
    vi.mocked(getAllianceSetupStatusById).mockResolvedValue("unavailable");

    const page = await AllianceDetailPage({
      params: Promise.resolve({ allianceId: ALLIANCE_ID }),
    });
    const html = renderToStaticMarkup(page);

    expect(html).toContain("Status unavailable");
  });
});
