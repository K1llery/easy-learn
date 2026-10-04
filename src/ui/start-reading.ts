/** Inject the reader into the tab that the user activated with the extension button. */
export async function startCurrentPage() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id === undefined) throw new Error('没有找到当前页面。');
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      (
        globalThis as typeof globalThis & { __easyLearn?: { toggle(): void } }
      ).__easyLearn?.toggle();
    },
  });
}
