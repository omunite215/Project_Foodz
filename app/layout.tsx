import "./globals.css";
import { Navbar, Footer } from "@/components/Common";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "FoodZ",
  description: "where food meets taste",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <main className=" bg-bgWhite w-full overflow-hidden">
          <header className="sm:px-[4.5rem] xs:px-12 px-6 flexCenter">
            <nav className="xl:max-w-[1440px] w-full">
              <Navbar />
            </nav>
          </header>
          <section className=" bg-bgWhite flexStart">
            <section className=" xl:max-w-[1440px] w-full z-0">
              {children}
              <Footer />
            </section>
          </section>
        </main>
      </body>
    </html>
  );
}
