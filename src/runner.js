// Executes student code against the miniros API. Code is wrapped in an async
// function with rcljs/msgs in scope; Stop destroys all nodes and timers.
import { graph, rcljs, msgs } from './ros/miniros.js';

export class Runner {
  constructor({ onLog, onError, onStateChange }) {
    this.onLog = onLog;
    this.onError = onError;
    this.onStateChange = onStateChange;
    this.running = false;
    graph.onError = (e) => this._fail(e);
    graph.onLog = (m, level) => this.onLog(m, level === 'err' ? 'err' : 'log');
  }

  run(code) {
    if (this.running) this.stop();
    this.running = true;
    this.onStateChange(true);
    this.onLog('— running student code —', 'sys');
    try {
      // AsyncFunction so students can use await; rejections route to _fail.
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
      const fn = new AsyncFunction('rcljs', 'msgs', 'console', `"use strict";\n${code}`);
      const studentConsole = {
        log: (...a) => this.onLog(a.map(fmt).join(' '), 'log'),
        error: (...a) => this.onLog(a.map(fmt).join(' '), 'err'),
        warn: (...a) => this.onLog('WARN: ' + a.map(fmt).join(' '), 'log'),
      };
      fn(rcljs, msgs, studentConsole).catch((e) => this._fail(e));
    } catch (e) {
      this._fail(e);
    }
  }

  stop() {
    graph.reset();
    // zero the rover's command so it halts when code stops
    graph.topic('/cmd_vel', 'geometry_msgs/Twist')
      .publish({ linear: { x: 0, y: 0, z: 0 }, angular: { x: 0, y: 0, z: 0 } });
    if (!this.running) return;
    this.running = false;
    this.onStateChange(false);
    this.onLog('— stopped —', 'sys');
  }

  _fail(e) {
    const err = e instanceof Error ? e : new Error(String(e));
    this.onError(err);
    this.onLog(`${err.name}: ${err.message}`, 'err');
    if (err.stack) this.onLog(err.stack.split('\n').slice(1, 3).join('\n'), 'err');
    // Mirror rclpy: an uncaught exception terminates the program. This also
    // prevents a throwing timer from flooding the console forever.
    if (this.running) this.stop();
  }
}

function fmt(v) {
  if (typeof v === 'object') { try { return JSON.stringify(v); } catch { return String(v); } }
  return String(v);
}
