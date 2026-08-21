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
  title: "6 Degrees of Separation — LinkedIn Network Research",
  description: "Visualizing the six degrees of separation hypothesis through LinkedIn connection analysis. A certified research project mapping power networks.",
  viewport: 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no',
};

import UserProvider from './components/UserProvider';

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body style={{ margin: 0, padding: 0, background: '#0a0a1a' }}>
        <UserProvider>
          {children}
        </UserProvider>
      </body>
    </html>
  );
}
