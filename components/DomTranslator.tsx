'use client';
import { useEffect } from 'react';

// 画面上の日本語テキストを、選択言語に自動置換する。
// 訳はAIで一度だけ生成→DB＋localStorageにキャッシュ→以後は即時置換。
// テキストノードに加え placeholder / title / aria-label 属性も対象。
const JA_RE = /[぀-ゟ゠-ヿ㐀-鿿]/; // ひらがな・カタカナ・漢字
const ATTRS = ['placeholder', 'title', 'aria-label'];

export const LANG_KEY = 'bodylog-lang';

export default function DomTranslator() {
  useEffect(() => {
    const lang = localStorage.getItem(LANG_KEY) || 'ja';
    if (lang === 'ja') return;

    const dictKey = `bodylog-dict-${lang}`;
    let dict: Record<string, string> = {};
    try { dict = JSON.parse(localStorage.getItem(dictKey) || '{}'); } catch { /* 破損時は空から */ }
    const translatedValues = new Set(Object.values(dict));
    const pending = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;
    let disposed = false;
    let failures = 0;

    const want = (key: string): boolean =>
      !!key && key.length <= 80 && JA_RE.test(key) && !translatedValues.has(key);

    const applyText = (node: Text) => {
      const raw = node.nodeValue || '';
      const key = raw.trim();
      if (!want(key)) return;
      const dst = dict[key];
      if (dst) {
        if (dst !== key) node.nodeValue = raw.replace(key, dst);
      } else {
        pending.add(key);
        schedule();
      }
    };

    const applyAttrs = (el: Element) => {
      for (const a of ATTRS) {
        const v = el.getAttribute(a);
        if (!v) continue;
        const key = v.trim();
        if (!want(key)) continue;
        const dst = dict[key];
        if (dst) { if (dst !== key) el.setAttribute(a, dst); }
        else { pending.add(key); schedule(); }
      }
    };

    const walk = (root: Node) => {
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let n: Node | null;
      while ((n = w.nextNode())) applyText(n as Text);
      if (root.nodeType === Node.ELEMENT_NODE || root.nodeType === Node.DOCUMENT_NODE) {
        const rootEl = root as Element | Document;
        if (root.nodeType === Node.ELEMENT_NODE) applyAttrs(root as Element);
        rootEl.querySelectorAll(ATTRS.map((a) => `[${a}]`).join(',')).forEach(applyAttrs);
      }
    };

    const schedule = () => {
      if (timer || inFlight || disposed || failures >= 3) return;
      timer = setTimeout(flush, 400);
    };

    const flush = async () => {
      timer = null;
      if (disposed || pending.size === 0) return;
      const texts = [...pending].slice(0, 80);
      texts.forEach((t) => pending.delete(t));
      inFlight = true;
      try {
        const res = await fetch('/api/i18n', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lang, texts }),
        });
        const j = await res.json();
        if (j.map && Object.keys(j.map).length > 0) {
          Object.assign(dict, j.map);
          Object.values(j.map as Record<string, string>).forEach((v) => translatedValues.add(v));
          try { localStorage.setItem(dictKey, JSON.stringify(dict)); } catch { /* 容量超過は無視 */ }
          walk(document.body);
          failures = 0;
        } else {
          failures++;
          console.warn('[i18n] translation failed:', j.error || res.status);
        }
      } catch (e) {
        failures++;
        console.warn('[i18n] request failed:', e);
      }
      inFlight = false;
      if (pending.size > 0) schedule();
    };

    walk(document.body);
    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === 'characterData' && m.target.nodeType === Node.TEXT_NODE) {
          applyText(m.target as Text);
        }
        if (m.type === 'attributes' && m.target.nodeType === Node.ELEMENT_NODE) {
          applyAttrs(m.target as Element);
        }
        m.addedNodes.forEach((n) => {
          if (n.nodeType === Node.TEXT_NODE) applyText(n as Text);
          else if (n.nodeType === Node.ELEMENT_NODE) walk(n);
        });
      }
    });
    mo.observe(document.body, {
      subtree: true, childList: true, characterData: true,
      attributes: true, attributeFilter: ATTRS,
    });

    return () => { disposed = true; mo.disconnect(); if (timer) clearTimeout(timer); };
  }, []);

  return null;
}
