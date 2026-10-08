---
title: Is scanning your network against the rules? What really happens, and how to stay safe
description: Plainly, automated scanning is against the platform's terms. Here's what the risk looks like in practice (warnings and temporary holds, not bans, in every case we've recorded), what to do after a warning, and how Sixgree paces itself.
date: 2026-10-06
tags: [network, scanning, safety, terms]
image: /img/app/scan-budget.jpg
---

**Automated scanning may violate the platform's terms.** Those terms prohibit using software or scripts to copy data from the service. Sixgree's scanner reads your network in a Chrome window signed into your own account, so using it is a choice you make about your own account, and we'd rather you make it knowing exactly what that means.

The good news is that the risk is gradual, visible and recoverable, and you control most of it.

## What actually happens when the platform pushes back

In the cases we have on record, the platform **warned first** and any restriction was **temporary**:

- **A warning** during a run: an unusual-activity notice or a security check. Nothing is lost; it's the platform asking you to slow down.
- **A temporary hold**: on 9 September 2026 a test account that kept mapping circles for about an hour, after a warning had already appeared, was restricted with a day's notice and released the same evening. On 28 September another was held after 373 searches in 24 hours, run back to back with the daily limit raised far past the default.

We have no record of an account being permanently banned for using Sixgree. That's a record, not a promise: the platform decides, and it doesn't publish its limits. Both holds came from pushing well past the defaults, and both came after a warning that was ignored.

## How to keep the risk low

- **Stay on Medium or Slow.** Fast is there for small, occasional rounds. Medium and Slow read like a person who's looking carefully.
- **Keep the default daily limit** (50 searches a day). It leaves room under limits the platform doesn't publish.
- **After a warning, stop for a day.** Don't press *Lift limits for this session* and carry on: continuing straight after a warning is what turned a warning into a hold both times. Wait about 24 hours, then come back on Slow or Medium with a small round.
- **Map in rounds, not marathons.** 5 to 10 circles at a time, spread over days, builds the same map with a fraction of the risk.
- **Leave full profile reads off** unless you need past roles. Profile views are one of the actions the platform may monitor.
- **No risk at all:** import the official Connections.csv export ([here's how](/blog/export-network-connections/)) or explore the invented sample.

## What Sixgree does for you

Since those two holds, the scanner has been rebuilt around them:

- **Human pacing.** Every wait is a little different, each page gets reading time for the people on it, the page is scrolled in uneven steps, and there are short breaks and longer rests, layered on top of the waits that already worked.
- **One daily limit**, 50 by default, with profile views counted against it and never closer than a minute apart.
- **It stops at the first push-back.** A sign-in wall, a security check, a restriction notice or a "too many requests" reply ends the scan at once and starts a cooldown. It never retries those.
- **Auto scan keeps office hours.** Small sittings from 9:00 to 18:00 with long rests, and it never runs past your limit.
- **Everything is saved as it goes**, so stopping never loses what was read.

## The short version

Scanning may violate the platform's terms, and that's your call to make. If you do scan: stay on Medium or Slow, keep the default limit, and treat a warning as a day off, not a speed bump. In the cases we've recorded, that was the difference between a map and a hold.

More on how the scanner paces itself: [Scanning slowly and safely](/blog/scanning-slowly/).
