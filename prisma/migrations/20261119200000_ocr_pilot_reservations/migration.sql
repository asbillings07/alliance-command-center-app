-- Opaque one-use receipts. This table contains no customer or screenshot data.
CREATE TABLE "OcrPilotReservation" (
  id UUID PRIMARY KEY,
  "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
