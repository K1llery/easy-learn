import { useEffect, useRef, useState } from 'react';

// Ignore late responses after switching to another exercise or closing the panel.
export function useAction() {
  const [busy, setBusy] = useState(''), [error, setError] = useState('');
  const epoch = useRef(0), running = useRef(false);
  useEffect(() => () => { epoch.current++; }, []);
  async function run<T>(label: string, work: () => Promise<T>, accept: (data: T) => void) {
    if (running.current) return;
    running.current = true;
    const current = ++epoch.current;
    setBusy(label); setError('');
    try { const data = await work(); if (epoch.current === current) accept(data); }
    catch (e) { if (epoch.current === current) setError(e instanceof Error ? e.message : '操作未完成，请重试。'); }
    finally { running.current = false; if (epoch.current === current) setBusy(''); }
  }
  return { busy, error, run };
}
