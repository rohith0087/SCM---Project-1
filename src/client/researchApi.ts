export async function researchApi<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${url}`, body === undefined ? undefined : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) throw new Error(`The local API is unavailable (${response.status}). Check the server and retry.`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status})`);
  return data;
}
