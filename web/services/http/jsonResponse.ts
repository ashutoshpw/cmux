/** Shared JSON response boundary without auth, billing or VM service dependencies. */
export function jsonResponse(
  data: unknown,
  status = 200,
  headers: Readonly<Record<string, string>> = {},
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}
