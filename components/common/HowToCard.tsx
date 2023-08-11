import { HowToCardProps } from "@/types";
import Image from "next/image";

const HowToCard = ({ imageSrc, title, bg, description }: HowToCardProps) => {
  return (
    <div
      className={`flex flex-col justify-center items-center gap-6 max-w-[24.063rem] min-w-[18.5rem] rounded-xl shadow-[0_10px_27px_0px_rgba(53,53,53,0.05)] ${
        bg
          ? "bg-white"
          : "bg-transparent"
      }`}
    >
      <div className="pt-14">
        <div className=" bg-white rounded-full py-9 px-9 shadow-[5px_9px_16px_0px_rgba(0,0,0,0.04)]">
          <Image src={imageSrc} width={48} height={48} alt={title} />
        </div>
      </div>

      <div className=" flex flex-col gap-[0.38rem] justify-center items-center leading-normal font-normal pb-14">
        <h1 className=" font-alice text-[1.75rem] -tracking-[0.00875rem] text-textBlack">
          {title}
        </h1>
        <p className=" font-poppins text-base text-paraTextColor text-center w-3/4">
          {description}
        </p>
      </div>
    </div>
  );
};

export default HowToCard;
