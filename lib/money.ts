/**
 * Currency conversion & formatting utilities operating exclusively on BigInt paise.
 */

/** Converts rupee input (string like "200000.50" or number) to BigInt paise (20000050n) */
export function toPaise(rupees: number | string): bigint {
  const str = typeof rupees === 'number' ? rupees.toFixed(2) : String(rupees).trim();
  if (!str || isNaN(Number(str))) {
    throw new Error(`Invalid rupee amount: ${rupees}`);
  }
  const isNegative = str.startsWith('-');
  const cleanStr = isNegative ? str.slice(1) : str;
  const parts = cleanStr.split('.');
  const wholeStr = parts[0] || '0';
  let decimalStr = parts[1] || '00';
  if (decimalStr.length === 1) decimalStr += '0';
  else if (decimalStr.length > 2) decimalStr = decimalStr.slice(0, 2);

  const val = BigInt(wholeStr) * 100n + BigInt(decimalStr);
  return isNegative ? -val : val;
}

/** Formats BigInt paise back to standard decimal string e.g. 20000050n -> "200000.50" */
export function toRupeesString(paise: bigint): string {
  const isNegative = paise < 0n;
  const abs = isNegative ? -paise : paise;
  const whole = abs / 100n;
  const fraction = abs % 100n;
  const fractionStr = fraction < 10n ? `0${fraction}` : `${fraction}`;
  return `${isNegative ? '-' : ''}${whole.toString()}.${fractionStr}`;
}

/** Formats BigInt paise to Indian Rupee formatted string e.g. 20000000n -> "2,00,000.00" */
export function formatINR(paise: bigint): string {
  const rupeesString = toRupeesString(paise);
  const [whole, decimal] = rupeesString.split('.');
  const isNeg = whole.startsWith('-');
  const absWhole = isNeg ? whole.slice(1) : whole;

  let lastThree = absWhole.slice(-3);
  const otherNumbers = absWhole.slice(0, -3);
  if (otherNumbers !== '') {
    lastThree = ',' + lastThree;
  }
  const formattedWhole = otherNumbers.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + lastThree;
  return `${isNeg ? '-' : ''}${formattedWhole}.${decimal}`;
}
