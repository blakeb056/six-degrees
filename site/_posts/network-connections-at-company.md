---
title: How to find your network connections at a company with Sixgree
description: Find people you know at a target company, inspect mapped introduction paths in Sixgree, and separate direct connections from incomplete second-degree data.
date: 2026-10-05
tags: [network, company search, network mapping]
image: /img/app/paths.jpg
---

To find your network connections at a company, start with a people search and filter by **Current company** and **Connections**. In Sixgree, use **Paths → Companies** to explore the people at that company in your local network. If you have mapped their circles, use **Separation** to inspect possible ways in beyond your direct connections.

These are different views of the question. The platform helps you find profiles. Sixgree helps you understand the company and introduction routes in the data you've already collected. Neither a company label nor a connection badge guarantees someone can refer you.

## Start with the company and a specific question

“Who do I know at this company?” is a better starting point than “Who has the biggest title?” Choose what you need:

- Someone who can explain how a team works.
- A former colleague who can tell you about their experience there.
- A possible bridge to a relevant person you haven't met.

Keep current and former employees separate. Both may have useful context, but a past job is not evidence of a current role or an active referral relationship.

## Find direct connections on the platform

Enter a company or a relevant person's name in the platform's search bar, then choose **People**. Use the available filters to narrow the result to the company and first-degree connections. If a filter is not visible, look in **All filters**.

The platform's own help pages explain its search categories and list the company and connection filters. Use them if the layout differs from what you see.

You can also look at second-degree results. That is a starting point for checking mutual connections, not permission to assume every mutual knows the person well. Read [what the connection degrees mean](/blog/network-connection-degrees/) before treating them as an introduction plan.

## Explore the company in Sixgree

Open **Paths**, then choose **Companies**. Pick a company to inspect the people recorded under it. The view groups people by role seniority and shows their connection status where available.

The company list comes from your current network data, including company information saved with those people. It is not a live employee directory, an organizational chart supplied by the employer, or a list of everyone who works there.

Use the view to separate two questions:

1. **Who is already a direct connection?** Start with people you can reasonably contact yourself.
2. **Who appears beyond my direct network?** Look for a recorded path before choosing a bridge.

Check each person's card rather than relying on the size of a company bubble or a seniority grouping. The [Paths implementation](https://github.com/blakeb056/six-degrees/blob/main/app/paths/page.js) is public, including how the company index is built.

## Inspect ways in, not just a target's name

In **Separation**, a search can look through a person's name, headline, company, role and recorded bridges. Search for the target company or a specific person, then inspect the routes shown for a matching person.

If several direct connections lead to them, compare the relationships you actually have with those bridges. A former teammate you know well may be a better first conversation than a higher-scored contact you have never spoken to.

A connection's **only through** count describes people found exclusively through that connection among your mapped circles. It can reveal a distinct part of your network. It does not measure how likely they are to introduce you to a particular person.

For the counts behind that distinction, see [how Sixgree ranks your ways in](/blog/who-can-introduce-you/). The [Separation data model](https://github.com/blakeb056/six-degrees/blob/main/lib/separation.js) also shows exactly what the search and recorded routes contain.

## Know which results your data supports

| Data you have | What you can reasonably inspect |
|---|---|
| Official Connections.csv | Direct connections and the company fields in that export. |
| Mapped circle data | Additional people and the routes recorded through your connections. |
| Invented sample network | A way to learn the views, not evidence about your own reach. |

A [CSV import](/blog/network-csv/) cannot show who your connections know. An empty company or route result can mean the information is missing, stale or stored under a different company name. It is not proof that you have no route there.

Sixgree has an optional company scan, marked experimental in the app. It is not needed to inspect an existing company view, and you should not use it just because a result is empty. Any automated scanning carries account risk; read [the scanning guide](/blog/scanning-slowly/) before deciding.

## Turn the search into one useful conversation

Write down the person, the company, the possible bridge and what you still need to check. Confirm current employment on the person's profile before acting on older data. Then ask the person you know whether they are comfortable helping.

For example: “I'm learning about the product team at this company. Do you still work with anyone there who might be open to a short conversation? No problem if not.”

That is a request for context, not a demand for a referral. The [warm-introduction guide](/blog/network-warm-introduction/) gives you templates for the next step.

[Download Sixgree](/download/) to try the company and route views on the invented sample before bringing in your own network. Your local network is not uploaded to a Sixgree cloud account.

Sixgree is not affiliated with any networking platform.
