import assert from "node:assert/strict";
import test from "node:test";
import worker from "./index.js";

test("responde ao health check", async () => {
  const response = await worker.fetch(new Request("https://worker.test/health"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
});

test("rejeita rotas que não sejam o token OAuth", async () => {
  const response = await worker.fetch(new Request("https://worker.test/"));
  assert.equal(response.status, 404);
});

test("encaminha a autorização para a tela PugotiLab", async () => {
  const response = await worker.fetch(new Request(
    "https://worker.test/oauth/authorize?client_id=example&state=opaque"
  ));
  assert.equal(response.status, 302);
  assert.equal(
    response.headers.get("location"),
    "https://pugotilab.com/auth/oauth/authorize?client_id=example&state=opaque"
  );
});

test("encaminha o token OAuth sem remover autenticação ou corpo", async () => {
  const originalFetch = globalThis.fetch;
  let forwardedRequest;
  globalThis.fetch = async (request) => {
    forwardedRequest = request;
    return Response.json({ error: "invalid_client" }, { status: 401 });
  };

  try {
    const response = await worker.fetch(new Request("https://worker.test/oauth/token", {
      method: "POST",
      headers: {
        authorization: "Basic example",
        "content-type": "application/x-www-form-urlencoded"
      },
      body: "grant_type=authorization_code&code=example"
    }));

    assert.equal(response.status, 401);
    assert.equal(forwardedRequest.url, "https://pugotilab.com/auth/oauth/token");
    assert.equal(forwardedRequest.headers.get("authorization"), "Basic example");
    assert.equal(await forwardedRequest.text(), "grant_type=authorization_code&code=example");
    assert.equal(response.headers.get("cache-control"), "no-store");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
