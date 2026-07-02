const tokenEndpoint = "https://pugotilab.com/auth/oauth/token";

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ status: "ok" });
    }

    if (request.method !== "POST" || url.pathname !== "/oauth/token") {
      return new Response("Not found", { status: 404 });
    }

    const upstreamRequest = new Request(tokenEndpoint, request);
    const upstreamResponse = await fetch(upstreamRequest);
    const headers = new Headers(upstreamResponse.headers);
    headers.set("cache-control", "no-store");

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers
    });
  }
};
