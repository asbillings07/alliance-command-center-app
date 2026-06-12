// Number	Display	Number	Display
// 850      -> 850
// 12,500   -> 12.5K
// 8,200,000 -> 8.2M
// 3,100,000,000 -> 3.1G
// 1,400,000,000,000 -> 1.4T

export function formatPower(power: number) {
  const powerInThousands = power / 1000;
  const powerInMillions = power / 1000000;
  const powerInBillions = power / 1000000000;
  const powerInTrillions = power / 1000000000000;

  if (power < 1000) {
    return power.toLocaleString();
  }
  if (power < 1000000) {
    return powerInThousands.toFixed(1) + "K";
  }
  if (power < 1000000000) {
    return powerInMillions.toFixed(1) + "M";
  }
  if (power < 1000000000000) {
    return powerInBillions.toFixed(1) + "G";
  }
  return powerInTrillions.toFixed(1) + "T";
}
