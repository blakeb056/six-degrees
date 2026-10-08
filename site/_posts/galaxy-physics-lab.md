---
title: Inside the Galaxy physics lab, and the replay of your network growing
description: The Galaxy is a force simulation. The physics lab hands you its controls: what each slider does, the Clusters preset, colour by, find, and a replay of your network by the day you connected that you can save as a video.
date: 2026-09-29
updated: 2026-10-04
tags: [galaxy, visualisation]
image: /img/app/lab-clusters.jpg
---

The Galaxy is the first thing Sixgree shows you: you in the middle, your connections on rings around you, the ones who can open the most doors closest in. It's drawn by a **force simulation**, the same idea behind graph views in tools like Obsidian: every dot pushes the others away, lines pull connected dots together, and the picture settles where the forces balance.

The **physics lab** hands you the controls. It's experimental, and it lives in the Galaxy's Filters panel, under *Physics*.

## The forces

Five sliders set how the Galaxy lays itself out, under the names Obsidian gives its graph's forces:

- **Center force** (0 to 3): a pull in towards you. Higher keeps the whole network a tighter, rounder disc.
- **Repel force** (0 to 300): how hard dots push each other apart, the space between clusters.
- **Link force** (0 to 15×): how tightly a line holds: your connections to you, a circle to its connection, and someone in several circles to each of them.
- **Link distance** (0.05 to 6×): how long the lines are: how far a circle sits from its connection, and your connections from you.
- **Rings** (0 to 5×): how hard each tier holds its ring. At the default, S sits nearest and D furthest out. At **0 the rings let go**, and the Galaxy finds its own shape.

A sixth, **Orbit**, sets the whole map slowly turning round you, every circle with it, so nothing loses its shape. At 0 it holds still.

Two more set the look: **node size** and **link thickness**. Dots can be sized by power score, by their lines, or by how many people hang off them, and names can show for the hubs, the S tier and catalysts only, or for all your connections. A *Names* switch in Filters turns them off altogether.

Everything moves the Galaxy in place, and **Reset to today's layout** puts it back.

## Clusters

*Layout* picks Rings, Orbit or **Clusters**, the fastest way to see the lab do something. Clusters draws your network the way Obsidian draws a graph: it lets the rings go (Rings 0), sets Center force 0.8, Repel force 6, Link force 6× and Link distance 0.15×, and sizes dots by their lines. Each connection with a scanned circle becomes a big hub with their circle round them, anyone in two circles ties them together, and your network turns from rings into neighbourhoods.

Tick *Light up a branch on hover* and hovering a dot lights up its **branch**: everyone behind it, and the chain back to you. The rest dims.

![The physics lab beside the Galaxy, laid out as Clusters, in an invented network](/img/app/lab-clusters.jpg "Clusters, on an invented network.")

## Colour, find and names

**Colour by** repaints the Galaxy five ways, each with a legend:

- **Tier**, the default, from S to D;
- **Heat**: power as a thermal map, the higher someone's score among the people showing, the hotter;
- **Degree**: your connections, the people they know, and anyone further out;
- **Company**: the eight most common companies in view, and everyone else in grey;
- **Warmth**: how recently you've been in touch, from the connections export read in Outlink → Messages & follow-ups (experimental).

**Find** takes a name, a company or a role from two letters. Everyone who matches lights up and the rest dim; Enter flies to the best match and opens their card.

## The replay

**Replay** plays your network growing. Each connection appears on the day you connected, and their circle arrives with them. There's a time slider, a length of 5 seconds, 15 (the default), 30 or a minute, and *Loop*. If you've read the connections export in Messages & follow-ups, your job starts are marked along the timeline in gold and your posts in blue, and the job you were at shows as the replay passes each date.

The replay needs "connected on" dates, which come from a scan or from the official connections export. The invented sample network has none, so there's nothing to replay until you bring your own network in.

## Saving it

- **Save a picture** makes a PNG of the Galaxy at twice its size on screen, with its legend.
- **Record the replay** saves it as a video: MP4 (H.264) where your computer's window supports it, otherwise WebM, at 12 frames a second. The button only appears where the window can record.
- **Saved layouts** keep a set of slider settings under a name, so a layout you like is one click away.

Beside *Save a picture*, the lab reminds you that it shows real names, so check it before you post it. Nothing leaves your computer unless you share the file yourself.

## Why a physics lab?

Because rings are a good first picture and a poor only picture. Letting the rings go shows who gathers people around them. Colouring by company shows where your network clusters. And the replay shows something no list can: how your network grew, and which chapters of your working life it came from.

The layout code is in [lib/galaxy-lab.js](https://github.com/blakeb056/six-degrees/blob/main/lib/galaxy-lab.js), with its tests.
