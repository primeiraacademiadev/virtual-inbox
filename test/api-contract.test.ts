import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createOpenApiDocument, matchApiOperation, operations, schemas } from "../src/http/api-contract.js";

test("every documented operation has exactly one route and a server handler", () => {
  const source = readFileSync(new URL("../src/server.ts", import.meta.url), "utf8");
  const handlers = new Set([...source.matchAll(/^\s*case "([a-zA-Z]+)":/gm)].map((match) => match[1]));
  const identifiers = new Set(operations.map((operation) => operation.id));
  assert.equal(identifiers.size, operations.length);
  assert.deepEqual([...identifiers].sort(), [...handlers].sort());
  const routes = operations.map((operation) => `${operation.audience}:${operation.method}:${operation.path}`);
  assert.equal(new Set(routes).size, routes.length);
});

test("route matcher separates management, demo and exact resource paths", () => {
  assert.equal(matchApiOperation("GET", ["health"], "management")?.operation.id, "health");
  assert.equal(matchApiOperation("GET", ["health", "extra"], "management"), null);
  assert.equal(matchApiOperation("POST", ["sms", "messages"], "management"), null);
  assert.equal(matchApiOperation("POST", ["sms", "messages"], "demo")?.operation.id, "sendSms");
  const match = matchApiOperation("GET", ["mailboxes", "one", "messages", "two", "attachments", "three"], "management");
  assert.equal(match?.operation.id, "emailAttachment");
  assert.deepEqual(match?.params, { inboxId: "one", messageId: "two", attachmentId: "three" });
});

test("OpenAPI is deterministic and all local schema references resolve", () => {
  const document = createOpenApiDocument();
  assert.equal(document.openapi, "3.1.0");
  assert.equal(JSON.stringify(document), JSON.stringify(createOpenApiDocument()));
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (typeof record.$ref === "string") {
      const name = record.$ref.replace("#/components/schemas/", "");
      assert.ok(Object.hasOwn(schemas, name), record.$ref);
    }
    Object.values(record).forEach(visit);
  };
  visit(document);
});

test("demo routes are excluded from the main contract and admin writes declare security", () => {
  const main = createOpenApiDocument();
  const demo = createOpenApiDocument("demo");
  assert.equal(main.paths["/sms/messages"], undefined);
  assert.ok(demo.paths["/sms/messages"]);
  const put = main.paths["/admin/tls"].put as { security: unknown; requestBody: unknown };
  assert.deepEqual(put.security, [{ adminToken: [] }]);
  assert.ok(put.requestBody);
  const wait = main.paths["/mailboxes/{inboxId}/wait-for-message"].post as { responses: Record<string, unknown> };
  assert.ok(wait.responses[200]);
  assert.ok(wait.responses[204]);
});


test("SMTP observation uses no administrative security while verification and writes remain protected", () => {
  const main = createOpenApiDocument();
  const get = (path: string) => main.paths[path].get as { security: unknown };
  const post = (path: string) => main.paths[path].post as { security: unknown };
  assert.deepEqual(get("/admin/smtp/attempts").security, []);
  assert.deepEqual(get("/admin/smtp/sessions").security, []);
  assert.deepEqual(get("/admin/smtp/clients").security, [{ adminToken: [] }]);
  assert.deepEqual(post("/admin/smtp/sessions/{sessionId}/verify").security, [{ adminToken: [] }]);
  assert.deepEqual(post("/admin/smtp/reply-rules").security, [{ adminToken: [] }]);
});

test("OpenAPI exposes all SMTP rule phases and proper query/readiness response shapes", () => {
  const input = schemas.SmtpReplyRuleInput as { properties: Record<string, {enum?:string[]}> };
  const output = schemas.SmtpReplyRule as { properties: Record<string, {enum?:string[]}> };
  const expected = ["CONNECT","EHLO","AUTH","MAIL","RCPT","DATA","AFTER_DATA"];
  assert.deepEqual(input.properties.phase.enum,expected);
  assert.deepEqual(output.properties.phase.enum,expected);
  const contract = createOpenApiDocument();
  const ready = contract.paths["/ready"].get as {responses: Record<number, {content:Record<string,{schema:unknown}>}>};
  assert.deepEqual(ready.responses[503].content["application/json"].schema,
    {$ref:"#/components/schemas/Readiness"});
  const logs = contract.paths["/logs"].get as {parameters:Array<{name:string;in:string}>;responses:Record<number,{content:Record<string,{schema:unknown}>}>};
  assert.ok(logs.parameters.some(param=>param.name==="after" && param.in==="query"));
  assert.ok(logs.parameters.some(param=>param.name==="limit" && param.in==="query"));
  assert.ok(!logs.parameters.some(param=>param.name.includes(",")));
  assert.deepEqual(logs.responses[200].content["application/json"].schema,
    {$ref:"#/components/schemas/LogResponse"});
  const logResponse = schemas.LogResponse as {oneOf:unknown[]};
  assert.deepEqual(logResponse.oneOf,[
    {$ref:"#/components/schemas/Replay"},{$ref:"#/components/schemas/LogPage"}
  ]);
});
