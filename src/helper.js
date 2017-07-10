export function futureDate() {
  const cacheDate = new Date();
  cacheDate.setFullYear(cacheDate.getFullYear() + 10);
  return cacheDate;
}

export function areAllDefined(values) {
  const reducer = (val, e) => val && e !== undefined;
  return values.reduce(reducer, true);
}

export function roundedRatio(nominator, denominator) {
  return (Math.round(nominator * 100 / denominator) / 100) || 0;
}
