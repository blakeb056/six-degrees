---
title: The Eigenvector effect: how an account with under 200 connections reached the global C-suite
description: Why degree centrality fails on professional networks, how triadic closure creates an 80% acceptance surge, and how transitive trust collapses social distance.
date: 2026-10-08
tags: [graph-theory, network-science, outreach]
image: /img/app/hero.jpg
---

Most people treat professional networking like a lottery: add 5,000 strangers, post generic industry platitudes, send cold messages into executive inboxes, and hope a 1.5% reply rate yields a meeting.

In August, we tested a completely different hypothesis.

We spun up a new account. Two months in, it has **fewer than 200 total connections**. No mass invite automations. No engagement pods. No paid sponsored messages.

Yet right now, looking at the network graph:

- **1st-Degree (Direct Connections):**
  - The Chief Operating Officer of one of the world's three largest tech giants (overseeing their flagship productivity suite and AI copilot ecosystem)
  - The former President of Worldwide Advertising at a major global streaming platform and former Chief Business Officer of a top-tier social network
  - The Global Head of Sports at the world's most valuable consumer hardware company
  - A member of the British House of Lords who serves as Chief Diversity Officer at a global mobility giant
  - A Vice President at a top-5 Fortune retailer and early advertising leader at Meta
  - An executive Managing Director at Google Cloud leading entertainment, media, and gaming

- **2nd-Degree (Exactly One Introduction / Mutual Away):**
  - The President of Global Partnerships & Corporate Development at Alphabet (the architect who executed acquisitions of DeepMind, Android, and Nest)
  - The President of Americas at Google (commanding an ad engine responsible for $100B+ in annual revenue)
  - A Group Partner at Y Combinator who leads AI batches
  - The sitting CEO of a public Fortune 500 manufacturing titan
  - The Corporate EVP & President of North America for the world's most iconic beverage brand
  - Senior leadership / VP of Global Integrity at OpenAI
  - Elite system software and partner engineering directors at NVIDIA
  - A Vice President at a $14B autonomous defense-tech powerhouse
  - Public company CFOs across gaming, e-commerce, and social media

When people look at an executive roster like this, their default assumption is that building it takes a decade of follower farming or raising a massive venture round.

Neither is true. This is the direct mathematical result of **graph theory, network sociology, and transitive trust**.

![Network Galaxy Visualization](/img/app/hero.jpg "The Network Galaxy: Force simulation clustering professional connections by structural density and mutual affinity.")

## 1. The fallacy of degree centrality: why vanity follower counts fail

In graph theory, there are two primary ways to measure how important a node is in a network:

1. **Degree Centrality:** How many direct edges (connections) a node has. A creator with 30,000 random connections has high degree centrality.
2. **Eigenvector Centrality:** Not just how many people you know, but *how well-connected the people you know are*.

When you chase raw connection count, you optimize for degree centrality. You connect horizontally with thousands of peripheral contacts. In the graph, your edges point outward into low-density clusters.

When an executive receives an invitation from a profile with 3,000 random connections and zero mutual relationships, their psychological spam filter activates instantly:

*Who is this? Why are they messaging me? What are they trying to sell?*

In contrast, **eigenvector centrality** measures your connection to power hubs. If you have direct edges to just **three individuals** who possess immense network centrality, your eigenvector centrality surges exponentially.

You don't need 10,000 edges. You need three structural bridges.

![Power Index Scoring](/img/app/power-index.jpg "Power Index Scoring: Ranking nodes across institutional seniority, company prestige, and market capital.")

## 2. Triadic closure: why mutual connections melt the corporate wall

Why does an executive who ignores 99% of cold outreach accept a request from an account with under 200 connections?

The answer was first formalized by sociologist Georg Simmel in 1908 and later proven in modern network science by Mark Granovetter: **The Principle of Triadic Closure**.

```
                       [ Traditional Connection Farming ]
                    5,000+ Disconnected Nodes (Low Centrality)
                         (No Transitive Trust / High Noise)

                                        vs.

                        [ The Graph-Engineered Network ]
                                     YOU
                                   ( <200 )
                                   /  |   \
                     [Bridge Node]   [Bridge Node]   [Bridge Node]
                     (Google EVP)     (Media Titan)    (VC Partner)
                           |               |               |
                    [Alphabet M&A]    [Fortune 500]   [OpenAI / YC]
```

If Node A is connected to Node B, and Node B is connected to Node C, there is natural topological pressure for an edge to form between Node A and Node C.

Human beings use **shared nodes as social heuristics**.

A senior executive receives dozens of inbound requests every day. They cannot perform due diligence on every individual. Instead, their brain searches for a single high-signal heuristic:

**Who do we know in common?**

- If the answer is **0 mutual connections**, you are an unknown stranger.
- If the answer is a peripheral acquaintance, you are background noise.
- But if the mutual connection is **someone they worked alongside for years, someone on their board, or a former C-suite colleague they deeply respect**, the calculation flips entirely.

The barrier disappears.

![Bridge Chains View](/img/app/bridge-chains.jpg "Bridge Chains: Mapping the exact one-hop warm introduction path to high-power institutional targets.")

## 3. The empirical proof: the 20% to 80% phase shift

This is not just intuitive psychology; it has been rigorously proven in peer-reviewed empirical research.

In a landmark social network study conducted across large-scale social graphs (published in *ACM CCS* by researchers from the University of British Columbia and Cornell), researchers measured the exact probability of an invitation being accepted based on mutual connection count:

```
Connection Request Acceptance Rate by Mutual Connection Count
────────────────────────────────────────────────────────────────
0 Mutual Connections:     ████ 18% - 20%
1 - 2 Mutual Connections: █████████ 45%
3 - 5 Mutual Connections: ████████████ 58%
6 - 10 Mutual Connections: ██████████████ 68%
11+ Mutual Connections:   ████████████████ 81%
────────────────────────────────────────────────────────────────
(Data: Boshmaf et al., ACM Conference on Computer and Communications Security)
```

The data reveals a non-linear phase shift:

1. **At 0 mutuals**, acceptance sits at **~18% to 20%**. You are fighting cold odds.
2. **At just 1 to 2 mutuals**, acceptance jumps to **45%**—more than doubling your reach immediately.
3. **At 11+ mutuals**, acceptance surges to **over 80%**.

The presence of high-reputation mutual connections transforms cold outreach into a warm introduction without either party speaking a word.

![Degrees of Separation Collapsing](/img/app/separation.jpg "Degrees of Separation: Collapsing the social graph from 6 degrees to 2 degrees via targeted bridge hubs.")

## 4. Transitive trust and status spillover

Two sociological mechanisms drive this phase shift:

### Transitive Trust (James Coleman, 1988)
In social capital theory, trust is transitive. If Person A trusts Person B, and Person B trusts Person C, Person A extends a default presumption of competence and legitimacy to Person C.

When an industry leader sees that you are connected to their longtime friend or former C-suite peer, they do not care that your account has under 200 connections. They conclude that if their respected colleague vetted and connected with you, you are credible.

The trust of the bridge node transfers to you.

### Status Spillover (Joel Podolny)
Sociologist Joel Podolny established that in markets with high information asymmetry, market participants assess an unknown entity's quality based on the status of its network ties.

If your network is composed of high-caliber engineers, founders, and executives, your perceived status inherits the characteristics of the cluster. **Network proximity is a proxy for credibility.**

## 5. How to engineer your graph

If you want to build a high-leverage professional network, stop treating your contact list as an address book and start treating it as a **directed graph**:

### 1. Stop lateral expansion; find the bridge nodes
Stop sending 50 connection requests a week to peers in your exact role. Identify the **super-connectors** in your ecosystem—people who have moved between top companies, served on boards, or advised early-stage startups.

Connecting with **one** bridge node gives you immediate 2nd-degree access to their entire historical career tree.

### 2. Quality over volume
An account with 150 curated connections consisting of domain experts, founders, and executives has a far higher topological value than an account with 8,000 unvetted contacts. High-signal accounts attract high-signal connections.

### 3. Let triadic closure do the heavy lifting
Once you establish two or three anchor connections in an ecosystem, your subsequent requests to leaders in that same vertical will show multiple high-trust mutual connections. 

At that point, you are not doing cold outreach anymore. You are stepping into a room where the host has already nodded at you.

## The architecture of access

We are taught that career advancement is linear: work hard, collect business cards, and slowly climb a corporate ladder over thirty years.

Graph theory proves that human networks are **small-world networks**. As Milgram demonstrated in 1967, and modern graph research verified across 1.59 billion people, the average distance between any two people on Earth is not six degrees—it is **3.57 degrees**.

The barrier between where you are today and the people who can change your trajectory is not thousands of miles or millions of dollars.

It is usually just two well-chosen edges in a graph.
