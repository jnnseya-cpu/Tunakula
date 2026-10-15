/**
 * The zero-dependency SMTP sender: it speaks the protocol against a local fake server, authenticates
 * with AUTH LOGIN, and sends a UTF-8 message whose subject and body survive (encoded-word + base64).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { sendMail } from "../src/modules/messaging/smtp.ts";

/** A tiny SMTP sink: accepts the conversation, records the DATA payload, returns a queue id. */
function fakeSmtp(): Promise<{ port: number; received: () => string; close: () => void; auth: () => { user: string; pass: string } }> {
  let data = "";
  let inData = false;
  let authStep: 0 | 1 | 2 = 0;
  let user = "", pass = "";
  const server = net.createServer((sock) => {
    sock.write("220 fake ESMTP\r\n");
    let buf = "";
    sock.on("data", (d) => {
      buf += d.toString("utf8");
      let i;
      while ((i = buf.indexOf("\r\n")) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (inData) {
          if (line === ".") { inData = false; sock.write("250 OK: queued as QID-42\r\n"); }
          else data += line + "\n";
          continue;
        }
        if (authStep === 1) { user = Buffer.from(line, "base64").toString("utf8"); authStep = 2; sock.write("334 UGFzc3dvcmQ6\r\n"); continue; }
        if (authStep === 2) { pass = Buffer.from(line, "base64").toString("utf8"); authStep = 0; sock.write("235 2.7.0 Authentication successful\r\n"); continue; }
        const up = line.toUpperCase();
        if (up.startsWith("EHLO") || up.startsWith("HELO")) sock.write("250-fake greets you\r\n250 AUTH LOGIN\r\n");
        else if (up === "AUTH LOGIN") { authStep = 1; sock.write("334 VXNlcm5hbWU6\r\n"); }
        else if (up.startsWith("MAIL FROM")) sock.write("250 OK\r\n");
        else if (up.startsWith("RCPT TO")) sock.write("250 OK\r\n");
        else if (up === "DATA") { inData = true; sock.write("354 End data with <CR><LF>.<CR><LF>\r\n"); }
        else if (up === "QUIT") { sock.write("221 Bye\r\n"); sock.end(); }
        else sock.write("250 OK\r\n");
      }
    });
  });
  return new Promise((res) => server.listen(0, "127.0.0.1", () => {
    const port = (server.address() as net.AddressInfo).port;
    res({ port, received: () => data, close: () => server.close(), auth: () => ({ user, pass }) });
  }));
}

test("sends an authenticated UTF-8 email; subject and body survive", async () => {
  const srv = await fakeSmtp();
  try {
    const r = await sendMail(
      { host: "127.0.0.1", port: srv.port, user: "smtp-user", pass: "smtp-pass", from: "Tunakula <no-reply@tunakula.com>" },
      { to: "customer@example.com", subject: "🎉 Offre -20%", text: "Bonjour — 20% de réduction ce week-end." },
    );
    assert.equal(r.status, "sent", JSON.stringify(r));
    assert.match(r.ref ?? "", /QID-42/, "the server's queue id is returned in the ref");

    const msg = srv.received();
    assert.match(msg, /^To: customer@example\.com$/m);
    assert.match(msg, /^From: Tunakula <no-reply@tunakula\.com>$/m);
    // Non-ASCII subject is MIME encoded-word; decoding it gives the original.
    const subj = msg.match(/^Subject: =\?UTF-8\?B\?([^?]+)\?=$/m);
    assert.ok(subj, "subject is an encoded-word");
    assert.equal(Buffer.from(subj![1]!, "base64").toString("utf8"), "🎉 Offre -20%");
    // The body is base64 after the header/blank-line separator; it decodes to the message.
    const body = msg.split("\n\n").slice(1).join("\n\n").replace(/\n/g, "");
    assert.equal(Buffer.from(body, "base64").toString("utf8"), "Bonjour — 20% de réduction ce week-end.");
    // Credentials were presented.
    assert.deepEqual(srv.auth(), { user: "smtp-user", pass: "smtp-pass" });
  } finally { srv.close(); }
});

test("a connection failure is a failed result, not a throw", async () => {
  const r = await sendMail({ host: "127.0.0.1", port: 1, from: "x@y.com", timeoutMs: 1000 }, { to: "a@b.com", subject: "s", text: "t" });
  assert.equal(r.status, "failed");
  assert.ok(r.failure);
});
