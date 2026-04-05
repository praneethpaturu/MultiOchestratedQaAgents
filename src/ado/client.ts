import axios, { AxiosInstance, AxiosError } from "axios";
import { config } from "../config/index.js";
import { agentLogger } from "../utils/logger.js";

const log = agentLogger("ADO");

let clientInstance: AxiosInstance | null = null;

export function getAdoClient(): AxiosInstance {
  if (!clientInstance) {
    const token = config.ado.token;
    if (!token) {
      throw new Error("ADO_TOKEN is not set. Configure it in .env");
    }

    clientInstance = axios.create({
      baseURL: config.ado.apiBase,
      headers: {
        "Content-Type": "application/json-patch+json",
        Authorization: `Basic ${Buffer.from(`:${token}`).toString("base64")}`,
      },
      params: {
        "api-version": config.ado.apiVersion,
      },
    });

    clientInstance.interceptors.response.use(
      (res) => res,
      (error: AxiosError) => {
        const status = error.response?.status;
        const data = error.response?.data;
        log.error(`ADO API error: ${status} - ${JSON.stringify(data)}`);
        throw error;
      }
    );
  }
  return clientInstance;
}
