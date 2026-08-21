// Client-side loader for the network. Replaces the direct database queries the
// pages used to run in the browser.
export async function loadNetwork(userId) {
  const url = userId ? `/api/network?userId=${encodeURIComponent(userId)}` : '/api/network';
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load network (${res.status})`);
  const data = await res.json();
  return {
    degree1: data.degree1 || [],
    degree2: data.degree2 || [],
    degree3: data.degree3 || [],
  };
}
