/** Management and demonstration API routes. Protocol listeners and TLS state are composed by server.ts. */
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync, existsSync, writeFileSync, renameSync, mkdirSync, copyFileSync, rmSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import nodemailer from "nodemailer";
import { Fault, parseLogFilters, type Channel, type Attachment } from "../core.js";
import { config } from "../config.js";
import { isAllowedHost, isAllowedOrigin, applyCors } from "./security.js";
import { createOpenApiDocument, matchApiOperation } from "./api-contract.js";
import { generationOptions } from "../identity-generation/generator.js";
import { ensureLocalTls } from "../tls/local-certificates.js";
import { parseTlsNameSet, type TlsNameSet } from "../tls/server-names.js";
import { environmentControlledKeys, assertWritableNetworkSettings } from "../network-settings.js";
import { applicationFootprint } from "../footprint.js";
import { isConnectionProbeAddress, waitForConnectionProbeMessage } from "../connection-probe.js";
import { sanitizeDownloadName } from "../mime/attachments.js";
import { serveFrontend, errorCode, json, body } from "./server-helpers.js";
import { observe } from "./event-stream.js";
import { tryExtensionRequest } from "./extension-request.js";
import type { RequestContext } from "../server.js";

const channels: Record<string, Channel> = { mailboxes: "email", "phone-numbers": "sms" };
function publicMessage(message: import("../core.js").Message) {
  const { attachments = [], rawMime: _rawMime, ...other } = message;
  return { ...other, attachments: attachments.map(({ id, filename, contentType, size }) => ({
    id, filename, contentType, size,
  })) };
}

export async function handleRequest(req: IncomingMessage, res: ServerResponse, ctx: RequestContext, demoOnly = false) {
  const { sandbox, credentialStore, inboxAddresses, smtpAuthPolicy, smtpSessions, simulations, smtpAttempts, smtpReplyRules, smtpRuleIdentities, smtpCredentialIds, protocolCounters, pop3Connections, lastCleanupAt, networkSettingsFile, savedSettings, setting, networkKeys, adminAllowed, port, smtpPort, pop3Port, httpsPort, smtpsPort, demoPort, demoHttpsPort, tlsMode, tlsDirectory, managedNamesFile, managedIdentityFile, effectiveTlsNames, certificateManager, tlsIdentity, addressHost, apiHost, smtpHost, allowedOrigins, allowedHosts, listenersReady, startedListeners } = ctx;
  try {
    if (!isAllowedHost(req.headers.host, allowedHosts)) throw new Fault(421, "Unrecognized Host");
    if (!isAllowedOrigin(req.headers.origin, req.headers.host, allowedOrigins)) {
      throw new Fault(403, "Origin not allowed");
    }
    applyCors(req, res, allowedOrigins);
    const url = new URL(req.url || "/", "https://localhost");
    const rawPath = url.pathname.split("/").filter(Boolean);
    const method = req.method || "GET";
    const sameOriginDemo = !demoOnly && rawPath[0] === "demo";
    const path = !demoOnly && ["api", "demo"].includes(rawPath[0]) ? rawPath.slice(1) : rawPath;
    if (method === "OPTIONS") return json(res, 204, {});
    const match = matchApiOperation(method, path, demoOnly || sameOriginDemo ? "demo" : "management");
    if (!match) {
      // Extension routes run after the existing security checks and core catalogue.
      // On the main listener /api/ resolves management and /demo/ resolves demo;
      // on dedicated demo listeners the root maps to demo.
      const audience = demoOnly || sameOriginDemo ? "demo" : "management";
      const isPublicExtensionPath = demoOnly || sameOriginDemo || rawPath[0] === "api";
      if (isPublicExtensionPath && ctx.extensionHost && await tryExtensionRequest(
        req, res, ctx.extensionHost, audience,
        "/" + path.join("/") + url.search,
      )) return;
      if (!demoOnly && method === "GET" && !["api", "demo"].includes(rawPath[0]) &&
        serveFrontend(req, res, rawPath)) return;
      throw new Fault(404, "Route not available on this listener");
    }
    const { operation, params } = match;
    const channel = channels[path[0]];
    const inboxId = params.inboxId;

    switch (operation.id) {
      case "popConnections": {
        if (!adminAllowed(req)) throw new Fault(403, "Administrative HTTPS token required");
        return json(res, 200, pop3Connections.list());
      }
      case "applicationFootprint": {
        if (!adminAllowed(req)) throw new Fault(403, "Administrative HTTPS token required");
        return json(res, 200, applicationFootprint(sandbox, smtpSessions, pop3Connections,
          credentialStore, simulations, lastCleanupAt));
      }
      case "protocolMetrics": {
        if (!adminAllowed(req)) throw new Fault(403, "Administrative HTTPS token required");
        return json(res, 200, protocolCounters.snapshot());
      }
      case "smtpRuleResolve": {
        if (!adminAllowed(req)) throw new Fault(403, "Administrative HTTPS token required");
        const retained = new Set(smtpSessions.listSessions().map(s => s.id));
        for (const id of smtpCredentialIds.keys()) if (!retained.has(id)) smtpCredentialIds.delete(id);
        const sessions = smtpSessions.listSessions().map(s => ({
          id: s.id, remoteAddress: s.remoteAddress, connected: s.connected,
          connectedAt: s.connectedAt, credentialsIds: smtpCredentialIds.get(s.id),
        }));
        return json(res, 200, smtpRuleIdentities.resolve(await body(req), sessions));
      }
      case "smtpReplyRuleCreate": {
        if (!adminAllowed(req)) throw new Fault(403, "Administrative HTTPS token required");
        return json(res, 201, smtpReplyRules.create(await body(req)));
      }
      case "smtpReplyRuleList": {
        if (!adminAllowed(req)) throw new Fault(403, "Administrative HTTPS token required");
        return json(res, 200, smtpReplyRules.list());
      }
      case "smtpReplyRuleDelete": {
        if (!adminAllowed(req)) throw new Fault(403, "Administrative HTTPS token required");
        if (!smtpReplyRules.delete(params.ruleId)) throw new Fault(404, "SMTP rule not found", "SMTP_RULE_NOT_FOUND");
        return json(res, 204, {});
      }
      case "smtpConnectionSimulationCreate": {
        if (!adminAllowed(req)) throw new Fault(403, "Administrative HTTPS token required");
        const connection = smtpSessions.getSession(params.sessionId);
        if (!connection?.connected) throw new Fault(404, "Active SMTP connection not found", "SMTP_SESSION_NOT_FOUND");
        const input = await body(req);
        if (input.command !== "DATA") throw new Fault(400, "Connection simulations currently support DATA only", "INVALID_SIMULATION");
        return json(res, 201, simulations.create({ smtpSessionId: params.sessionId,
          protocol: "SMTP", command: input.command, code: input.code,
          message: input.message || "Simulated failure", remaining: input.remaining || 1 }));
      }
      case "smtpConnectionSimulationList": {
        if (!adminAllowed(req)) throw new Fault(403, "Administrative HTTPS token required");
        return json(res, 200, simulations.listConnection(params.sessionId));
      }
      case "smtpConnectionSimulationDelete": {
        if (!adminAllowed(req)) throw new Fault(403, "Administrative HTTPS token required");
        const rule = simulations.listConnection(params.sessionId).find(value => value.id === params.ruleId);
        if (!rule) throw new Fault(404, "SMTP connection simulation not found");
        simulations.delete(rule.id);
        return json(res, 204, {});
      }
      case "simulationCreate": {
        if (!adminAllowed(req)) throw new Fault(403, "Administrative HTTPS token required");
        const input = await body(req);
        if (!credentialStore.resolve(params.sessionId)) throw new Fault(404, "Unknown test session");
        return json(res, 201, simulations.create({ sessionId: params.sessionId, protocol: input.protocol, command: input.command, code: input.code, message: input.message || "Simulated failure", remaining: input.remaining || 1 }));
      }
      case "simulationList": {
        if (!adminAllowed(req)) throw new Fault(403, "Administrative HTTPS token required");
        return json(res, 200, simulations.list(params.sessionId));
      }
      case "simulationDelete": {
        if (!adminAllowed(req)) throw new Fault(403, "Administrative HTTPS token required");
        simulations.delete(params.ruleId);
        return json(res, 204, {});
      }
      case "testSessionCreate": {
        if (!adminAllowed(req)) throw new Fault(403, "Administrative HTTPS token required");
        const input = await body(req);
        if (typeof input.username !== "string" || !input.username.trim())
          throw new Fault(400, "Inbox required", "INVALID_INBOX");
        let available = false;
        try { available = !!sandbox.find("email", input.username); } catch { /* expired inbox */ }
        if (!available)
          throw new Fault(404, "Test inbox does not exist", "TEST_INBOX_NOT_FOUND");
        return json(res, 201, { sessionId: await credentialStore.authenticate(input.username, input.password) });
      }
      case "testSessionGet": {
        if (!adminAllowed(req)) throw new Fault(403, "Administrative HTTPS token required");
        const found = credentialStore.resolve(params.sessionId);
        if (!found) throw new Fault(404, "Test session not found", "TEST_SESSION_NOT_FOUND");
        return json(res, 200, found);
      }
      case "testSessionVerify": {
        if (!adminAllowed(req)) throw new Fault(403, "Administrative HTTPS token required");
        const input = await body(req);
        return json(res, 200, { matches: await credentialStore.verify(input.username, input.password, params.sessionId) });
      }
      case "smtpAttempts": {
        return json(res, 200, smtpAttempts.list({
          smtpSessionId:url.searchParams.get("smtpSessionId")||undefined,
          sender:url.searchParams.get("sender")||undefined,
          recipient:url.searchParams.get("recipient")||undefined,
          messageId:url.searchParams.get("messageId")||undefined,
          ruleId:url.searchParams.get("ruleId")||undefined,
        }, Number(url.searchParams.get("limit")||100)));
      }
      case "smtpClients":
        if (!adminAllowed(req)) throw new Fault(403, "Administrative HTTPS token required");
        return json(res, 200, smtpSessions.listClients());
      case "smtpSessions":
        return json(res, 200, smtpSessions.listSessions(url.searchParams.get("clientId") || undefined));
      case "smtpVerify": {
        if (!adminAllowed(req)) throw new Fault(403, "Administrative HTTPS token required");
        const input = await body(req);
        return json(res, 200, await smtpSessions.verifyCredentials(params.sessionId, input.username, input.password, input.attemptId));
      }
      case "health":
        return json(res, 200, { status: "ok", runId: sandbox.runId });
      case "ready":
        return json(res, listenersReady ? 200 : 503, { ready: listenersReady, runId: sandbox.runId, listeners: startedListeners });
      case "capabilities":
        return json(res, 200, {
          version: "0.2.0", schemaVersion: 1, protocols: { smtp: true, starttls: !!tlsIdentity,
            smtps: !!tlsIdentity, pop3: true, sms: true },
          smtpAuthPolicy, inbox: { idempotentCreate: true, ifExists: ["error", "return"],
            reservedDomain: "virtual.inbox" },
          simulation: { phases: ["CONNECT", "EHLO", "AUTH", "MAIL", "RCPT", "DATA", "AFTER_DATA"],
            actions: ["reply", "delay", "drop", "hang", "reset"] },
        });
      case "openapi":
        return json(res, 200, createOpenApiDocument());
      case "demoOpenapi":
        return json(res, 200, createOpenApiDocument("demo"));
      case "generationOptions":
        return json(res, 200, generationOptions());
      case "networkSettings": {
        if (!adminAllowed(req)) throw new Fault(403, "Administrative HTTPS token required");
        const values = await body(req);
        const allowed: readonly string[] = networkKeys;
        if (!values || typeof values !== "object" || Array.isArray(values) ||
          Object.keys(values).some((key) => !allowed.includes(key))) {
          throw new Fault(400, "Unsupported setting");
        }
        for (const [key, value] of Object.entries(values)) {
          if (typeof value !== "string" || !value || value.length > 255) throw new Fault(400, "Invalid setting");
          if (key.endsWith("_PORT") || key === "PORT") {
            const number = Number(value);
            if (!Number.isInteger(number) || number < 1 || number > 65535) throw new Fault(400, "Invalid port");
          } else if (!/^[a-zA-Z0-9.:-]+$/.test(value)) throw new Fault(400, "Invalid host");
        }
        assertWritableNetworkSettings(values, process.env);
        const data = { ...savedSettings, ...values };
        mkdirSync(dirname(networkSettingsFile), { recursive: true, mode: 0o700 });
        const temporary = networkSettingsFile + "." + randomUUID() + ".tmp";
        writeFileSync(temporary, JSON.stringify(data, null, 2), { mode: 0o600, flag: "wx" });
        renameSync(temporary, networkSettingsFile);
        Object.assign(savedSettings, data);
        sandbox.log("network.settings.updated", undefined, undefined, { keys: Object.keys(values) });
        return json(res, 202, { restartRequired: true, settings: data,
          environmentControlledKeys: environmentControlledKeys(process.env, networkKeys) });
      }
      case "importTls": {
        if (!adminAllowed(req)) throw new Fault(403, "Administrative HTTPS token required");
        if (!tlsIdentity) throw new Fault(409, "Enable TLS before certificate import");
        const payload = await body(req);
        if (typeof payload.cert !== "string" || typeof payload.key !== "string") {
          throw new Fault(400, "PEM certificate and key required");
        }
        try {
          const active = certificateManager.activate(payload.cert, payload.key);
          ctx.tlsIdentity = certificateManager.identity;
          sandbox.log("tls.identity.activated", undefined, undefined, { subject: active?.subject, validTo: active?.validTo });
          return json(res, 200, { accepted: true, restartRequired: false, active });
        } catch (error) {
          throw new Fault(400, error instanceof Error ? error.message : "Invalid certificate", "TLS_CERTIFICATE_INVALID");
        }
      }
      case "tlsNames": {
        if (!adminAllowed(req)) throw new Fault(403, "Administrative HTTPS token required");
        if (tlsMode !== "auto") throw new Fault(409, "SAN regeneration requires TLS_MODE=auto");
        const payload = await body(req);
        if (!payload || !Array.isArray(payload.dns) || !Array.isArray(payload.ips) ||
          payload.dns.length + payload.ips.length > 50) throw new Fault(400, "Invalid SAN names");
        let managed: TlsNameSet;
        let names: string[];
        try {
          managed = parseTlsNameSet(payload);
          names = effectiveTlsNames(managed);
        } catch (error) {
          throw new Fault(400, error instanceof Error ? error.message : "Invalid SAN names", "INVALID_REQUEST");
        }
        const identity = ensureLocalTls(tlsDirectory, names.join(","));
        const active = certificateManager.useGenerated(readFileSync(identity.cert), readFileSync(identity.key));
        if (existsSync(managedIdentityFile)) {
          copyFileSync(managedIdentityFile, managedIdentityFile + ".previous");
          rmSync(managedIdentityFile, { force: true });
        }
        ctx.tlsIdentity = certificateManager.identity;
        mkdirSync(dirname(managedNamesFile), { recursive: true, mode: 0o700 });
        const temporary = managedNamesFile + "." + randomUUID() + ".tmp";
        writeFileSync(temporary, JSON.stringify(managed, null, 2), { mode: 0o600, flag: "wx" });
        renameSync(temporary, managedNamesFile);
        sandbox.log("tls.names.updated", undefined, undefined, { names });
        return json(res, 200, { restartRequired: false, active, names });
      }
      case "tlsStatus":
        return json(res, 200, { active: certificateManager.info() });
      case "connectionInfo":
        return json(res, 200, {
          host: addressHost,
          networkSettings: { PUBLIC_HOST: addressHost, HOST: apiHost, SMTP_HOST: smtpHost,
            PORT: String(port), HTTPS_PORT: String(httpsPort), SMTP_PORT: String(smtpPort),
            SMTPS_PORT: String(smtpsPort), POP3_PORT: String(pop3Port),
            DEMO_PORT: String(demoPort), DEMO_HTTPS_PORT: String(demoHttpsPort) },
          environmentControlledKeys: environmentControlledKeys(process.env, networkKeys),
          http: { port, httpsPort: tlsIdentity ? httpsPort : null, demoPort,
            demoHttpsPort: tlsIdentity ? demoHttpsPort : null },
          smtp: { plainPort: smtpPort, starttls: !!tlsIdentity,
            implicitTlsPort: tlsIdentity ? smtpsPort : null, serverName: addressHost },
          certificate: tlsIdentity ? { ...certificateManager.info(), download: "/tls/certificate.pem",
            caDownload: tlsMode === "auto" ? "/tls/ca.pem" : null } : null,
        });
      case "tlsCa":
        if (tlsMode !== "auto") throw new Fault(404, "Local CA not configured");
        res.writeHead(200, { "Content-Type": "application/x-pem-file",
          "Content-Disposition": "attachment; filename=virtual-inbox-ca.pem" });
        return res.end(readFileSync(join(tlsDirectory, "ca.pem")));
      case "tlsCertificate":
        if (!tlsIdentity) throw new Fault(404, "TLS is not configured");
        res.writeHead(200, { "Content-Type": "application/x-pem-file",
          "Content-Disposition": "attachment; filename=virtual-inbox-server.pem" });
        return res.end(tlsIdentity.cert);
      case "ingestSms":
      case "sendSms": {
        // Optional diagnostic correlation metadata, never treated as caller identity.
        if (operation.id === "ingestSms" && req.headers["x-vi-correlation-id"] !== undefined) {
          const correlation = req.headers["x-vi-correlation-id"];
          if (typeof correlation !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(correlation))
            throw new Fault(400, "Invalid SMS correlation identifier", "INVALID_CORRELATION_ID");
          res.setHeader("X-VI-Correlation-ID", correlation);
        }
        const input = await body(req);
        return json(res, 201, publicMessage(sandbox.deliver("sms", input.from, input.to, input.body)));
      }
      case "logs": {
        const filters = parseLogFilters(url.searchParams);
        const limitParam = url.searchParams.get("limit"), beforeParam = url.searchParams.get("before");
        if (limitParam !== null || beforeParam !== null) {
          if (url.searchParams.has("after") || url.searchParams.has("from") || url.searchParams.has("to"))
            throw new Fault(400, "Conflicting log cursors", "INVALID_LOG_CURSOR");
          const limit = limitParam === null ? 20 : Number(limitParam);
          const before = beforeParam === null ? undefined : Number(beforeParam);
          return json(res, 200, sandbox.pageLogs({ limit, before, filters }));
        }
        const from = url.searchParams.get("from");
        const to = url.searchParams.get("to");
        if (from !== null || to !== null) {
          const lower = Number(from), upper = Number(to);
          if (from === null || to === null || !Number.isSafeInteger(lower) || !Number.isSafeInteger(upper)
            || lower < 1 || upper < lower || upper - lower > 10000)
            throw new Fault(400, "Invalid log range", "INVALID_LOG_RANGE");
          const current = sandbox.replay(undefined, filters);
          return json(res, 200, {
            ...current,
            events: current.events.filter((event) => event.log_id !== undefined
              && event.log_id >= lower && event.log_id <= upper),
            requestedFrom: lower, requestedTo: upper,
          });
        }
        return json(res, 200, sandbox.replay(url.searchParams.get("after") || undefined, filters));
      }
      case "logEvents":
      case "newObserverEvents":
        return observe(sandbox, req, res);
      case "observerEvents":
        return observe(sandbox, req, res, params.observerId);
      case "observerSnapshot":
        return json(res, 200, sandbox.snapshot(params.observerId));
      case "watchInbox": {
        const input = await body(req);
        const result = sandbox.watch(params.observerId, input.inboxId);
        return json(res, 200, { recipient: result.recipient, messages: result.messages.map(publicMessage) });
      }
      case "unwatchInbox":
        sandbox.unwatch(params.observerId, inboxId);
        return json(res, 204, {});
      case "sendDemoEmail": {
        const recipient = sandbox.resource(inboxId);
        if (recipient.channel !== "email") throw new Fault(400, "Not an email inbox");
        const input = await body(req);
        const client = nodemailer.createTransport({ host: "127.0.0.1", port: smtpPort,
          secure: false, ignoreTLS: true, disableFileAccess: true, disableUrlAccess: true });
        const attachments = (Array.isArray(input.attachments) ? input.attachments : []).map((item: any) => {
          if (typeof item.filename !== "string" || typeof item.contentBase64 !== "string" ||
            !/^[a-zA-Z0-9+/]*={0,2}$/.test(item.contentBase64)) throw new Fault(400, "Invalid attachment");
          const content = Buffer.from(item.contentBase64, "base64");
          if (content.length > config.attachmentBytes) throw new Fault(413, "Attachment too large");
          return { filename: item.filename, content, contentType: item.contentType || "application/octet-stream" };
        });
        await client.sendMail({ from: input.from || "demo@sandbox.test", to: recipient.address,
          subject: input.subject || "Demo", text: input.body || "", attachments });
        return json(res, 202, { accepted: true });
      }
      case "connectionProbeWait": {
        const input = await body(req);
        const controller = new AbortController();
        res.on("close", () => { if (!res.writableEnded) controller.abort(); });
        const message = await waitForConnectionProbeMessage(sandbox, input.address, input, controller.signal);
        return json(res, message ? 200 : 204, message ? publicMessage(message) : {});
      }
      case "emailList":
      case "smsList": {
        const address = url.searchParams.get("address");
        if (!address) return json(res, 200, sandbox.list(channel));
        let found;
        try { found = sandbox.find(channel, address); } catch {}
        return json(res, 200, found ? [found] : []);
      }
      case "emailCreate":
      case "smsCreate": {
        const input = await body(req);
        if (channel === "email" && typeof input.address === "string" &&
          isConnectionProbeAddress(input.address))
          throw new Fault(400, "Connection probe inboxes are created by SMTP only", "INVALID_CONNECTION_PROBE");
        if (input.ifExists !== undefined && !["return", "error"].includes(input.ifExists))
          throw new Fault(400, "Invalid ifExists mode", "INVALID_IF_EXISTS");
        const requestedAddress = channel === "email" ? input.address : input.phoneNumber;
        const existing = typeof requestedAddress === "string" && requestedAddress.trim()
          ? (() => { try { return sandbox.find(channel, requestedAddress); } catch { return undefined; } })() : undefined;
        const created = sandbox.create(channel, requestedAddress,
          input.ttlSeconds, input.observerId, input.generation, input.ifExists ?? "error");
        if (created.channel === "email" && (!existing || existing.id !== created.id)) {
          credentialStore.createInbox(created.address);
          inboxAddresses.set(created.id, created.address);
        }
        return json(res, existing && existing.id === created.id ? 200 : 201, created);
      }
      case "emailGet":
      case "smsGet":
        return json(res, 200, sandbox.resource(inboxId));
      case "emailDelete":
      case "smsDelete":
        sandbox.deleteResource(inboxId);
        return json(res, 204, {});
      case "emailMessages":
      case "smsMessages":
        {
          const allowed = ["after", "originalRecipient", "from", "captureReason", "smtpSessionId", "authUser"];
          const values: Record<string, string> = {};
          for (const key of allowed) {
            const all = url.searchParams.getAll(key);
            if (all.length > 1 || all.some(value => !value || value.length > 320))
              throw new Fault(400, "Invalid message filter", "INVALID_MESSAGE_FILTER");
            if (all.length) values[key] = all[0];
          }
          const after = values.after === undefined ? 0 : Number(values.after);
          if (!Number.isSafeInteger(after) || after < 0)
            throw new Fault(400, "Invalid message cursor", "INVALID_MESSAGE_FILTER");
          return json(res, 200, sandbox.listMessages(inboxId, {
            after, originalRecipient: values.originalRecipient, from: values.from,
            captureReason: values.captureReason, smtpSessionId: values.smtpSessionId,
            authUser: values.authUser,
          }).map(publicMessage));
        }
      case "emailClear":
      case "smsClear":
        sandbox.clearMessages(inboxId);
        return json(res, 204, {});
      case "emailMessage":
      case "smsMessage": {
        const message = sandbox.listMessages(inboxId).find((item) => item.id === params.messageId);
        if (!message) throw new Fault(404, "Message not found");
        return json(res, 200, publicMessage(message));
      }
      case "emailDeleteMessage":
      case "smsDeleteMessage":
        sandbox.removeMessage(inboxId, params.messageId);
        return json(res, 204, {});
      case "emailAttachment":
      case "smsAttachment": {
        const message = sandbox.listMessages(inboxId).find((item) => item.id === params.messageId);
        const attachment = message?.attachments?.find((item) => item.id === params.attachmentId);
        if (!attachment) throw new Fault(404, "Attachment not found");
        res.writeHead(200, { "Content-Type": attachment.contentType, "Content-Length": attachment.size,
          "X-Content-Type-Options": "nosniff",
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(sanitizeDownloadName(attachment.filename))}` });
        return res.end(attachment.content);
      }
      case "emailWait":
      case "smsWait": {
        const input = await body(req);
        const controller = new AbortController();
        req.on("close", () => { if (!res.writableEnded) controller.abort(); });
        const message = await sandbox.wait(inboxId, input, controller.signal);
        return json(res, message ? 200 : 204, message ? publicMessage(message) : {});
      }
      default:
        throw new Fault(500, "HTTP operation has no implementation");
    }
  } catch (error) {
    const fault = error instanceof Fault
      ? error : new Fault(500, error instanceof Error ? error.message : "Server error");
    if (!res.headersSent) json(res, fault.status, {
      error: fault.message, errorCode: fault.code || errorCode(fault.status, fault.message), errorParams: fault.params,
    });
  }
}
