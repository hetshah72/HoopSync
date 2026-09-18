import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Sora } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/layout/theme-provider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * Display face for headings and the wordmark only - body copy and every stat
 * stays on Geist, whose tabular figures keep numbers from shifting width as
 * they change. Pairing a distinct display face with a neutral text face is
 * most of what separates a product from a template.
 */
const sora = Sora({
  variable: "--font-display",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "HoopSync",
    template: "%s - HoopSync",
  },
  description: "AI-powered basketball development platform.",
  applicationName: "HoopSync",
  appleWebApp: { capable: true, title: "HoopSync", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f7fa" },
    { media: "(prefers-color-scheme: dark)", color: "#16171d" },
  ],
  // The app shell owns its own scroll regions and a fixed tab bar; letting the
  // page zoom-bounce on iOS drags that chrome out of place.
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // `suppressHydrationWarning` is required by next-themes: its blocking
    // inline script sets the theme class on <html> before React hydrates, so
    // the server and client markup differ here by design.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${sora.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <ThemeProvider>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
