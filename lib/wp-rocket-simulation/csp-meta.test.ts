/**
 * Which `<meta>` policies a browser applies — each rule receipted in
 * Chromium 156 + Firefox 155 where a page could tell (body, implied head
 * end, text in head, `<template>`, `<noscript>`, after `</head>`, report-only,
 * entity-encoded content).
 */
import { describe, expect, it } from 'vitest';
import { cspMetaPolicies } from './csp-meta';

/** A CSP meta tag. */
const meta = (content: string, equiv = 'Content-Security-Policy'): string =>
  `<meta http-equiv="${equiv}" content="${content}">`;

/** The contents found (fails the test on an unreadable set). */
const contents = (html: string): string[] => {
  const { metas, unreadable } = cspMetaPolicies(html);
  if (unreadable) throw new Error(`unreadable metas in ${html}`);
  return metas.map((m) => m.content);
};

describe('cspMetaPolicies', () => {
  it('finds head metas with their offsets, in order', () => {
    const html = `<!doctype html><html><head>${meta('a')}<title>t</title>${meta('b')}</head><body></body></html>`;
    expect(cspMetaPolicies(html)).toEqual({
      metas: [
        { content: 'a', offset: html.indexOf(meta('a')) },
        { content: 'b', offset: html.indexOf(meta('b')) }
      ],
      unreadable: false
    });
  });

  it('keeps a meta before <head> (implied head) and one after </head> before the body', () => {
    expect(contents(`<html>${meta('pre')}<head></head>${meta('post')}<body>`)).toEqual([
      'pre',
      'post'
    ]);
  });

  it('ignores metas in the body: after <body>, a non-head element, or text', () => {
    expect(contents(`<head></head><body>${meta('a')}`)).toEqual([]);
    expect(contents(`<head><div></div>${meta('a')}</head>`)).toEqual([]);
    expect(contents(`<head>hello${meta('a')}</head>`)).toEqual([]);
    expect(contents(`<head></br>${meta('a')}`)).toEqual([]);
  });

  it('U+FEFF is text (it ends the head), unlike TAB, LF, FF, CR and SPACE', () => {
    expect(contents(`<html>\uFEFF${meta('a')}<head>`)).toEqual([]);
    expect(contents(`<head><script></script>\uFEFF${meta('a')}`)).toEqual([]);
    expect(contents(`<html>\t\n\f\r ${meta('a')}<head>`)).toEqual(['a']);
  });

  it('comments, doctypes and whitespace between tags are not text', () => {
    expect(
      contents(`<!DOCTYPE html>\n<!-- c --><!--><!---><?pi?>\n<head> <!-- x -->${meta('a')}`)
    ).toEqual(['a']);
  });

  it('ignores metas inside template and noscript, and their content does not end the head', () => {
    expect(
      contents(
        `<head><template><div>x</div>${meta('t')}</template><noscript>${meta('n')}</noscript>${meta('a')}`
      )
    ).toEqual(['a']);
    expect(contents(`<head><template/>${meta('t')}</template>${meta('a')}`)).toEqual(['a']);
  });

  it('ignores report-only, other http-equiv, missing or empty content', () => {
    expect(
      contents(
        `<head>${meta('r', 'Content-Security-Policy-Report-Only')}${meta('x', 'refresh')}<meta http-equiv="content-security-policy"><meta http-equiv="CONTENT-SECURITY-POLICY" content="">${meta('ok')}`
      )
    ).toEqual(['ok']);
  });

  it('decodes character references and reads the first of repeated attributes', () => {
    expect(
      contents(
        `<head><meta http-equiv="content-security-policy" content="script-src &#39;self&#x27;" content="b">`
      )
    ).toEqual(["script-src 'self'"]);
  });

  it('decodes ASCII named references (a newline separates tokens)', () => {
    expect(contents(`<head>${meta('a&NewLine;b&semi;c&plus;')}`)).toEqual(['a\nb;c+']);
  });

  it('flags an applied CSP meta (or its http-equiv) holding an unread reference', () => {
    const unread = { metas: [], unreadable: true };
    expect(cspMetaPolicies(`<head>${meta('script-src &#39;self&#39;&nbsp;')}`)).toEqual(unread);
    expect(cspMetaPolicies(`<head>${meta('a', 'x&copy;')}`)).toEqual(unread);
    // Still a head element: readable metas around it are kept, the scan goes on.
    const around = `<head>${meta('a')}${meta('x&nbsp;')}${meta('b')}`;
    expect(cspMetaPolicies(around)).toEqual({
      metas: [
        { content: 'a', offset: around.indexOf(meta('a')) },
        { content: 'b', offset: around.indexOf(meta('b')) }
      ],
      unreadable: true
    });
    // Not applied (in the body), or not a CSP meta: still readable.
    expect(contents(`<body>${meta('a&nbsp;')}`)).toEqual([]);
    expect(contents(`<head><meta http-equiv="refresh" content="&nbsp;">`)).toEqual([]);
  });

  it('a raw-text element in head hides markup-looking text', () => {
    expect(contents(`<head><script>"<body>"</script><style>a{}</style>${meta('a')}`)).toEqual([
      'a'
    ]);
  });

  it('nothing in a document without metas', () => {
    expect(contents('')).toEqual([]);
    expect(contents('<p>x</p>')).toEqual([]);
  });
});
