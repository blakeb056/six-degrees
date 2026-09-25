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

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body style={{ margin: 0, padding: 0, background: '#0a0a1a' }}>
        <UserProvider>
          {children}
          {/* Says so when the files on disk have moved past what this server
              is running. Every page, because the answer to "did my update
              work?" should not require finding the right screen. */}
          <StaleServerBanner />
        </UserProvider>
      </body>
    </html>
  );
}
