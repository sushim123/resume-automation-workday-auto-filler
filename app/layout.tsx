import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Workday AI Job Application Automation Platform',
  description: 'AI-Driven Chrome Extension & Next.js Engine for automated Workday job application filling.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}
