// @vitest-environment node
import { afterEach, it, expect, vi } from 'vitest';
import { connectSurface } from '../src/core/connection';
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it('keeps the worker reachable during reading and stops heartbeat on explicit close', () => {
  vi.useFakeTimers();
  const port = {
    postMessage: vi.fn(),
    disconnect: vi.fn(),
    onDisconnect: { addListener: vi.fn() },
  };
  vi.stubGlobal('chrome', { runtime: { connect: vi.fn(() => port) } });
  const connection = connectSurface('content');
  vi.advanceTimersByTime(61000);
  expect(port.postMessage).toHaveBeenCalledTimes(3);
  expect(port.postMessage).toHaveBeenLastCalledWith({ type: 'PING' });
  connection.disconnect();
  vi.advanceTimersByTime(60000);
  expect(port.postMessage).toHaveBeenCalledTimes(3);
  expect(port.disconnect).toHaveBeenCalledOnce();
});
it('stops heartbeat when the worker connection fails', () => {
  vi.useFakeTimers();
  let disconnect = () => {};
  const port = {
    postMessage: vi.fn(),
    disconnect: vi.fn(),
    onDisconnect: {
      addListener: (fn: () => void) => {
        disconnect = fn;
      },
    },
  };
  vi.stubGlobal('chrome', { runtime: { connect: () => port } });
  connectSurface('panel');
  disconnect();
  vi.advanceTimersByTime(60000);
  expect(port.postMessage).not.toHaveBeenCalled();
});
