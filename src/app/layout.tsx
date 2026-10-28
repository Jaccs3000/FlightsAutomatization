import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vuela · seguimiento de precios",
  description: "Seguimiento personal de precios de vuelos",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
