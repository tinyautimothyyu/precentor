import "./globals.css";
import { AuthProvider } from "@/lib/auth";
import Header from "./Header";

export const metadata = {
  title: "Precentor — Song Library",
  description: "Worship ministry song library",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <Header />
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
