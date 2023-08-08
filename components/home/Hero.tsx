import { OrderNowButton } from "../common";
import Link from "next/link";
import Image from "next/image";

const Hero = () => {
  return (
    <section className="py-[7.5rem] flex md:flex-row justify-center flex-col overflow-hidden">
      <div className=" flex flex-col justify-between items-start flex-1 gap-40">
        <article className="">
          <h1 className=" font-alice text-6xl font-normal text-textBlack relative w-full">
            You&#39;ve Got Questions.
          </h1>
          <h1 className="font-alice text-6xl font-normal text-textBlack relative">
            We&#39;ve Got Taste.
          </h1>
          <p className=" font-poppins font-normal text-2xl text-textNeutralBlack mt-3">
            Explore your Taste with special food in the special place. This test
            don&#39;t have any meaning
          </p>
          <div className=" flex justify-start items-center gap-6 mt-9">
            <OrderNowButton />
            <Link href="/menu" className=" text-primaryGreen">
              Explore menu
            </Link>
          </div>
        </article>
        <article className=" flex justify-center items-start gap-[3.75rem] font-poppins text-textNeutralBlack px-14 py-7 bg-neutralWhite rounded-2xl">
          <div className=" text-center">
            <h2 className=" text-[2rem] leading-[3rem] font-semibold">9+</h2>
            <p className=" text-xl font-normal">years of service.</p>
          </div>
          <div className=" border bg-neutralLineWhite w-[4.25rem] h-[0rem] rotate-90 mt-[2.5rem] " />
          <div className=" text-center">
            <h2 className=" text-[2rem] leading-[3rem] font-semibold">120+</h2>
            <p className="text-xl font-normal">Stores in the world.</p>
          </div>
        </article>
      </div>
      <div className="relative ml-4">
        <div className="flex gap-0 items-start">
        <Image src="../udon.svg" width={453} height={453} alt="udon" className="" />
        <Image src="../sugar.svg" width={108} height={105} alt="" className=" mt-2" />
        </div>
        <Image src="../chopstick.svg" width={391} height={422} className=" object-contain absolute -bottom-0 -z-0 overflow-clip" alt="" />
        <div id="hero-circle-background"/>

        

      </div>
    </section>
  );
};

export default Hero;
