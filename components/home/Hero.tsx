import { OrderNowButton } from "../common";
import Link from "next/link";
import Image from "next/image";

const Hero = () => {
  return (
    <section className="sm:py-[7.5rem] py-14 flex sm:flex-row flex-col justify-center overflow-hidden ">
      <div className=" flex flex-col justify-between items-start flex-1 gap-40 xl:px-0 sm:px-16 px-6">
        <article className="md:items-start items-center flex flex-col md:gap-0 gap-4">
          <h1 className=" font-alice md:text-6xl sm:text-[3.5rem] text-[2rem] font-normal text-textBlack relative md:text-left text-center">
            You&#39;ve Got Questions.
          </h1>
          <h1 className="font-alice md:text-6xl sm:text-[3.5rem] text-[2rem] font-normal text-textBlack relative md:text-left text-center">
            We&#39;ve Got Taste.
          </h1>
          <p className=" font-poppins font-normal md:text-2xl sm:text-xl text-lg text-textNeutralBlack mt-3 w-3/4 md:text-left text-center">
            Explore your Taste with special food in the special place. This test
            don&#39;t have any meaning
          </p>
          <div className=" flex md:justify-start justify-center items-center gap-6 mt-9">
            <OrderNowButton />
            <Link href="/menu" className=" text-primaryGreen md:block hidden">
              Explore menu
            </Link>
          </div>
        </article>
        <article className=" md:flex hidden justify-center items-start gap-[3.75rem] font-poppins text-textNeutralBlack px-14 py-7 bg-neutralWhite rounded-2xl">
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
      <div className="relative md:ml-4 ml-0 md:mt-0 mt-32">
        <div className="flex md:gap-0 gap-5 sm:items-start items-center sm:justify-normal justify-center md:ml-0 ml-[25%]">
          <Image
            src="../udon.svg"
            width={453}
            height={453}
            alt="udon"
            className=" lg:w-[453px] md:w-[353px] w-[202px] lg:h-[453px] md:h-[353px] h-[200px] md:block relative md:bottom-0 bottom-20 sm:mx-0 mx-3"
          />
          <Image
            src="../sugar.svg"
            width={108}
            height={105}
            alt=""
            className=" mt-2 sm:mr-0 mr-16"
          />
        </div>
        <Image
          src="../chopstick.svg"
          width={391}
          height={422}
          className=" object-contain absolute sm:-bottom-[87px] -bottom-8 -z-0 overflow-clip sm:w-[391px] w-[166px] sm:h-[422px] h-[178px]"
          alt=""
        />
        <div id="hero-circle-background" />
      </div>
    </section>
  );
};

export default Hero;
