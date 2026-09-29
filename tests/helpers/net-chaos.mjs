// Deterministic virtual network used by Online V2 tests.
// No wall-clock sleeps: tests advance a virtual clock, making loss/jitter/
// reordering scenarios repeatable and fast.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function clonePayload(value) {
  if (value instanceof ArrayBuffer) return value.slice(0);
  if (ArrayBuffer.isView(value)) return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  return JSON.parse(JSON.stringify(value));
}

function payloadBytes(value) {
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  const json = JSON.stringify(value);
  if (!json) return 0;
  return typeof TextEncoder === 'function' ? new TextEncoder().encode(json).byteLength : json.length;
}

export class VirtualNetwork {
  constructor(profile = {}) {
    this.now = 0;
    this.rand = mulberry32(profile.seed ?? 0xA71E17);
    this.baseMs = Math.max(0, profile.baseMs ?? 50);
    this.jitterMs = Math.max(0, profile.jitterMs ?? 0);
    this.loss = Math.min(1, Math.max(0, profile.loss ?? 0));
    this.reorder = Math.min(1, Math.max(0, profile.reorder ?? 0));
    this.reorderExtraMs = Math.max(0, profile.reorderExtraMs ?? this.baseMs * 1.5 + this.jitterMs);
    this.burstChance = Math.min(1, Math.max(0, profile.burstChance ?? 0));
    this.burstMin = Math.max(1, profile.burstMin ?? 2);
    this.burstMax = Math.max(this.burstMin, profile.burstMax ?? 5);
    this.burstLeft = 0;
    this.queue = [];
    this.order = 0;
    this.metrics = {
      sent:0, delivered:0, dropped:0, reordered:0, burstDropped:0, maxQueue:0,
      bytesSent:0, bytesDelivered:0, bytesDropped:0,
      latencyTotalMs:0, latencyMinMs:Infinity, latencyMaxMs:0,
      jitterTotalMs:0, jitterSamples:0,
    };
    this.lastDeliveredLatencyMs = null;
  }

  shouldDrop() {
    if (this.burstLeft > 0) {
      this.burstLeft--;
      this.metrics.burstDropped++;
      return true;
    }
    if (this.burstChance > 0 && this.rand() < this.burstChance) {
      const span = this.burstMin + Math.floor(this.rand() * (this.burstMax - this.burstMin + 1));
      this.burstLeft = Math.max(0, span - 1);
      this.metrics.burstDropped++;
      return true;
    }
    return this.rand() < this.loss;
  }

  send(deliver, payload, tag = 'packet') {
    const bytes = payloadBytes(payload);
    this.metrics.sent++;
    this.metrics.bytesSent += bytes;
    if (this.shouldDrop()) {
      this.metrics.dropped++;
      this.metrics.bytesDropped += bytes;
      return false;
    }

    const jitter = this.jitterMs ? (this.rand() * 2 - 1) * this.jitterMs : 0;
    let delay = Math.max(0, this.baseMs + jitter);
    if (this.reorder > 0 && this.rand() < this.reorder) {
      delay += this.reorderExtraMs;
      this.metrics.reordered++;
    }

    this.queue.push({
      at: this.now + delay,
      sentAt: this.now,
      bytes,
      order: this.order++,
      deliver,
      payload: clonePayload(payload),
      tag,
    });
    this.metrics.maxQueue = Math.max(this.metrics.maxQueue, this.queue.length);
    return true;
  }

  advance(ms) {
    const end = this.now + Math.max(0, ms);
    for (;;) {
      let idx = -1;
      let bestAt = Infinity;
      let bestOrder = Infinity;
      for (let i = 0; i < this.queue.length; i++) {
        const item = this.queue[i];
        if (item.at <= end && (item.at < bestAt || (item.at === bestAt && item.order < bestOrder))) {
          idx = i;
          bestAt = item.at;
          bestOrder = item.order;
        }
      }
      if (idx < 0) break;
      const [item] = this.queue.splice(idx, 1);
      this.now = item.at;
      item.deliver(item.payload, item.tag);
      this.metrics.delivered++;
      this.metrics.bytesDelivered += item.bytes;
      const latency = Math.max(0, item.at - item.sentAt);
      this.metrics.latencyTotalMs += latency;
      this.metrics.latencyMinMs = Math.min(this.metrics.latencyMinMs, latency);
      this.metrics.latencyMaxMs = Math.max(this.metrics.latencyMaxMs, latency);
      if (this.lastDeliveredLatencyMs !== null) {
        this.metrics.jitterTotalMs += Math.abs(latency - this.lastDeliveredLatencyMs);
        this.metrics.jitterSamples++;
      }
      this.lastDeliveredLatencyMs = latency;
    }
    this.now = end;
  }

  drain(limitMs = 10000) {
    const deadline = this.now + limitMs;
    while (this.queue.length && this.now < deadline) {
      let next = Infinity;
      for (const item of this.queue) next = Math.min(next, item.at);
      if (!Number.isFinite(next)) break;
      this.advance(Math.max(0, next - this.now));
    }
    return this.queue.length === 0;
  }

  report() {
    const m = { ...this.metrics, queued:this.queue.length, nowMs:Math.round(this.now) };
    m.deliveryRate = m.sent ? m.delivered / m.sent : 1;
    m.averageLatencyMs = m.delivered ? m.latencyTotalMs / m.delivered : 0;
    m.minLatencyMs = m.delivered ? m.latencyMinMs : 0;
    m.maxLatencyMs = m.delivered ? m.latencyMaxMs : 0;
    m.averageJitterMs = m.jitterSamples ? m.jitterTotalMs / m.jitterSamples : 0;
    delete m.latencyMinMs;
    return m;
  }
}

export const NETWORK_PROFILES = Object.freeze({
  clean: { seed:1, baseMs:15, jitterMs:1, loss:0, reorder:0 },
  broadband: { seed:2, baseMs:30, jitterMs:5, loss:0.002, reorder:0.002 },
  mobile: { seed:3, baseMs:65, jitterMs:18, loss:0.015, reorder:0.01 },
  hotelWifi: { seed:4, baseMs:85, jitterMs:45, loss:0.04, reorder:0.05, burstChance:0.01, burstMin:2, burstMax:5 },
  brutal: { seed:5, baseMs:125, jitterMs:80, loss:0.08, reorder:0.10, burstChance:0.025, burstMin:3, burstMax:8 },
});
