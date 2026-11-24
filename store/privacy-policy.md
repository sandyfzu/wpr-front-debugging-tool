# WPR Front Debugging Tool — Privacy policy

Effective date: <effective date>

WPR Front Debugging Tool is a browser extension made by WP Media for debugging the WP Rocket WordPress plugin on the page in your current tab. It processes the pages you debug inside your browser. It has no account, no analytics, no telemetry and no crash reporting.

## Data that leaves your browser, only when you ask

- **RUCSS Tester:** when you click Run, the tested page's address (without its fragment or any login details in it), a request timestamp, your Mobile and Home choices and your safelist entries are sent to WP Rocket's RUCSS service (`mega.wp-rocket.me`) to compute the page's used CSS. No cookies and no page content are sent.
- **PageSpeed Insights:** when you open Side By Side Performance, the page's address and its cache-bypassed copy (`?nowprocket=1`) are opened in Google PageSpeed Insights (`pagespeed.web.dev`), which is subject to Google's privacy policy.

On Firefox, each of these tools asks your permission before it first sends the address, and checks that permission on every use.

## Downloads that carry none of your data

The extension regularly downloads two public data files: the Known Conflicts list (`apps.wpr-support.com`) and WP Rocket's latest exclusion list (`b.rucss.wp-rocket.me`). These requests send no cookies and no information about you or the pages you visit, beyond what any web request carries (such as your IP address).

## Data stored in your browser, never sent by the extension

- **Sync storage**, which your browser may sync to your own browser account: your options, keyboard shortcut and the sites where you chose to show or hide the detection widget.
- **This device only** (never synced): the exclusion sets you save per site, detection widget positions, panel layout, RUCSS Tester and Beacon Tester settings, the last version whose "What's new" page was shown, and the cached public data files.
- **This browser session only** (cleared when the browser closes): Exclusion Builder sessions, whether you left the Exclusion Builder window open or folded, and simulation state per tab.
- **The debugged site's own session storage** (that tab only, cleared when it closes): while Side By Side is open, the page's address, so the comparison reopens after a reload.

## Limited Use

The use of information received by this extension adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements. Data is never sold, never used for advertising and never used for purposes unrelated to debugging WP Rocket.

## Contact

support@wp-rocket.me
