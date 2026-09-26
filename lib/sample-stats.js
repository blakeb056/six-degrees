// The sample network's own numbers, for the launch page (app/launch/page.js),
// which shows them rather than anyone's real network. Counted from
// public/demo-data.json, where every person is invented
// (scripts/gen-synthetic.mjs); tests/sample-stats.test.mjs counts them again,
// so regenerating the sample can't leave them stale. They're written here
// rather than read from the file so the page doesn't download the whole sample
// to show a few numbers.
export const SAMPLE_STATS = {
  connections: 873,       // rows: the 1st degree and the circles of the bridges
  degree1: 150,
  degree2: 723,
  people: 748,            // each person once, however many circles they're in
  bridges: 14,            // 1st-degree people whose circle is mapped
  companies: 19,          // where people work now, as Paths groups them
  recommendations: 474,   // the Queue's list: 2nd-degree S, A and B you aren't connected to
};
