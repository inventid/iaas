export function futureDate() {
  const cacheDate = new Date();
  cacheDate.setFullYear(cacheDate.getFullYear() + 10);
  return cacheDate;
}
