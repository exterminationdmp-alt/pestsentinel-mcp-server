import axios, { AxiosError } from "axios";
import { SUPABASE_URL } from "../constants.js";

function getApiKey(): string {
  const key = process.env.SUPABASE_ANON_KEY;
  if (!key) {
    throw new Error(
      "SUPABASE_ANON_KEY environment variable is required. " +
      "Get your key from the Pest Sentinel dashboard or contact support@pestsentinel.ai"
    );
  }
  return key;
}

export async function supabaseQuery<T>(
  table: string,
  params: Record<string, string> = {}
): Promise<T[]> {
  const key = getApiKey();
  const url = `${SUPABASE_URL}/rest/v1/${table}`;

  try {
    const response = await axios.get<T[]>(url, {
      params: { ...params },
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      timeout: 15000,
    });
    return response.data;
  } catch (error) {
    throw handleSupabaseError(error);
  }
}

export async function supabaseRpc<T>(
  fn: string,
  body: Record<string, unknown> = {}
): Promise<T> {
  const key = getApiKey();
  const url = `${SUPABASE_URL}/rest/v1/rpc/${fn}`;

  try {
    const response = await axios.post<T>(url, body, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      timeout: 15000,
    });
    return response.data;
  } catch (error) {
    throw handleSupabaseError(error);
  }
}

function handleSupabaseError(error: unknown): Error {
  if (error instanceof AxiosError) {
    if (error.response?.status === 401) {
      return new Error("Invalid API key. Check your SUPABASE_ANON_KEY environment variable.");
    }
    if (error.response?.status === 429) {
      return new Error("Rate limit exceeded. Please wait before making more requests.");
    }
    if (error.code === "ECONNABORTED") {
      return new Error("Request timed out. The Pest Sentinel API may be temporarily unavailable.");
    }
    const msg = (error.response?.data as { message?: string })?.message;
    if (msg) return new Error(msg);
  }
  return new Error(error instanceof Error ? error.message : String(error));
}
