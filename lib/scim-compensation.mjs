export function compensatedScimVersion(writtenVersion) {
  if (!Number.isSafeInteger(writtenVersion) || writtenVersion < 1 || writtenVersion >= Number.MAX_SAFE_INTEGER) {
    const error = new Error("SCIM compensation version is invalid");
    error.code = "IDENTITY_COMPENSATION_REQUIRED";
    throw error;
  }
  return writtenVersion + 1;
}
