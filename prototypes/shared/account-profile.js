// A suggested greeting only; the account holder can correct it.
export function firstName(user) {
  const chosen = user?.firstName?.trim();
  if (chosen) return chosen;
  const name = (user?.name || "").trim().replace(/^(?:mr|mrs|ms|miss|mx|dr|prof)\.?\s+/i, "");
  return name.split(/\s+/)[0] || "";
}
