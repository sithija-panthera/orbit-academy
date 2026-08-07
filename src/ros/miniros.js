// miniros — a faithful in-browser emulation of the ROS 2 (rclpy-style) API.
// Topics, publishers, subscriptions, timers, and a spin loop, so student code
// transfers 1:1 to real ROS 2 later.

class Topic {
  constructor(name, type) {
    this.name = name;
    this.type = type;
    this.subscribers = new Set();        // student subscriptions (cleared on reset)
    this.systemSubscribers = new Set();  // sim-internal listeners (survive reset)
    this.lastMsg = null;
    this.msgCount = 0;
    this.windowCount = 0;
    this.hz = 0;
  }
  publish(msg) {
    this.lastMsg = msg;
    this.msgCount++;
    this.windowCount++;
    for (const cb of [...this.systemSubscribers, ...this.subscribers]) {
      try { cb(msg); } catch (e) { graph.onError?.(e); }
    }
  }
}

class Graph {
  constructor() {
    this.topics = new Map();
    this.nodes = new Set();
    this.onError = null;
    // 1s window for Hz estimation
    this._hzTimer = setInterval(() => {
      for (const t of this.topics.values()) {
        t.hz = t.windowCount;
        t.windowCount = 0;
      }
    }, 1000);
  }
  topic(name, type) {
    if (!this.topics.has(name)) this.topics.set(name, new Topic(name, type));
    const t = this.topics.get(name);
    if (type && !t.type) t.type = type;
    return t;
  }
  reset() {
    for (const t of this.topics.values()) {
      t.subscribers.clear();
      t.lastMsg = null;
      t.msgCount = 0;
      t.windowCount = 0;
      t.hz = 0;
    }
    for (const n of [...this.nodes]) n._destroy();
    this.nodes.clear();
  }
}

export const graph = new Graph();

class Publisher {
  constructor(topic) { this._topic = topic; }
  publish(msg) { this._topic.publish(msg); }
}

class Node {
  constructor(name) {
    this.name = name;
    this._timers = [];
    this._subs = [];
    this._destroyed = false;
    graph.nodes.add(this);
  }
  create_publisher(type, topicName) {
    return new Publisher(graph.topic(topicName, type));
  }
  create_subscription(type, topicName, callback) {
    const t = graph.topic(topicName, type);
    // wrapper keeps duplicate subscriptions with the same fn independent
    const wrapped = (msg) => callback(msg);
    t.subscribers.add(wrapped);
    this._subs.push({ topic: t, callback: wrapped });
    return { topic: t, callback: wrapped };
  }
  create_timer(periodSec, callback) {
    const id = setInterval(() => {
      if (!this._destroyed) {
        try { callback(); } catch (e) { graph.onError?.(e); }
      }
    }, periodSec * 1000);
    this._timers.push(id);
    return { id };
  }
  get_logger() {
    const name = this.name;
    return {
      info: (m) => graph.onLog?.(`[${name}] ${m}`, 'info'),
      warn: (m) => graph.onLog?.(`[${name}] WARN: ${m}`, 'warn'),
      error: (m) => graph.onLog?.(`[${name}] ERROR: ${m}`, 'err'),
    };
  }
  destroy_node() { this._destroy(); }
  _destroy() {
    this._destroyed = true;
    for (const id of this._timers) clearInterval(id);
    this._timers = [];
    for (const s of this._subs) s.topic.subscribers.delete(s.callback);
    this._subs = [];
    graph.nodes.delete(this);
  }
}

// Message constructors mirroring common ROS 2 interfaces.
export const msgs = {
  Twist: () => ({ linear: { x: 0, y: 0, z: 0 }, angular: { x: 0, y: 0, z: 0 } }),
  LaserScan: () => ({ angle_min: 0, angle_max: 0, angle_increment: 0, range_min: 0, range_max: 0, ranges: [] }),
  Odometry: () => ({ pose: { position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } }, twist: { linear: { x: 0, y: 0, z: 0 }, angular: { x: 0, y: 0, z: 0 } } }),
  Imu: () => ({ orientation: { x: 0, y: 0, z: 0, w: 1 }, angular_velocity: { x: 0, y: 0, z: 0 }, linear_acceleration: { x: 0, y: 0, z: 0 } }),
};

export const rcljs = {
  Node,
  create_node: (name) => new Node(name),
  ok: () => true,
};
