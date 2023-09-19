import Image from "next/image";
import { Button } from ".";

interface SpecialOfferCardProps {
  imageSrc: string;
  title: string;
  price: number;
  show: boolean;
  content: string[];
}

const SpecialOffersCard = ({
  imageSrc,
  title,
  price,
  show,
  content,
}: SpecialOfferCardProps) => {
  return (
    <div
      className={`flex flex-col rounded-[0.9375rem] bg-white shadow-lg ${
        show
          ? "md:w-[28rem] sm:w-[19.375rem]"
          : "md:w-[21.25rem] sm:w-[17.8125rem]"
      } w-[19.375rem]`}
    >
      <div className="flexCenter pt-6 px-7">
        <Image
          src={imageSrc}
          width={0}
          height={0}
          className="special-offers-card-img"
          alt={title}
        />
      </div>
      <div className="flexStart flex-col gap-3 py-6 px-6">
        <div className="flexBetween w-full">
          <h1 className="special-offers-card-title">{title}</h1>
          <div
            className={`${
              show
                ? "flexCenter gap-[0.62rem] px-2 py-1 border border-primaryGreen rounded-md"
                : " hidden"
            }`}
          >
            <Image
              src="../../Home/specialoffers/fire.svg"
              alt="fire"
              width={24}
              height={24}
            />
            <h3 className="special-offers-card-cooking-time">02:21:11</h3>
          </div>
        </div>
        <div className="flex justify-start items-center gap-3">
          <Image
            src="../../Home/specialoffers/stars.svg"
            height={24}
            width={136}
            alt="stars"
          />
          <p className="special-offers-card-rating">214 Reviews</p>
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
            <li key={item} className="ml-8">
              {item}
            </li>
          ))}
        </ul>
        <div className=" flexBetween w-full">
          <h1 className="special-offers-card-price">${price}</h1>
          <Button />
        </div>
      </div>
    </div>
  );
};

export default SpecialOffersCard;
