const apiBaseUrl = process.env.PUGOTITASKS_API_URL || "http://pugotitasks:3010/api/integrations/v1";

async function request(accessToken, pathname, options = {}) {
  const response = await fetch(`${apiBaseUrl}${pathname}`, {
    ...options,
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      ...options.headers
    },
    signal: AbortSignal.timeout(5000)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || `Pugotitasks respondeu com HTTP ${response.status}.`);
    error.status = response.status;
    throw error;
  }
  return body;
}

function getTasks(accessToken, filter) {
  return request(accessToken, `/tasks?filter=${encodeURIComponent(filter)}&limit=50`);
}

function createTask(accessToken, input) {
  return request(accessToken, "/tasks", { method: "POST", body: JSON.stringify(input) });
}

function completeTask(accessToken, taskId) {
  return request(accessToken, `/tasks/${encodeURIComponent(taskId)}/complete`, { method: "POST" });
}

module.exports = { request, getTasks, createTask, completeTask };
