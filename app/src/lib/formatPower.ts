// Number	Display
// 850      -> 850
// 12,500   -> 12.5K
// 999,950  -> 1M (not 1000.0K)
// 8,200,000 -> 8.2M
// 1,000,000 -> 1M (not 1.0M)
// 3,100,000,000 -> 3.1G
// 1,400,000,000,000 -> 1.4T

export function formatPower(power: number) {
  const sign = power < 0 ? "-" : "";
  const abs = Math.abs(power);

  const formatValue = (value: number, suffix: string): string => {
    const rounded = Math.round(value * 10) / 10;
    if (rounded === Math.floor(rounded)) {
      return sign + rounded.toFixed(0) + suffix;
    }
    return sign + rounded.toFixed(1) + suffix;
  };

  const powerInThousands = abs / 1000;
  const powerInMillions = abs / 1000000;
  const powerInBillions = abs / 1000000000;
  const powerInTrillions = abs / 1000000000000;

  if (abs < 1000) {
    return sign + String(abs);
  }
  if (
    powerInThousands < 1000 &&
    Math.round(powerInThousands * 10) / 10 < 1000
  ) {
    return formatValue(powerInThousands, "K");
  }
  if (powerInMillions < 1000 && Math.round(powerInMillions * 10) / 10 < 1000) {
    return formatValue(powerInMillions, "M");
  }
  if (powerInBillions < 1000 && Math.round(powerInBillions * 10) / 10 < 1000) {
    return formatValue(powerInBillions, "G");
  }
  return formatValue(powerInTrillions, "T");
}
