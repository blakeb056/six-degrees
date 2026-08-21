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
    // Demo mode: hand back a fixed identity so the app renders Blake's snapshot
    // for everyone, with no onboarding and no /api/users call.
    if (IS_DEMO) {
      setUserId(DEMO_USER.id);
      setUserName(DEMO_USER.name);
      setUserProfile({
        name: DEMO_USER.name, headline: DEMO_USER.headline,
        role: '', company: 'Stead Labs', industry: '', sectors: [], goals: [], linkedin_url: '',
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
    if (hasUser()) {
      const id = getUserId();
      const name = getUserName();
      setUserId(id);
      setUserName(name);
      // Fetch full profile from API
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
    }
    setReady(true);
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
