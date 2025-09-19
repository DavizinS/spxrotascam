// app/layout.tsx
import "./globals.css";

export const metadata = { title: "Romaneio Panel" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body suppressHydrationWarning>
        <div className="mx-auto max-w-7xl px-4 py-6 md:px-6 lg:px-8">{children}</div>
      </body>
    </html>
  );
}