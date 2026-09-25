export function isIOS(userAgent: string, platform: string, touchPoints: number) {
  return /iPad|iPhone|iPod/.test(userAgent) || (platform === 'MacIntel' && touchPoints > 1);
}
export function shouldOfferInstall(standalone: boolean, dismissedUntil: number, now: number) {
  return !standalone && dismissedUntil <= now;
}
export function canApplyUpdate(pending: number, dirty: boolean) {
  return pending === 0 && !dirty;
}
