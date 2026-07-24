import { prisma } from "./prisma";
import { normalizeEmail } from "./email/normalize";

/**
 * Access Request domain service.
 *
 * An access request captures a prospective user's interest in the beta. It is
 * intentionally NOT part of the invitation model: expressing interest is a
 * separate workflow from being invited. An administrator later reviews requests
 * and issues invitations through the existing invitation flow.
 *
 * Kept deliberately minimal for beta — persistence only, no status/approval
 * workflow. Those can be added later without reshaping this service.
 */

export type CreateAccessRequestInput = {
  name: string;
  email: string;
  allianceName?: string | null;
  message?: string | null;
};

export type AccessRequestRecord = {
  id: string;
  name: string;
  email: string;
  allianceName: string | null;
  message: string | null;
  createdAt: Date;
};

/** Normalize an optional free-text field: trim, and treat empty as absent. */
function optionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Persist a beta access request. The caller is responsible for validating and
 * normalizing required fields (name, email); this service applies light
 * normalization to the optional fields and stores the record.
 */
export async function createAccessRequest(
  input: CreateAccessRequestInput
): Promise<AccessRequestRecord> {
  return prisma.accessRequest.create({
    data: {
      name: input.name.trim(),
      email: normalizeEmail(input.email),
      allianceName: optionalText(input.allianceName),
      message: optionalText(input.message),
    },
  });
}
