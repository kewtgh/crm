import {ApiError} from "./api";
import {DatabaseRequestError} from "./db/gateway";
export function workflowApiError(error:unknown):never{if(error instanceof DatabaseRequestError){const code=error.code;throw new ApiError(code,code.endsWith("FORBIDDEN")?403:code==="WORKFLOW_NOT_FOUND"?404:code.endsWith("CONFLICT")||["WORKFLOW_TEMPLATE_USED","WORKFLOW_TEMPLATE_IMMUTABLE","WORKFLOW_PARENT_IMMUTABLE"].includes(code)?409:400);}throw error;}
