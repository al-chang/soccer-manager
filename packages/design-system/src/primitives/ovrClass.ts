/** Map an overall rating to its tiered badge class (elite/good/decent/poor). */
export function ovrClass(ovr: number): string {
  if (ovr >= 75) return 'ovr elite';
  if (ovr >= 65) return 'ovr good';
  if (ovr >= 55) return 'ovr decent';
  return 'ovr poor';
}
