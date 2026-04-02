import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "UbuntuCare SA Live Demo v4",
  description:
    "Paperless South African hospital demo with patient, doctor, nurse, and admin workspaces, casualty arrivals, vitals, medications, labs, scans, theatre, transfers, documents, and email queue."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
