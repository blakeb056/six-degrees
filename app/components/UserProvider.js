'use client';

import { createContext, useContext, useState, useEffect } from 'react';
import { getUserId, getUserName, setUser, hasUser } from '../../lib/user';
import { IS_DEMO, DEMO_USER } from '../../lib/demo';
import { hasCsvNetwork, CSV_USER } from '../../lib/csv';

const UserContext = createContext({
  userId: null, userName: null, userProfile: null, ready: false,
});

export function useUser() {
  return useContext(UserContext);
}

export default function UserProvider({ children }) {
  const [userId, setUserId] = useState(null);
  const [userName, setUserName] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Demo mode: hand back a fixed identity so the app renders the invented
    // sample network (public/demo-data.json) for everyone, with no onboarding
    // and no /api/users call. It names no company, as a CSV import doesn't.
    if (IS_DEMO) {
      setUserId(DEMO_USER.id);
      setUserName(DEMO_USER.name);
      setUserProfile({
        name: DEMO_USER.name, headline: DEMO_USER.headline,
        role: '', company: '', industry: '', sectors: [], goals: [], linkedin_url: '',
      });
      setReady(true);
      return;
    }
    // An imported CSV is a local, account-free session: adopt a local identity
    // so the app opens straight into their network with no /api/users call.
    if (hasCsvNetwork()) {
      setUserId(CSV_USER.id);
      setUserName(CSV_USER.name);
      setUserProfile({
        name: CSV_USER.name, headline: 'Imported from your LinkedIn CSV',
        role: '', company: '', industry: '', sectors: [], goals: [], linkedin_url: '',
      });
      setReady(true);
      return;
    }
    // Who "you" are is decided by the server, from the data: the profile that
    // owns the network, or a new one on a fresh install (lib/profile.js).
    //
    // It used to live in this browser's localStorage and was asked for by name.
    // localStorage is per-origin, so the packaged app (127.0.0.1:6363) and a dev
    // server (localhost:3000) were two strangers to each other, and every name
    // typed into the prompt that did not match exactly made a new, empty
    // profile. The network then vanished from view and the scraper refused to
    // pick between the duplicates. The browser now only caches the answer.
    const toProfile = (u) => ({
      name: u.name,
      headline: u.headline || '',
      role: u.role || '',
      company: u.company || '',
      industry: u.industry || '',
      sectors: u.sectors || [],
      goals: u.goals || [],
      linkedin_url: u.linkedin_url || '',
    });

    fetch('/api/users?me=1')
      .then((r) => r.json())
      .then((data) => {
        const me = data.user;
        if (!me) throw new Error('no profile');
        setUser(me.id, me.name);
        setUserId(me.id);
        setUserName(me.name);
        setUserProfile(toProfile(me));
      })
      .catch(() => {
        // Server unreachable: fall back to whatever this browser last knew.
        if (hasUser()) {
          setUserId(getUserId());
          setUserName(getUserName());
        }
      })
      .finally(() => setReady(true));
  }, []);

  const login = (id, name) => {
    setUser(id, name);
    setUserId(id);
    setUserName(name);
    // Fetch profile after login
    fetch(`/api/users?id=${id}`)
      .then(r => r.json())
      .then(data => {
        if (data.user) {
          setUserProfile({
            name: data.user.name,
            headline: data.user.headline || '',
            role: data.user.role || '',
            company: data.user.company || '',
            industry: data.user.industry || '',
            sectors: data.user.sectors || [],
            goals: data.user.goals || [],
            linkedin_url: data.user.linkedin_url || '',
          });
        }
      })
      .catch(() => {});
  };

  return (
    <UserContext.Provider value={{ userId, userName, userProfile, ready, login }}>
      {children}
    </UserContext.Provider>
  );
}
