"use client";
import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { navLinks } from "@/constants";
import OrderNowButton from "./OrderNowButton";

const Navbar = () => {
  const [toggle, setToggle] = useState(false);
  return (
    <section className="w-full flex py-6 justify-between items-center">
      <Image src="../../logo.svg" width={140} height={40} alt="logo" />
      <ul className=" list-none sm:flex hidden justify-end items-center flex-1 gap-8">
        {navLinks.map((item) => (
          <li
            key={item}
            className=" font-poppins font-medium cursor-pointer hover:text-primaryGreen text-base"
          >
            <Link href={`/${item.toLowerCase}`}>{item}</Link>
          </li>
        ))}
        <li>
          <OrderNowButton />
        </li>
      </ul>
      <div className="sm:hidden flex flex-1 justify-end items-center z-40">
        <input
          id="checkbox"
          type="checkbox"
          onClick={() => setToggle((prev) => !prev)}
        />
        <label className="toggle" htmlFor="checkbox">
          <div id="bar1" className="bars"></div>
          <div id="bar3" className="bars"></div>
        </label>
        <div
          className={`${
            toggle ? "flex" : "hidden"
          } p-6 absolute top-20 right-0 mx-4 my-2 min-w-[8.75rem] rounded-xl`}
        >
          <ul className=" list-none flex flex-col justify-end items-center flex-1 gap-4 bg-bgGreen rounded-lg py-6">
            {navLinks.map((item) => (
              <li
                key={item}
                className=" font-poppins font-medium cursor-pointer hover:text-primaryGreen text-base"
              >
                <Link href={`/${item.toLowerCase}`}>{item}</Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
};

export default Navbar;
