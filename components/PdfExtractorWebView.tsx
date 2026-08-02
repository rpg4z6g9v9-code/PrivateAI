/**
 * PdfExtractorWebView.tsx — Hidden pdf.js text extractor
 *
 * Renders an invisible WebView running a locally-bundled pdf.js (no CDN —
 * this app is offline-first). Feed it a base64 PDF via the imperative
 * `extractText()` ref method; it returns concatenated per-page text, or an
 * empty string if extraction fails, times out, or the PDF has no text layer
 * (e.g. a scanned/image-only PDF) — callers should treat '' as "fall back
 * to filename-only" rather than an error.
 */

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { Asset } from 'expo-asset';
import * as FileSystemLegacy from 'expo-file-system/legacy';

import pdfLibAssetModule from '@/assets/pdfjs/pdf.min.jslib';
import pdfWorkerAssetModule from '@/assets/pdfjs/pdf.worker.min.jslib';

const READY_TIMEOUT_MS = 15_000;   // asset load + WebView boot + pdf.js parse
const EXTRACT_TIMEOUT_MS = 30_000; // large/multi-page PDFs can take a while

export interface PdfExtractorHandle {
  extractText: (base64: string) => Promise<string>;
}

/** Escapes `</script` so pdf.js source (or JSON-encoded worker source) can't break out of its inline <script> tag. */
function escapeScriptClose(text: string): string {
  return text.replace(/<\//g, '<\\/');
}

function buildExtractorHtml(libSrc: string, workerSrc: string): string {
  const safeLibSrc = escapeScriptClose(libSrc);
  const workerJson = escapeScriptClose(JSON.stringify(workerSrc));

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body>
<script>
${safeLibSrc}
</script>
<script>
(function () {
  function post(msg) {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(msg));
  }

  try {
    var workerSrc = ${workerJson};
    var workerBlob = new Blob([workerSrc], { type: 'application/javascript' });
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(workerBlob);
  } catch (e) {
    post({ type: 'ready', ok: false, error: 'worker setup failed: ' + (e && e.message ? e.message : e) });
    return;
  }

  function base64ToBytes(base64) {
    var binary = atob(base64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  async function extract(id, base64) {
    try {
      var pdf = await window.pdfjsLib.getDocument({ data: base64ToBytes(base64) }).promise;
      var parts = [];
      for (var p = 1; p <= pdf.numPages; p++) {
        var page = await pdf.getPage(p);
        var content = await page.getTextContent();
        parts.push(content.items.map(function (it) { return it.str || ''; }).join(' '));
      }
      post({ type: 'result', id: id, ok: true, text: parts.join('\\n') });
    } catch (e) {
      post({ type: 'result', id: id, ok: false, error: String(e && e.message ? e.message : e) });
    }
  }

  function onMessage(e) {
    var msg;
    try { msg = JSON.parse(e.data); } catch (err) { return; }
    if (msg && msg.type === 'extract') extract(msg.id, msg.base64);
  }

  window.addEventListener('message', onMessage);   // iOS
  document.addEventListener('message', onMessage);  // Android

  post({ type: 'ready', ok: true });
})();
</script>
</body>
</html>`;
}

const PdfExtractorWebView = forwardRef<PdfExtractorHandle>((_props, ref) => {
  const webviewRef = useRef<WebView>(null);
  const [html, setHtml] = useState<string | null>(null);

  const readyRef = useRef(false);
  const readyOkRef = useRef(false);
  const readyWaitersRef = useRef<(() => void)[]>([]);
  const pendingRef = useRef(
    new Map<string, { resolve: (text: string) => void; timer: ReturnType<typeof setTimeout> }>()
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const libAsset = Asset.fromModule(pdfLibAssetModule);
        const workerAsset = Asset.fromModule(pdfWorkerAssetModule);
        await Promise.all([libAsset.downloadAsync(), workerAsset.downloadAsync()]);
        if (!libAsset.localUri || !workerAsset.localUri) throw new Error('pdf.js asset localUri missing');

        const [libSrc, workerSrc] = await Promise.all([
          FileSystemLegacy.readAsStringAsync(libAsset.localUri),
          FileSystemLegacy.readAsStringAsync(workerAsset.localUri),
        ]);

        if (!cancelled) setHtml(buildExtractorHtml(libSrc, workerSrc));
      } catch (e) {
        console.warn('[PdfExtractor] Failed to load pdf.js assets:', e);
        // Leave html null — extractText() below times out gracefully via waitForReady().
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const resolveReady = (ok: boolean) => {
    readyRef.current = true;
    readyOkRef.current = ok;
    readyWaitersRef.current.forEach(fn => fn());
    readyWaitersRef.current = [];
  };

  const waitForReady = (timeoutMs: number): Promise<void> => {
    if (readyRef.current) return Promise.resolve();
    return new Promise(resolve => {
      const timer = setTimeout(resolve, timeoutMs);
      readyWaitersRef.current.push(() => { clearTimeout(timer); resolve(); });
    });
  };

  const handleMessage = (event: WebViewMessageEvent) => {
    let msg: { type?: string; id?: string; ok?: boolean; text?: string };
    try {
      msg = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }

    if (msg.type === 'ready') {
      resolveReady(!!msg.ok);
      return;
    }

    if (msg.type === 'result' && msg.id) {
      const pending = pendingRef.current.get(msg.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      pendingRef.current.delete(msg.id);
      pending.resolve(msg.ok ? (msg.text ?? '') : '');
    }
  };

  useImperativeHandle(ref, () => ({
    extractText: async (base64: string): Promise<string> => {
      await waitForReady(READY_TIMEOUT_MS);
      if (!readyOkRef.current || !webviewRef.current) return '';

      return new Promise<string>(resolve => {
        const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
        const timer = setTimeout(() => {
          pendingRef.current.delete(id);
          resolve('');
        }, EXTRACT_TIMEOUT_MS);
        pendingRef.current.set(id, { resolve, timer });
        webviewRef.current!.postMessage(JSON.stringify({ type: 'extract', id, base64 }));
      });
    },
  }), []);

  if (!html) return null;

  return (
    <View style={styles.hidden} pointerEvents="none">
      <WebView
        ref={webviewRef}
        originWhitelist={['*']}
        source={{ html }}
        onMessage={handleMessage}
        javaScriptEnabled
      />
    </View>
  );
});

PdfExtractorWebView.displayName = 'PdfExtractorWebView';
export default PdfExtractorWebView;

const styles = StyleSheet.create({
  // Off-screen rather than 0x0 — some Android WebView versions skip
  // load/JS-execution entirely for zero-size views.
  hidden: { position: 'absolute', width: 1, height: 1, top: -1000, left: -1000, opacity: 0 },
});
