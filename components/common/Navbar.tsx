"use client";
import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { navLinks } from "@/constants";
import { Button } from "./";
import { usePathname } from "next/navigation";

const Navbar = () => {
	const currentPath = usePathname();
	const [toggle, setToggle] = useState(false);
	return (
		<section className="w-full py-6 flexBetween">
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
							currentPath === item.href
								? "text-primaryGreen"
								: "text-textNeutralBlack"
						}`}
					>
						<Link href={item.href}>{item.title}</Link>
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
					<div id="bar1" className="bars" />
					<div id="bar3" className="bars" />
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
									currentPath === item.title
										? "text-primaryGreen"
										: "text-textNeutralBlack"
								}`}
							>
								<Link href={item.href}>{item.title}</Link>
							</li>
						))}
					</ul>
				</div>
			</div>
		</section>
	);
};

export default Navbar;
