export const API_URL = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:4000/api";
export const SOCKET_URL = import.meta.env.VITE_SOCKET_URL ?? "http://127.0.0.1:4000";

export async function apiFetch(path, { method = "GET", token, body } = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const payload = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    throw new Error(payload?.error ?? "Request failed.");
  }

  return payload;
}
