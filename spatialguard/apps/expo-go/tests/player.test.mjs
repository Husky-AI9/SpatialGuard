import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
const source = fs.readFileSync(
  new URL("../src/playerHtml.ts", import.meta.url),
  "utf8",
);
const script = source.match(/<script>([\s\S]*?)<\/script>/)[1];
const flush = () => new Promise((resolve) => setImmediate(resolve));
function harness() {
  const messages = [],
    timers = new Map();
  let peer,
    timerId = 0;
  const video = { srcObject: null, play: async () => {} };
  class Peer {
    constructor() {
      peer = this;
      this.iceGatheringState = "complete";
    }
    addTransceiver() {}
    async createOffer() {
      return { type: "offer", sdp: "test-sdp-offer" };
    }
    async setLocalDescription(d) {
      this.localDescription = d;
    }
    async setRemoteDescription(d) {
      this.answer = d;
    }
    close() {
      this.closed = true;
    }
  }
  const window = {
    ReactNativeWebView: { postMessage: (m) => messages.push(JSON.parse(m)) },
  };
  const context = vm.createContext({
    window,
    document: { getElementById: () => video },
    RTCPeerConnection: Peer,
    MediaStream: class {},
    setTimeout: (fn, ms) => {
      timers.set(++timerId, { fn, ms });
      return timerId;
    },
    clearTimeout: (id) => timers.delete(id),
  });
  vm.runInContext(script, context);
  return {
    messages,
    window,
    video,
    timers,
    get peer() {
      return peer;
    },
  };
}
test("player sends an SDP offer and receives answer without API credentials", async () => {
  const h = harness();
  await flush();
  assert.deepEqual(h.messages, [{ kind: "offer", sdp: "test-sdp-offer" }]);
  await h.window.receive({ kind: "answer", sdp: "answer-sdp" });
  assert.equal(h.peer.answer.sdp, "answer-sdp");
  assert.ok(!source.includes("Authorization"));
  assert.ok(!source.includes("Bearer"));
});
test("stopping closes the peer and drops its video", async () => {
  const h = harness();
  await flush();
  h.video.srcObject = {};
  await h.window.receive({ kind: "stop" });
  assert.equal(h.peer.closed, true);
  assert.equal(h.video.srcObject, null);
  assert.equal(h.timers.size, 0);
  await h.window.receive({ kind: "answer", sdp: "late-answer" });
  assert.equal(h.peer.answer, undefined);
});
test("unmounting before ICE completes never asks for a stream", async () => {
  const h = harness();
  await h.window.receive({ kind: "stop" });
  await flush();
  assert.equal(h.messages.length, 0);
  assert.equal(h.peer.closed, true);
});
test("playing video clears timeout; disconnected peer reports failure", async () => {
  const h = harness();
  await flush();
  h.video.onplaying();
  assert.equal(h.timers.size, 0);
  assert.equal(h.messages.at(-1).kind, "playing");
  h.peer.connectionState = "disconnected";
  h.peer.onconnectionstatechange();
  assert.equal(h.messages.at(-1).kind, "error");
});
test("no frames causes a bounded timeout instead of endless renewal", async () => {
  const h = harness();
  await flush();
  const t = [...h.timers.values()].find((t) => t.ms === 30000);
  assert.ok(t);
  t.fn();
  assert.match(h.messages.at(-1).message, /timed out/);
});
