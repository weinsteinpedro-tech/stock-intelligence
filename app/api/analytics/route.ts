import { createAnalyticsPostHandler } from "@/lib/application/analytics-handler";

export const runtime = "nodejs";

export const POST = createAnalyticsPostHandler();

export { createAnalyticsPostHandler };
