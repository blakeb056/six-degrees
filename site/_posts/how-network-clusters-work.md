---
title: How network clusters work: community detection and force simulation
description: How Sixgree discovers clusters in your LinkedIn connections, balances physical force layouts, and reveals your real professional circles without manual tagging.
date: 2026-10-07
tags: [clusters, visualisation, algorithm]
image: /img/app/lab-clusters.jpg
---

When you look at a spreadsheet of 1,000 professional contacts, every name looks equal. In reality, networks are not flat lists; they are dense, overlapping communities held together by shared history, past companies, and mutual circles.

Sixgree groups your connections into **clusters** visually and mathematically. This guide explains how our clustering engine works, why force simulations reveal your natural groups, and how to read the clusters across your map.

## What is a network cluster?

A cluster (or community) is a group of people who are connected more densely to one another than to the rest of the network. 

In a typical career graph, you rarely have one homogeneous network. Instead, you have distinct islands:
- **Alumni clusters**: classmates, professors, and lab partners from university.
- **Past company hubs**: former coworkers, engineers, and managers from a previous employer.
- **Industry circles**: investors, advisors, founders, or specialists you met through conferences or sector meetups.

Sixgree detects these groups automatically, without requiring you to manually assign tags or organize folders.

## Force simulation: turning relationships into physics

Rather than rendering your connections in rigid rows or arbitrary charts, Sixgree treats your network as a **physical particle system**:

1. **Repulsion (The Coulomb Force)**: Every person acts like a charged particle pushing other dots away. This prevents clutter and spreads unconnected people apart.
2. **Attraction (Spring Links)**: Mutual ties and shared circles act like springs pulling connected people toward each other.
3. **Centering & Rings**: Key connectors and high-power catalysts are drawn toward the core, while distant acquaintances naturally settle along outer orbits.

When the physics simulation runs, tightly interlinked groups pull inward toward a common center of gravity, naturally forming distinct visual clusters separated by empty space.

![Network clusters settled in the physics lab](/img/app/lab-clusters.jpg "Clusters separated by natural repulsive and link forces.")

## Community detection without cloud processing

Most social graph tools upload your address book to a server to run heavy graph algorithms. Sixgree runs all community detection and physics calculations **locally on your machine** inside your browser or native desktop app:

- **Local SQLite adjacency**: Mutual links are queried directly from your local SQLite database.
- **Real-time relaxation**: The force engine stabilizes in seconds on consumer hardware.
- **Privacy preservation**: Your clusters never leave your device. Nobody else sees how your network partitions into communities.

## What clusters tell you about your reach

Reading your clusters gives you strategic clarity that a standard search bar cannot:

- **Bridging connectors**: Notice the individual dots suspended *between* two distinct clusters? Those are your rare bridge contacts—people who have feet in both worlds (e.g., an ex-colleague who joined a venture firm). They are often your highest-value warm intro paths.
- **Isolated silos**: Clusters with very few cross-links to the rest of your network represent untapped reach into new industries or regions.
- **Network health**: A balanced multi-cluster graph indicates a resilient career network, whereas a single giant clump suggests vulnerability to shifts in a single company or market.

You can tune link strength, repulsion, and cluster presets directly in the Galaxy's **Physics Lab** under the Filters panel.
