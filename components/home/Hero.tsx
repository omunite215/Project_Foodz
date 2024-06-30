import Link from "next/link";
import Image from "next/image";
import { Button } from "../common";

const Hero = () => {
	return (
		<section className="hero-box padding-y">
			<div className="hero-text-wrapper">
				<article className="hero-internal-text-wrapper">
					<h1 className="hero-heading-text">You&#39;ve Got Questions.</h1>
					<h1 className="hero-heading-text">We&#39;ve Got Taste.</h1>
					<p className="hero-subtitle-text">
						Explore your Taste with special food in the special place. This test
						don&#39;t have any meaning
					</p>
					<div className="hero-button-section">
						<Button />
						<Link href="/menu" className="hero-text-link">
							Explore menu
						</Link>
					</div>
				</article>
				<article className="hero-stats-wrapper">
					<div className="text-center">
						<h2 className="hero-card-stat-text">9+</h2>
						<p className="hero-card-title-text">years of service.</p>
					</div>
					<div className=" border bg-neutralLineWhite w-[4.25rem] h-[0rem] rotate-90 mt-[2.5rem] " />
					<div className="text-center">
						<h2 className="hero-card-stat-text">120+</h2>
						<p className="hero-card-title-text">Stores in the world.</p>
					</div>
				</article>
			</div>
			<div className="relative md:ml-4 ml-0 md:mt-0 mt-32">
				<div className="flex md:gap-0 gap-5 sm:items-start items-center sm:justify-normal justify-center md:ml-0 ml-[25%]">
					<Image
						src="../../Home/Hero/udon.svg"
						width={453}
						height={453}
						alt="udon"
						loading="eager"
						className="rotate-90-cw lg:w-[453px] md:w-[353px] w-[202px] lg:h-[453px] md:h-[353px] h-[200px] md:block relative md:bottom-0 bottom-20 sm:mx-0 mx-3"
					/>
					<Image
						src="../../Home/Hero/sugar.svg"
						width={108}
						height={105}
						alt="sugar"
						className=" mt-2 sm:mr-0 mr-16"
					/>
				</div>
				<Image
					src="../../Home/Hero/chopstick.svg"
					width={391}
					height={422}
					className=" object-contain absolute sm:-bottom-[87px] -bottom-8 -z-0 overflow-clip sm:w-[391px] w-[166px] sm:h-[422px] h-[178px]"
					alt="chopstick"
				/>
				<div id="hero-circle-background" />
			</div>
		</section>
	);
};

export default Hero;
