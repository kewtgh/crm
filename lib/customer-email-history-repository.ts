import { databaseJson } from "./db/gateway";
import { emailHistoryFilters, type EmailHistoryFilters, type EmailHistoryResult } from "./customer-email-history";

export async function loadCustomerEmailHistory(input: Partial<EmailHistoryFilters> = {}, read = databaseJson) {
  const filters = emailHistoryFilters.parse(input);
  return read<EmailHistoryResult>("/db/rpc/customer_email_history_page", {
    method: "POST",
    body: JSON.stringify({ search_term: filters.q, message_purpose: filters.purpose, delivery_state: filters.status, page_number: filters.page, requested_page_size: filters.pageSize }),
  });
}
