const assert = require("assert");
const Module = require("module");
const originalLoad = Module._load;
const originalFetch = global.fetch;
const calls = [];
let reply = { ok: true, status: 200, body: { user: { id: "pending" } } };
Module._load = function (name) {
  if (name === "electron") return {};
  return originalLoad.apply(this, arguments);
};
global.fetch = async (url, options) => {
  calls.push({ url, options, body: JSON.parse(options.body) });
  return {
    ok: reply.ok,
    status: reply.status,
    text: async () => JSON.stringify(reply.body),
  };
};
const cloud = require("../src/main/cloud-sync");
const input = {
  url: " https://example.supabase.co/ ",
  key: " public-key ",
  email: " user@example.com ",
  password: "password123",
  signup: true,
};
(async () => {
  try {
    let result = await cloud.login(input);
    assert(!result.error);
    assert(result.message.includes("localhost"));
    assert(result.message.includes("请求已提交"));
    assert.equal(calls[0].url, "https://example.supabase.co/auth/v1/signup");
    assert.equal(calls[0].body.email, "user@example.com");
    assert.equal(calls[0].body.password, input.password);
    assert.equal(calls[0].options.headers.apikey, "public-key");
    assert(
      !cloud.getStatus().email,
      "unconfirmed signup must not create a login session",
    );
    for (const [code, message] of [
      ["email_not_confirmed", "邮箱尚未确认"],
      ["invalid_credentials", "邮箱或密码不正确"],
      ["over_email_send_rate_limit", "发送太频繁"],
      ["email_address_not_authorized", "自定义 SMTP"],
    ]) {
      reply = { ok: false, status: 400, body: { error_code: code } };
      result = await cloud.login({ ...input, signup: false });
      assert(result.error);
      assert(result.message.includes(message));
    }
    reply = { ok: true, status: 200, body: {} };
    result = await cloud.resendConfirmation(input);
    assert(!result.error);
    const sent = calls.at(-1);
    assert(sent.url.endsWith("/auth/v1/resend"));
    assert.deepEqual(sent.body, { type: "signup", email: "user@example.com" });
    assert(!sent.options.headers.Authorization);
    const before = calls.length;
    for (const override of [
      { url: "broken" },
      { email: "invalid" },
      { password: "123" },
      { key: " " },
    ]) {
      result = await cloud.login({ ...input, ...override });
      assert(result.error);
    }
    assert.equal(calls.length, before, "invalid input must not reach server");
    reply = {
      ok: false,
      status: 429,
      body: { error_code: "over_email_send_rate_limit" },
    };
    result = await cloud.resendConfirmation(input);
    assert(result.error && result.message.includes("发送太频繁"));
    console.log(
      "Cloud auth checks passed: signup pending confirmation, normalized input, specific errors, resend and validation.",
    );
  } finally {
    Module._load = originalLoad;
    global.fetch = originalFetch;
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
