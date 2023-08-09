import Image from "next/image";
import Link from "next/link";
import { FoodCardProps } from "@/types";
import { OrderNowButton } from ".";

const FoodCard = ({ imageSrc, title, price, show, content }: FoodCardProps) => {
  return (
    <div className="flex flex-col rounded-[0.9375rem] bg-white shadow-[0px_10px_27px_0px_rgba(53,53,53,0.05)] md:w-[28rem] sm:w-[17.8125rem] w-[19.375rem]">
      <div className="flex justify-center items-center pt-6 px-7">
        <Image
          src={imageSrc}
          width={284}
          height={284}
          className=" object-contain md:w-[17.77rem] md:h-[17.77rem] w-[12.5rem] h-[12.5rem]"
          alt={title}
        />
      </div>
      <div className=" flex justify-center flex-col items-start gap-3 py-6 px-6">
        <h1 className=" font-alice font-normal md:text-[2rem] sm:text-3xl text-2xl leading-9">
          {title}
        </h1>
        <div className=" flex justify-center items-start gap-3">
          <Image src="../../stars.svg" height={24} width={136} alt="stars" />
          <p className=" font-poppins text-paraTextColor text-base font-normal">
            214 Reviews
          </p>
        </div>
        <p className={`${show ? "flex" : "hidden"}`}>
          Excellent flavour for your preference with:
        </p>
        <ul
          className={`${
            show ? "flex" : "hidden"
          } flex-col font-poppins text-base text-paraTextColor list-disc font-normal`}
        >
          {content.map((item) => (
            <li key={item} className=" ml-8">
              {item}
            </li>
          ))}
        </ul>
        <div className=" flex justify-between items-center w-full">
          <h1 className=" font-alice font-normal text-primaryGreen md:text-[2.5rem] text-[2rem] leading-10">
            ${price}
          </h1>
          <OrderNowButton />
        </div>
      </div>
    </div>
  );
};

export default FoodCard;
