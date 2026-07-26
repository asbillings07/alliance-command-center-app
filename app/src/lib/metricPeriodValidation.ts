export type MetricPeriodFieldInput = {
  name: string;
  startsAt: string | null;
  endsAt: string | null;
};

export type ValidatedMetricPeriodFields = {
  name: string;
  startsAt: Date | null;
  endsAt: Date | null;
};

function parseOptionalDateString(value: string | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

/**
 * Strict validation for programmatic period creation (e.g. multi-period import).
 * Rejects empty names and invalid date strings.
 */
export function validateMetricPeriodFields(
  input: MetricPeriodFieldInput,
): ValidatedMetricPeriodFields {
  const name = input.name?.trim();
  if (!name) {
    throw new Error("Name is required");
  }

  const startsAt = parseOptionalDateString(input.startsAt);
  const endsAt = parseOptionalDateString(input.endsAt);

  if (input.startsAt && startsAt === null) {
    throw new Error("Invalid start date");
  }
  if (input.endsAt && endsAt === null) {
    throw new Error("Invalid end date");
  }

  return { name, startsAt, endsAt };
}

export function normalizeMetricPeriodName(name: string): string {
  return name.trim().toLowerCase();
}
