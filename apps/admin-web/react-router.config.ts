import type { Config } from "@react-router/dev/config";

export default {
  ssr: false, // SPA mode — all auth/data fetched client-side
  appDirectory: "app",
} satisfies Config;
