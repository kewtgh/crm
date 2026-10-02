export const CUSTOMER_EMAIL_TEMPLATES = ["FOLLOW_UP","FOLLOW_UP_2","MEETING","MEETING_2","PROGRAM","PROGRAM_2"] as const;
export type CustomerEmailTemplate=typeof CUSTOMER_EMAIL_TEMPLATES[number]|"CUSTOM";
export type CustomEmailContent={subjectZh:string;subjectEn:string;bodyZh:string;bodyEn:string;purpose:"SERVICE"|"MARKETING"};
export type SavedEmailTemplate=CustomEmailContent&{id:string;name:string};
export function replaceEmailVariables(text:string,name:string,owner:string){return text.replace(/\{\{\s*(name|owner)\s*\}\}/g,(_,key:string)=>key==="name"?name:owner);}
export function renderCustomerEmail(template:CustomerEmailTemplate,locale:"zh-CN"|"en",name:string,owner:string,custom?:CustomEmailContent){
  const zh=locale==="zh-CN";
  if(template==="CUSTOM"){
    if(!custom)throw new Error("EMAIL_TEMPLATE_REQUIRED");
    const subject=zh?custom.subjectZh||custom.subjectEn:custom.subjectEn||custom.subjectZh;
    const body=zh?custom.bodyZh||custom.bodyEn:custom.bodyEn||custom.bodyZh;
    return{purpose:custom.purpose,subject:replaceEmailVariables(subject,name,owner).replace(/[\r\n]+/g," "),body:replaceEmailVariables(body,name,owner)};
  }
  const contents={
    FOLLOW_UP:{purpose:"SERVICE",subject:zh?"客户服务跟进":"Customer service follow-up",body:zh?`${name}，您好！\n\n我是您的对接人${owner}。想了解目前的服务体验，以及是否有需要我们协助的事项。欢迎回复本邮件告知您的需求。\n\n${owner}`:`Hello ${name},\n\nI am your contact, ${owner}. How is your service experience? Please reply with any questions or support needs.\n\n${owner}`},
    MEETING:{purpose:"SERVICE",subject:zh?"沟通时间确认":"Arrange a conversation",body:zh?`${name}，您好！\n\n我是${owner}。我们希望安排一次沟通，了解您的目标并确认下一步。请回复您方便的时间，我们会再确认具体安排。\n\n${owner}`:`Hello ${name},\n\nI am ${owner}. We would like to discuss your goals and agree on next steps. Please reply with a convenient time; we will confirm the arrangement.\n\n${owner}`},
    PROGRAM:{purpose:"MARKETING",subject:zh?"课程与项目咨询":"Program information",body:zh?`${name}，您好！\n\n我是${owner}。如果您希望了解我们的课程或项目，请回复您的兴趣方向，我们将提供相关资料。\n\n如不希望再收到此类信息，请回复退订。\n\n${owner}`:`Hello ${name},\n\nI am ${owner}. If you would like information about our programs, please reply with your areas of interest.\n\nTo stop these messages, reply to unsubscribe.\n\n${owner}`},
    FOLLOW_UP_2:{purpose:"SERVICE",subject:zh?"服务进度与下一步确认":"Service progress and next steps",body:zh?`${name}，您好！\n\n我是${owner}，想与您确认目前的服务进度。您近期是否遇到困难，或有希望优先解决的问题？请回复您的反馈，我们将一起确认下一步。\n\n${owner}`:`Hello ${name},\n\nThis is ${owner}, checking on your service progress. Have you encountered any difficulties or priorities we should address? Please share your feedback so we can agree on the next steps.\n\n${owner}`},
    MEETING_2:{purpose:"SERVICE",subject:zh?"沟通议题与时间安排":"Conversation topics and availability",body:zh?`${name}，您好！\n\n我是${owner}。希望与您交流近期需求、已有进展及后续安排。请告诉我您希望讨论的议题和方便沟通的时间段；具体时间将在您回复后确认。\n\n${owner}`:`Hello ${name},\n\nI am ${owner}. Let us discuss your current needs, progress and future arrangements. Please share your preferred topics and available time slots; we will confirm the appointment after your reply.\n\n${owner}`},
    PROGRAM_2:{purpose:"MARKETING",subject:zh?"为您提供适合的学习方案":"Explore a suitable learning program",body:zh?`${name}，您好！\n\n我是${owner}。如果您正在考虑新的学习计划，欢迎回复学习目标、年级和方便的时间。我们会据此提供适合的课程资料，供您自主选择。\n\n如不希望再收到课程信息，请回复退订。\n\n${owner}`:`Hello ${name},\n\nI am ${owner}. If you are considering a new learning plan, please share your goals, grade and availability. We will suggest relevant program information for you to consider.\n\nTo stop receiving program information, reply to unsubscribe.\n\n${owner}`},
  };
  return contents[template];
}
