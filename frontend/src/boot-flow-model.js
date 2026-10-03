export function shouldShowFirstRunGuide({ isNative, reviewOnly, guideSeen }) {
  return isNative && !reviewOnly && !guideSeen;
}

export function shouldRememberFirstRunGuide(guideStep) {
  return Number.isInteger(guideStep) && guideStep >= 0 && guideStep < 3;
}
