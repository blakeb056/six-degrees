import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata = {
  title: "Six Degrees",
  description: "Maps your LinkedIn network: who you know, who they know, and the shortest path to someone you haven't met. Runs on your own computer; nothing is uploaded.",
  viewport: 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no',
};

import UserProvider from './components/UserProvider';
import StaleServerBanner from './components/StaleServerBanner';
import ScanStatusBar from './components/ScanStatusBar';
import SocialAutoSync from './components/SocialAutoSync';
import ThemeLoader from './components/ThemeLoader';
import LiquidGlass from './components/LiquidGlass';

const THEME_FIRST = `try{var t=JSON.parse(localStorage.getItem('six-degrees-theme-vars')||'null');if(t&&t.vars){var r=document.documentElement;for(var k in t.vars){var v=String(t.vars[k]);if(/^--sd-[a-z0-9-]+$/.test(k)&&!/[;{}<>]/.test(v))r.style.setProperty(k,v)}var a=t.attrs||{};['theme','backdrop','mode','buttons','dots'].forEach(function(n){if(/^[a-z]+$/.test(a[n]||''))r.dataset[n]=a[n]});r.style.colorScheme=a.mode==='light'?'light':'dark'}}catch(e){}`;

export default function RootLayout({ children }) {
  return (
    <html lang="en" data-backdrop="none" data-mode="dark" data-buttons="soft" data-dots="solid" className={`${geistSans.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <head>
        {/* The theme (lib/theme-store.js), on the page before it paints. Only
            --sd- variables, and only values with nothing that could end one. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_FIRST }} />
      </head>
      <body style={{ margin: 0, padding: 0, background: 'var(--sd-bg, #0a0a1a)' }}>
        <ThemeLoader />
        <LiquidGlass />
        <UserProvider>
          {children}
          {/* Says so when the files on disk have moved past what this server
              is running. Every page, because the answer to "did my update
              work?" should not require finding the right screen. */}
          <StaleServerBanner />
          {/* While a scan runs: what it's doing and today's budget, with Stop. */}
          <ScanStatusBar />
          {/* The Social tab's once-a-day messages sync, when switched on. */}
          <SocialAutoSync />
        </UserProvider>
      </body>
    </html>
  );
}
