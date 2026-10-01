export const CUSTOMER_EMAIL_TEMPLATES = ["FOLLOW_UP","MEETING","PROGRAM"] as const;
export type CustomerEmailTemplate=typeof CUSTOMER_EMAIL_TEMPLATES[number];
export function renderCustomerEmail(template:CustomerEmailTemplate,locale:"zh-CN"|"en",name:string,owner:string){
  const zh=locale==="zh-CN";
  const contents={
    FOLLOW_UP:{purpose:"SERVICE",subject:zh?"客户服务跟进":"Customer service follow-up",body:zh?`${name}，您好！\n\n我是您的对接人${owner}。想了解目前的服务体验，以及是否有需要我们协助的事项。欢迎回复本邮件告知您的需求。\n\n${owner}`:`Hello ${name},\n\nI am your contact, ${owner}. How is your service experience? Please reply with any questions or support needs.\n\n${owner}`},
    MEETING:{purpose:"SERVICE",subject:zh?"沟通时间确认":"Arrange a conversation",body:zh?`${name}，您好！\n\n我是${owner}。我们希望安排一次沟通，了解您的目标并确认下一步。请回复您方便的时间，我们会再确认具体安排。\n\n${owner}`:`Hello ${name},\n\nI am ${owner}. We would like to discuss your goals and agree on next steps. Please reply with a convenient time; we will confirm the arrangement.\n\n${owner}`},
    PROGRAM:{purpose:"MARKETING",subject:zh?"课程与项目咨询":"Program information",body:zh?`${name}，您好！\n\n我是${owner}。如果您希望了解我们的课程或项目，请回复您的兴趣方向，我们将提供相关资料。\n\n如不希望再收到此类信息，请回复退订。\n\n${owner}`:`Hello ${name},\n\nI am ${owner}. If you would like information about our programs, please reply with your areas of interest.\n\nTo stop these messages, reply to unsubscribe.\n\n${owner}`},
  };
  return contents[template];
}
