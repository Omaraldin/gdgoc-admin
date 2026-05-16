import axios from "axios";

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8080/api/v1";

export const apiClient = axios.create({
  baseURL: BASE_URL,
  withCredentials: true, // session + refresh_token cookies
  headers: {
    "Content-Type": "application/json",
  },
});

// Token-refresh state shared across concurrent requests.
let isRefreshing = false;
let pendingQueue: Array<{ resolve: () => void; reject: (e: unknown) => void }> = [];

function flushQueue(error: unknown) {
  pendingQueue.forEach((p) => (error ? p.reject(error) : p.resolve()));
  pendingQueue = [];
}

apiClient.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;

    // Only attempt a refresh for 401s on non-refresh/non-login requests.
    if (
      axios.isAxiosError(error) &&
      error.response?.status === 401 &&
      !original._retry &&
      !original.url?.includes("/auth/refresh") &&
      !original.url?.includes("/auth/login")
    ) {
      if (isRefreshing) {
        // Queue this request until the ongoing refresh completes.
        return new Promise((resolve, reject) => {
          pendingQueue.push({ resolve: () => resolve(apiClient(original)), reject });
        });
      }

      original._retry = true;
      isRefreshing = true;

      try {
        await apiClient.post("/auth/refresh");
        flushQueue(null);
        return apiClient(original);
      } catch (refreshError) {
        flushQueue(refreshError);
        if (typeof window !== "undefined" && !window.location.pathname.startsWith("/auth") && window.location.pathname !== "/unauthorized") {
          window.location.replace("/auth/login");
        }
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    // 403 = authenticated but forbidden → redirect to the unauthorized page.
    if (
      axios.isAxiosError(error) &&
      error.response?.status === 403 &&
      typeof window !== "undefined" &&
      window.location.pathname !== "/unauthorized"
    ) {
      window.location.replace("/unauthorized");
    }

    return Promise.reject(error);
  },
);
