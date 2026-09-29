// The Social tab's reader for your own LinkedIn data export (lib/linkedin-export.js).
// Invented people and messages only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readTable, exportDate, messageStats, warmthOf, repliesWaiting, careerChapters, postingEffect, invitationSplit,
} from '../lib/linkedin-export.js';

const ME = 'https://www.linkedin.com/in/me-0000';
const ADA = 'https://www.linkedin.com/in/ada-quill';
const BEN = 'https://www.linkedin.com/in/ben-ostrander';
const CY = 'https://www.linkedin.com/in/cy-marsh';

const messages = `CONVERSATION ID,CONVERSATION TITLE,FROM,SENDER PROFILE URL,TO,RECIPIENT PROFILE URLS,DATE,SUBJECT,CONTENT,FOLDER
c1,,Me,${ME},Ada Quill,${ADA},2026-09-01 10:00:00 UTC,,"Hi Ada, long time",INBOX
c1,,Ada Quill,${ADA},Me,${ME},2026-09-20 09:00:00 UTC,,"Great to hear from you!
Let's catch up.",INBOX
c2,,Me,${ME},Ben Ostrander,${BEN},2024-01-05 12:00:00 UTC,,Hello,INBOX
c3,,Me,${ME},Cy Marsh,${CY},2026-09-27 08:00:00 UTC,,Thanks,INBOX
c4,,Me,${ME},"Ada, Ben","${ADA},${BEN}",2026-09-26 08:00:00 UTC,,Group,INBOX`;

test('messages: 1:1 conversations only, who wrote last, as of the latest message, no text kept', () => {
  const rows = readTable(messages, 'conversation id');
  const s = messageStats(rows);
  assert.equal(s.self, 'https://www.linkedin.com/in/me-0000');
  assert.equal(s.asOf, Date.UTC(2026, 8, 27, 8));
  const ada = s.people.get('https://www.linkedin.com/in/ada-quill');
  assert.deepEqual({ total: ada.total, lastFromThem: ada.lastFromThem }, { total: 2, lastFromThem: true });
  assert.equal(s.people.size, 3, 'the group thread is left out');
  for (const v of s.people.values()) assert.deepEqual(Object.keys(v).sort(), ['last', 'lastFromThem', 'recent', 'total']);
  assert.equal(warmthOf(ada, s.asOf), 'warm');
  assert.equal(warmthOf(s.people.get('https://www.linkedin.com/in/ben-ostrander'), s.asOf), 'dormant');
  assert.equal(warmthOf(undefined, s.asOf), 'never');
  assert.deepEqual(repliesWaiting(s), [{ url: 'https://www.linkedin.com/in/ada-quill', days: 7, total: 2 }]);
});

test('dates in each of the export\'s formats', () => {
  assert.equal(exportDate('2026-09-20 09:00:00 UTC'), Date.UTC(2026, 8, 20, 9));
  assert.equal(exportDate('9/20/26, 2:30 PM'), Date.UTC(2026, 8, 20, 14, 30));
  assert.equal(exportDate('Jan 2020'), Date.UTC(2020, 0, 1));
  assert.equal(exportDate('01 May 2024'), Date.UTC(2024, 4, 1));
  assert.equal(exportDate(''), null);
  assert.equal(exportDate('someday'), null);
});

test('career chapters, posts and invitations', () => {
  const positions = readTable(`Company Name,Title,Description,Location,Started On,Finished On
Hooli,Engineer,,,Jan 2020,Dec 2022
Initech,Founder,,,Jan 2023,`, 'company name');
  const connections = readTable(`Notes:
"When exporting your connection data, you may notice…"

First Name,Last Name,URL,Email Address,Company,Position,Connected On
Ada,Quill,${ADA},,Hooli,VP,01 Mar 2021
Ben,Ostrander,${BEN},,Initech,CTO,10 Feb 2023
Cy,Marsh,${CY},,Initech,CEO,12 Feb 2023`, 'first name');
  const ch = careerChapters(positions, connections, Date.UTC(2026, 8, 29));
  assert.deepEqual(ch.map((c) => [c.company, c.made]), [['Hooli', 1], ['Initech', 2]]);
  const posts = postingEffect(readTable(`Date,ShareLink,ShareCommentary,SharedUrl,MediaUrl,Visibility
2023-02-09 10:00:00,https://www.linkedin.com/feed/update/x,My post,,,MEMBER_NETWORK`, 'date'), connections);
  assert.deepEqual(posts.posts.map((p) => p.week), [2]);
  assert.ok(posts.usualWeek > 0 && posts.afterPosts === 2);
  assert.deepEqual(invitationSplit(readTable(`From,To,Sent At,Message,Direction
Ada,Me,"9/1/26, 10:00 AM",,INCOMING
Me,Ben,"9/2/26, 11:00 AM",,OUTGOING
Cy,Me,"9/3/26, 12:00 PM",,INCOMING`, 'direction')), { incoming: 2, outgoing: 1, total: 3 });
});

test('the live sync matches people by link, else by a name only one connection has', async () => {
  const { matchLive } = await import('../lib/linkedin-export.js');
  const conns = [
    { name: 'Ana Ruiz', profile_url: 'https://www.linkedin.com/in/ana-ruiz' },
    { name: 'Ben Ode, MBA', profile_url: 'https://www.linkedin.com/in/ben-ode' },
    { name: 'Cy Lee', profile_url: 'https://www.linkedin.com/in/cy-lee-1' },
    { name: 'Cy Lee', profile_url: 'https://www.linkedin.com/in/cy-lee-2' },
  ];
  const { live, unmatched } = matchLive({
    'https://www.linkedin.com/in/ana-ruiz/': { last: 5, unread: 1, name: 'Someone Else' },
    'https://www.linkedin.com/in/ACoAAB1/': { last: 7, unread: 0, name: 'Ben Ode' },
    'https://www.linkedin.com/in/ACoAAB2/': { last: 9, unread: 2, name: 'Cy Lee' },
    'https://www.linkedin.com/in/ACoAAB3/': { last: 9, unread: 2, name: 'Nobody Here' },
  }, conns);
  assert.deepEqual(Object.keys(live).sort(), ['https://www.linkedin.com/in/ana-ruiz', 'https://www.linkedin.com/in/ben-ode']);
  assert.equal(live['https://www.linkedin.com/in/ben-ode'].last, 7);
  assert.equal(unmatched, 2);   // Cy Lee is two people; Nobody Here isn't a connection
  assert.ok(!JSON.stringify(live).includes('Ben'));   // names aren't kept
});
