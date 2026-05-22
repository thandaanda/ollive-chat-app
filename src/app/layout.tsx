import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ollive AI Inference Logging Demo",
  description: "Streaming chatbot with multi-provider inference logging and ingestion dashboards."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
