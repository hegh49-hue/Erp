/**
 * The "business day" a given instant belongs to: any time before
 * startHour:00 counts toward the previous calendar day, so a shift that
 * runs past midnight stays on one business day. Computed in UTC — the
 * same convention already used everywhere else in this backend for
 * "today" (e.g. entryDate defaults via toISOString().slice(0,10)).
 */
function computeBusinessDate(instant, startHour) {
  const shifted = new Date(instant.getTime() - Number(startHour) * 3600 * 1000);
  return shifted.toISOString().slice(0, 10);
}

module.exports = { computeBusinessDate };
