/** Keep the MV3 worker reachable while a reading surface is open.
 * Only extension messages are sent; this never calls the model or the network.
 */
export function connectSurface(name: 'content' | 'panel' | 'reader') {
  const port = chrome.runtime.connect({ name });
  const timer = setInterval(() => {
    try { port.postMessage({ type: 'PING' }); }
    catch { clearInterval(timer); }
  }, 20000);
  port.onDisconnect.addListener(() => clearInterval(timer));
  return {
    port,
    disconnect() { clearInterval(timer); port.disconnect(); },
  };
}
