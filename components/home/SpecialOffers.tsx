import FoodCard from "../common/FoodCard";
import { foodCardContent } from "@/constants";

const SpecialOffers = () => {
  return (
    <section className="w-full flex flex-col justify-center items-center sm:px-16 px-6 sm:gap-20 gap-[1.94rem]">
      <div className="flex flex-col sm:gap-3 gap-2 text-center justify-center items-center w-full">
        <h1 className=" font-alice font-normal sm:text-5xl text-[2rem] text-textBlack">
          Today <span className="text-primaryGreen">Special</span> Offers
        </h1>
        <p className=" font-poppins font-normal md:text-2xl sm:text-xl text-lg text-textNeutralBlack w-3/4">
          Best cooks and bext delivery guys all at your service. Hot tasty food
          will reach you in 60 minutes.
        </p>
      </div>
      <div className="flex w-full md:flex-row flex-col md:justify-center justify-between items-center sm:pb-20 pb-10 md:gap-x-[5.25rem] gap-x-0  gap-y-3">
        {foodCardContent.map((item, index) => (
          <div key={item.title}>
            <FoodCard
              title={item.title}
              imageSrc={item.imageSrc}
              price={item.price}
              show={index === 1 ? true : false}
              content={item.content}
            />
          </div>
        ))}
      </div>
    </section>
  );
};

export default SpecialOffers;
