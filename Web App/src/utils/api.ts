import axios from "axios";
import { config } from "./config.ts";
import { validateStreamUrl } from "./protocol.ts";

const apiClient = axios.create({
  baseURL: config.defaultApiUrl,
  timeout: config.connectionTimeoutMs,
  headers: { Accept: "application/json" },
});

export const getApiBaseUrl = (streamUrl: string): string => {
  const url = new URL(validateStreamUrl(streamUrl, "http:"));
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  url.pathname = "/api";
  url.search = "";

  return url.href;
};

export const checkServiceHealth = async (streamUrl: string, signal: AbortSignal): Promise<void> => {
  const response = await apiClient.get<unknown>("health/", {
    baseURL: getApiBaseUrl(streamUrl),
    signal,
  });
  const data = response.data;

  if (response.status !== 200 || !data || typeof data !== "object" || !("status" in data) || data.status !== "ok") {
    throw new Error("The CV service is not healthy.");
  }
};

export default apiClient;
