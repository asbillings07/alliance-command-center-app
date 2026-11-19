import { afterEach, describe, expect, it, vi } from "vitest";
import { getVercelOidcToken, verifyVercelOidcToken } from "@vercel/oidc";
import { pilotReservationId, reserveBeforeProductionScan } from "./pilotAllowance";
import { allowPilotServerEvent } from "./pilotTelemetry";
import { productionPilotConfigured, productionPilotPairAllowed, productionPilotPairs } from "./productionPilot";

vi.mock("@vercel/oidc", () => ({ getVercelOidcToken: vi.fn(), verifyVercelOidcToken: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetAllMocks(); });

describe("one-user production pilot", () => {
  const conn = "postgresql://ep-broad-pond-auubqyjq.neon.tech/acc?sslmode=require";
  const env = { VERCEL_ENV: "production", VERCEL_TARGET_ENV: "production", VERCEL_GIT_COMMIT_REF: "main",
    OCR_PILOT_ENABLED: "true", OCR_PILOT_USER_ID: "one-user", OCR_PILOT_ALLIANCE_ID: "one-alliance",
    PRODUCTION_DB_HOSTS: "ep-broad-pond-auubqyjq", DATABASE_URL: conn, DIRECT_URL: conn };
  it("requires both rollout identifiers, main and the production database", () => {
    expect(productionPilotConfigured(env)).toBe(true);
    for (const change of [{ VERCEL_ENV: "preview" }, { OCR_PILOT_ENABLED: "false" }, { OCR_PILOT_USER_ID: "" },
      { OCR_PILOT_ALLIANCE_ID: "" }, { VERCEL_GIT_COMMIT_REF: "other" }, { DATABASE_URL: conn + "&host=elsewhere" }]) {
      expect(productionPilotConfigured({ ...env, ...change })).toBe(false);
    }
  });
  it("retains exact pairs and ignores an incomplete test enrollment", () => {
    const measured = { userId: "one-user", allianceId: "one-alliance" };
    const operator = { userId: "test-user", allianceId: "test-alliance" };
    expect(productionPilotPairs(env)).toEqual([measured]);
    expect(productionPilotPairs({ ...env, OCR_PILOT_TEST_USER_ID: operator.userId })).toEqual([measured]);
    expect(productionPilotPairs({ ...env, OCR_PILOT_TEST_ALLIANCE_ID: operator.allianceId })).toEqual([measured]);
    const both = { ...env, OCR_PILOT_TEST_USER_ID: operator.userId, OCR_PILOT_TEST_ALLIANCE_ID: operator.allianceId };
    expect(productionPilotPairAllowed(measured.userId, measured.allianceId, both)).toBe(true);
    expect(productionPilotPairAllowed(operator.userId, operator.allianceId, both)).toBe(true);
    expect(productionPilotPairAllowed(operator.userId, measured.allianceId, both)).toBe(false);
    expect(productionPilotPairAllowed(measured.userId, operator.allianceId, both)).toBe(false);
    expect(productionPilotPairAllowed("someone-else", operator.allianceId, both)).toBe(false);
  });
  it("drops sensitive routes, mutations and unknown server events while allowing ordinary page diagnostics", () => {
    vi.stubEnv("VERCEL_ENV", "production"); vi.stubEnv("OCR_PILOT_ENABLED", "true");
    for (const path of ["/api/ocr-evaluation", "/api/ocr-pilot-reservations", "/alliances/one/periods/week/import",
      "/alliances/one/members/two/history", "/account/ocr", "/alliances/one/%73creenshots"]) {
      expect(allowPilotServerEvent({request:{method:"GET",url:"https://alliancehqapp.com"+path}})).toBe(false);
    }
    expect(allowPilotServerEvent({})).toBe(false);
    expect(allowPilotServerEvent({request:{method:"POST",url:"https://alliancehqapp.com/app"}})).toBe(false);
    expect(allowPilotServerEvent({request:{method:"GET",url:"https://alliancehqapp.com/app"}})).toBe(true);
  });
  it("requires a verified production token bound to this reservation service", async () => {
    vi.mocked(verifyVercelOidcToken).mockRejectedValue(new Error("invalid"));
    expect(await pilotReservationId("Bearer wrong")).toBeNull();
    expect(verifyVercelOidcToken).toHaveBeenCalledWith("wrong", expect.objectContaining({
      environment: "production", issuer: "https://oidc.vercel.com/aptelum-labs",
      audience: expect.stringContaining("/api/ocr-pilot-reservations"), requiredClaims: expect.arrayContaining(["exp","jti"]),
      projectId: expect.stringMatching(/^prj_/), ownerId: expect.stringMatching(/^team_/),
    }));
  });
  it("requires positive acknowledgment of the exact new reservation before dispatch", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const id = crypto.randomUUID();
    vi.mocked(getVercelOidcToken).mockResolvedValue("test");
    const send = vi.fn(); vi.stubGlobal("fetch", send);
    for (const response of [new Response(null, {status:409}), new Response(null, {status:204}), new Response(null, {status:204, headers:{"x-ocr-reservation":"other"}})]) {
      send.mockResolvedValueOnce(response);
      await expect(reserveBeforeProductionScan(id)).rejects.toThrow("paused");
    }
    send.mockResolvedValueOnce(new Response(null, {status:204, headers:{"x-ocr-reservation":id}}));
    await expect(reserveBeforeProductionScan(id)).resolves.toBeUndefined();
  });
});
