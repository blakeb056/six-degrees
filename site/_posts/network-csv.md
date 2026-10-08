---
title: How to visualize your network from a CSV export
description: Turn your network's Connections.csv into a private network map with Sixgree. Learn how to import it, explore your connections and understand what the export leaves out.
date: 2026-10-05
tags: [network, csv, network mapping]
image: /img/app/hero.jpg
---

You can visualize your network without scanning your network: download your official **Connections.csv**, then import it into [Sixgree](/download/). The file is read and kept on your computer. You get a map of your direct connections, not a complete map of everyone they know.

That distinction matters. A CSV is a useful starting point for understanding the people already in your network. It cannot reveal a second-degree introduction path that isn't in the file.

## 1. Get your network connections export

On the platform's website, open **Me → Settings & Privacy → Data privacy**. Find **Download your data**, sometimes labelled **Get a copy of your data**. Request an archive that includes Connections, then use the platform's email to download it. Unzip the archive and find **Connections.csv**.

The platform's [current data-download help](https://www.linkedin.com/help/network/answer/a1339364?lang=en) explains the available categories. Its [connections-export guide](https://www.linkedin.com/help/sales-navigator/answer/a566336/export-connections-from-network?lang=en) describes requesting the larger archive. Labels and available options can differ, so use those official instructions if your settings don't match.

The connections file can include names, profile URLs, companies, positions and connection dates. Missing email addresses do not mean the export failed: your network only includes an address when the connection's privacy settings allow it.

Download the archive on a computer you trust. It contains other people's information as well as yours. You don't need to upload the archive to a website to make the map.

## 2. Import Connections.csv into Sixgree

[Download Sixgree](/download/) and open it. Choose **Import a network CSV** during setup, or open the **Import a CSV** screen. Drop **Connections.csv** into the drop area, or choose the file from your computer.

Use the CSV itself, not the ZIP archive or an unrelated file from the archive. Sixgree looks for the connections header, including fields such as First Name, Last Name, URL, Company and Position. your network's explanatory lines above the header are supported.

The importer reads the rows locally and turns them into the app's direct-network view. The import is kept on your computer so it remains available after closing the window. It is separate from a network collected by scanning. Importing the file does not sign you into your network or start a scan.

The [CSV parser](https://github.com/blakeb056/six-degrees/blob/main/lib/csv.js) and [local storage implementation](https://github.com/blakeb056/six-degrees/blob/main/lib/csv-store.js) are public if you want to inspect the behavior.

## 3. Read the map, not just the dots

Start with a question rather than trying to interpret the whole picture at once:

- **Who do I know at a particular company?** Look for the company or search for a person you remember working with.
- **Which roles are represented?** Inspect the positions in your export and the score breakdown on a person's card.
- **What does my direct network look like?** Explore the layout, then return to individual cards for the details behind it.

Sixgree's scores are estimates based on the app's model and the information available. They aren't a measure of a person's worth, relationship strength or willingness to help. An old job title in the export is still an old job title when it appears on a map.

If you want to learn the controls before importing anyone, choose the invented sample network instead. The [physics-lab guide](/blog/galaxy-physics-lab/) explains how layouts, dot sizes and forces change the picture.

## What a network CSV can and cannot show

| Question | What the connections export supports |
|---|---|
| Who am I directly connected to? | The first-degree people listed in the file. |
| What company or role is listed for them? | The fields present in that export, which may be incomplete or stale. |
| Who are their connections? | Not included in your Connections.csv. |
| Who can introduce me to a specific second-degree person? | Not established by the CSV alone. |
| How strong is our relationship? | Not established by a connection record. |

An empty second-degree view after a CSV import is a data boundary, not evidence that your network has no reach. your network says its connections export covers first-degree connections. It does not include their connection lists.

For a clearer explanation of the steps between people, read [your network connection degrees explained](/blog/network-connection-degrees/). If you choose to gather more data, Sixgree's optional scanner has a different workflow and real account risk. Read [the scanning guide](/blog/scanning-slowly/) before deciding; importing a CSV does not require it.

## If the import doesn't work

**The app cannot find the header.** Check that you selected Connections.csv. A file of invitations, contacts or messages is not the same format. Keep an untouched copy of the connections export rather than rebuilding it in a spreadsheet.

**The file has no connections.** Check its contents on your own computer and confirm the archive includes the Connections category. Follow your network's official export instructions if it is missing.

**Some information is missing.** Sixgree can't recover information the export doesn't contain. Missing emails are expected for some connections; absent companies and positions should not be treated as proof of a person's current employment.

**There are no second-degree routes.** That is expected with CSV-only data. To try those features without accessing your network, switch to the invented sample.

## Keep the map private until you decide to share it

Local-first means your imported network stays on your computer, not in a Sixgree cloud account. A screenshot you post is different: it can expose names, employers and connections. Review it before sharing and use Names Off when showing a real network publicly.

The [local-first guide](/blog/local-first/) explains storage, backups and what the app contacts. When you're ready, [download Sixgree](/download/) and begin with the sample or your official CSV.

Sixgree is not affiliated with any networking platform.
