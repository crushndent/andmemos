/** A tiny client for the two Memos endpoints the extension needs. */

export class ApiError extends Error {
  constructor(message, { status } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request(settings, path, { method = "GET", body } = {}, fetchImpl = globalThis.fetch) {
  let response;
  try {
    response = await fetchImpl(`${settings.serverUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${settings.token}`,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(`Could not reach ${settings.serverUrl}. Check the address and that the server is running.`);
  }

  if (response.ok) return response.json();

  if (response.status === 401 || response.status === 403) {
    throw new ApiError("The server rejected the access token. Create a new one in Memos and paste it in the options.", { status: response.status });
  }
  let detail = "";
  try {
    detail = (await response.json())?.message ?? "";
  } catch {
    // The body was not JSON; the status is all we have.
  }
  throw new ApiError(detail || `The server answered ${response.status}.`, { status: response.status });
}

/** Checks the address and token; resolves to the signed-in username. */
export async function testConnection(settings, fetchImpl) {
  const result = await request(settings, "/api/v1/auth/me", {}, fetchImpl);
  return result?.user?.username ?? result?.user?.name ?? "";
}

/** Creates a memo and resolves to the created memo (with its `name`, e.g. `memos/abc`). */
export function createMemo(settings, { content, visibility }, fetchImpl) {
  return request(settings, "/api/v1/memos", { method: "POST", body: { content, visibility } }, fetchImpl);
}
