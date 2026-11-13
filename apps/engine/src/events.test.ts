import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isHifricaEvent, projectChannel, type PhoneConfirmEvent } from "@hifrica/shared";
import Fastify from "fastify";
import { Redis } from "ioredis";
import { publishEvent } from "./events.js";
import { registerValkey } from "./valkey.js";

describe("publishEvent", () => {
  it("lève sans VALKEY_URL (pas de client), ne publie rien", async () => {
    const app = Fastify({ logger: false });
    registerValkey(app, {});
    const event: PhoneConfirmEvent = {
      type: "phone.confirm",
      sessionId: "s",
      projectId: "demo",
      createdAt: new Date().toISOString(),
    };
    await assert.rejects(() => publishEvent(event));
    await app.close();
  });
});

describe("publishEvent avec un vrai Valkey (TEST_VALKEY_URL)", { skip: !process.env.TEST_VALKEY_URL }, () => {
  it("publie exactement le JSON de l'événement sur project:{id}:events", async () => {
    const url = process.env.TEST_VALKEY_URL as string;
    const app = Fastify({ logger: false });
    registerValkey(app, { VALKEY_URL: url });

    const admin = new Redis(url);
    const projectId = `it-${Date.now()}`;
    const channel = projectChannel(projectId);
    const received: unknown[] = [];
    admin.on("message", (_ch: string, message: string) => received.push(JSON.parse(message)));
    await admin.subscribe(channel);

    try {
      const event: PhoneConfirmEvent = { type: "phone.confirm", sessionId: "s1", projectId, createdAt: new Date().toISOString() };
      await waitFor(async () => {
        try {
          await publishEvent(event);
          return true;
        } catch {
          return false;
        }
      });
      await waitFor(() => received.length === 1);
      assert.equal(isHifricaEvent(received[0]), true);
      assert.deepEqual(received[0], event);
    } finally {
      admin.disconnect();
      await app.close();
    }
  });
});

async function waitFor(condition: () => Promise<boolean> | boolean, timeoutMs = 3_000): Promise<void> {
  const started = Date.now();
  while (!(await condition())) {
    if (Date.now() - started > timeoutMs) throw new Error("condition jamais remplie");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
