# Support heads-up — WPR Front Debugging Tool 3.0.0

Fill the two placeholders (`<release date>`, `<contact>`), then send to the support team before the 3.0.0 rollout.

---

**Subject: WPR Front Debugging Tool 3.0.0 — the browser will ask you to accept a new permission**

Hi team,

Version 3.0.0 of the WPR Front Debugging Tool reaches your browser automatically on <release date>. It is a rebuilt, faster tool with new features (Exclusion Builder, RUCSS Tester, Beacon Tester, LCP & Vitals, an on-page detection widget, a status dot on the toolbar icon and a command palette); a What's new tab opens once after the update to show them.

**What you will see (Chrome, Edge):** after the update the browser turns the extension off and says it needs a new permission: **"Access the page debugger backend"**. The extension stays off until you accept it.

**How to turn it back on:** open the browser's extensions page (`chrome://extensions` in Chrome), find WPR Front Debugging Tool and accept the new permission; the extension turns back on. Your settings are kept.

**Why the permission exists:** the new Exclusion Builder rewrites the page before the browser reads it, so you can try Delay JavaScript, defer and LazyLoad exclusions on a live page without changing the site. Only that tool uses it, only on a tab where you start a builder session (Apply), and the browser shows its "started debugging this browser" bar while it runs; Stop or closing the tab ends it. No other feature uses it, and no page data leaves your browser because of it.

**Other changes you will notice:**

- Clicking the toolbar icon opens the command palette on the page; the popup and the Diagnoser are gone. The support report is in DevTools → WPR FDT → Detections → **Copy report**.
- If you still have WPR Inspector installed, you can uninstall it: everything it did is now in this extension except its Alt+H strip toggle — turn the detection widget on or off from the right-click menu or the command palette (Alt+K, ⌥K on macOS, by default).

**Firefox:** the Firefox build has no debugger permission (its Exclusion Builder uses another mechanism), so nothing is turned off. The first time you run the RUCSS Tester or open PageSpeed Insights, a tab asks whether the extension may share the page address with that service; it asks once per tool.

Questions: <contact>.
