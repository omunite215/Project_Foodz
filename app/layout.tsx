import "../styles/globals.css";
import { Navbar, Footer } from "@/components/common";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "FoodZ",
  description: "Special Food Special Place",
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
          <header className="sm:px-16 px-6 flex justify-center items-center">
            <nav className="xl:max-w-[71.25rem] w-full">
              <Navbar />
            </nav>
          </header>
          <section className=" bg-bgWhite flex justify-center items-start">
            <section className=" xl:max-w-[71.25rem] w-full z-0">
            {children}
            </section>
          </section>
        </main>
      </body>
    </html>
  );
}
