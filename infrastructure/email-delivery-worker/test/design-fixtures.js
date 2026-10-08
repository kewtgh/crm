// Independently fictional rendering fixtures. Never use operational credentials.
export const applicationUrl = "https://crm.example.test";
const appointment = {title_zh:"示例咨询", title_en:"Fictional consultation", starts_at:"2026-01-01T09:00:00Z", ends_at:"2026-01-01T10:00:00Z", channel:"Video", related_label:"Fictional Organization", status:"SCHEDULED"};
export const designFixtures = {
  reminder:{reminderId:"fictional-reminder",timezone:"Asia/Taipei"},
  "password-reset":{url:`${applicationUrl}/reset-password?token=fictional-render-only`,expiresInSeconds:1800},
  "email-verification":{url:`${applicationUrl}/verify?token=fictional-render-only`,expiresInSeconds:86400},
  "device-verification":{code:"000000",expiresInSeconds:600},
  "staff-account-created":{username:"fictional."+"long".repeat(28),temporaryPassword:"RENDER_ONLY_NOT_A_CREDENTIAL_".repeat(8),loginUrl:`${applicationUrl}/login`,displayNameZh:"示例员工",displayNameEn:"Fictional Staff",mustChangePassword:true,mfaRequired:true},
  "communication-message":{subject:"Fictional follow-up",body:"A fictional service message.\n第二段示例内容。",recipientName:"Fictional Recipient"},
  "calendar-invite":{eventVersion:1,attendeeName:"Fictional Recipient",appointment},
  "calendar-update":{eventVersion:2,attendeeName:"Fictional Recipient",appointment},
  "calendar-cancel":{eventVersion:3,attendeeName:"Fictional Recipient",appointment:{...appointment,status:"CANCELLED"}},
};
