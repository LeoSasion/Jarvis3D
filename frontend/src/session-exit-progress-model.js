export function getSessionExitProgress(phase, nativeTaskbarVerified) {
  if (!phase || phase === "idle") return null;
  if (phase === "verified" && nativeTaskbarVerified === true) {
    return {
      phase: "verified",
      titleKey: "session.exit.verified",
      detailKey: "session.exit.verifiedDetail",
      verificationKey: "session.exit.verificationVerified",
    };
  }
  if (phase === "restoring" || phase === "verified") {
    return {
      phase: "restoring",
      titleKey: "session.exit.restoring",
      detailKey: "session.exit.restoringDetail",
      verificationKey: "session.exit.verificationRetrying",
    };
  }
  return {
    phase: "requested",
    titleKey: "session.exit.requesting",
    detailKey: "session.exit.requestingDetail",
    verificationKey: "session.exit.verificationPending",
  };
}
