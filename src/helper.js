export function futureDate() {
  const cacheDate = new Date();
  cacheDate.setMonth(cacheDate.getMonth() + 1);
  return cacheDate;
}

export function areAllDefined(values) {
  const reducer = (val, e) => val && e !== undefined;
  return values.reduce(reducer, true);
}
