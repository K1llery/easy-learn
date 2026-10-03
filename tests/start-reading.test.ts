// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { startCurrentPage } from '../src/ui/start-reading';

afterEach(() => vi.unstubAllGlobals());

it('injects the reader into the active tab when the toolbar popup opens', async () => {
  const query = vi.fn().mockResolvedValue([{ id: 17 }]);
  const executeScript = vi.fn().mockResolvedValue([]);
  vi.stubGlobal('chrome', { tabs: { query }, scripting: { executeScript } });
  await startCurrentPage();
  expect(query).toHaveBeenCalledWith({ active: true, lastFocusedWindow: true });
  expect(executeScript).toHaveBeenCalledWith({ target: { tabId: 17 }, files: ['content.js'] });
});

it('reports when there is no active tab and does not inject', async () => {
  const query = vi.fn().mockResolvedValue([{}]);
  const executeScript = vi.fn();
  vi.stubGlobal('chrome', { tabs: { query }, scripting: { executeScript } });
  await expect(startCurrentPage()).rejects.toThrow('没有找到当前页面。');
  expect(executeScript).not.toHaveBeenCalled();
});
