import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Todos (Next.js + SLOP)",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <meta name="slop" content="ws://localhost:3000/api/slop" />
      </head>
      <body
        style={{
          margin: 0,
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          background: "#0f1117",
          color: "#e1e4e8",
        }}
      >
        {children}
      </body>
    </html>
  );
}
