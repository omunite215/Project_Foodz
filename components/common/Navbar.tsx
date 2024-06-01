"use client";
import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { navLinks } from "@/constants";
import { Button } from ".";

const Navbar = () => {
  const [toggle, setToggle] = useState(false);
  const [active, setActive] = useState("Home");
  return (
    <section className="w-full py-6 flexStart">
      <Link href="/">
        <Image
          src="../../Logo/logo.svg"
          width={140}
          height={40}
          alt="logo"
          priority={true}
        />
      </Link>

      <ul className=" list-none sm:flexEnd hidden gap-8">
        {navLinks.map((item) => (
          <li
            key={item.title}
            className={`font-poppins font-medium cursor-pointer hover:text-primaryGreen text-base ${
              active === item.title
                ? "text-primaryGreen"
                : "text-textNeutralBlack"
            }`}
            onClick={() => setActive(item.title)}
          >
            <Link href={`/${item.linkTitle}`}>{item.title}</Link>
          </li>
        ))}
        <li>
          <Button />
        </li>
      </ul>
      <div className="sm:hidden flexEnd">
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
          } p-6 absolute top-20 right-0 mx-4 my-2 min-w-[8.75rem] rounded-xl z-50`}
        >
          <ul className=" list-none flexEnd flex-col gap-4 bg-bgGreen rounded-lg py-6">
            {navLinks.map((item) => (
              <li
                key={item.title}
                className={`font-poppins font-medium cursor-pointer hover:text-primaryGreen text-base ${
                  active === item.title
                    ? "text-primaryGreen"
                    : "text-textNeutralBlack"
                }`}
                onClick={() => setActive(item.title)}
              >
                <Link href={`/${item.linkTitle}`}>{item.title}</Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
};

export default Navbar;
