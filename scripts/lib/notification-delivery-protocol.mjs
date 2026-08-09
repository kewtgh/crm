export const STAFF_ACCOUNT_CREATED_TEMPLATE = "staff-account-created";

export const STAFF_ACCOUNT_CREATED_EXTERNAL_FIELDS = Object.freeze([
  "username",
  "temporaryPassword",
  "loginUrl",
  "displayNameZh",
  "displayNameEn",
  "mustChangePassword",
  "mfaRequired",
]);

export function notificationInvitationDeliveryId(templateKey, persistedPayload) {
  return templateKey === STAFF_ACCOUNT_CREATED_TEMPLATE
    ? persistedPayload?.invitationDeliveryId ?? null
    : null;
}

export function externalNotificationPayload(templateKey, persistedPayload, {
  decryptCredential,
} = {}) {
  if (templateKey !== STAFF_ACCOUNT_CREATED_TEMPLATE) return persistedPayload;
  if (typeof decryptCredential !== "function") {
    throw new Error("INVITATION_CREDENTIAL_DECRYPTOR_REQUIRED");
  }

  const temporaryPassword = decryptCredential(persistedPayload?.encryptedTemporaryPassword);
  return {
    username:persistedPayload?.username,
    temporaryPassword,
    loginUrl:persistedPayload?.loginUrl,
    displayNameZh:persistedPayload?.displayNameZh,
    displayNameEn:persistedPayload?.displayNameEn,
    mustChangePassword:persistedPayload?.mustChangePassword,
    mfaRequired:persistedPayload?.mfaRequired,
  };
}
